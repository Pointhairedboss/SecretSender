/**
 * Google Cloud Run — Universal External Agent Reflector (Playwright Chromium + WebRTC + ML-KEM-768 + Hermes Google Loop)
 *
 * Endpoints:
 *   - GET  /health   -> Container liveness, GCP metadata, and loaded hermes.yaml Google endpoint telemetry
 *   - POST /reflect  -> Executes external agent actions:
 *       1. action: "ping"             -> Returns GCP region, revision, egress IP, and hermes.yaml Google endpoint config
 *       2. action: "seal"             -> Seals a secret on SecretSender from GCP network (protocol mode)
 *       3. action: "claim"            -> Claims & decrypts a secret from GCP network via ML-KEM-768 + WebCrypto
 *       4. action: "browser_seal"     -> Launches real headless Chromium in GCP, seals secret via real DOM + __uatRecorder
 *       5. action: "browser_claim"    -> Launches real headless Chromium in GCP, claims & decrypts secret via real DOM + __uatRecorder
 *       6. action: "browser_session"  -> Runs an interactive/scripted Playwright session on ANY URL
 *       7. action: "hermes_uat"       -> Autonomous Hermes LLM-driven Playwright UAT loop powered by the Google endpoint in hermes.yaml
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { MlKem768 } from 'mlkem';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT || 8080);
const SECRETSENDER_ORIGIN = (process.env.SECRETSENDER_ORIGIN || 'https://secrets.bitbop.dev').replace(/\/+$/, '');
const BITBOP_API_BASE = (process.env.BITBOP_API_BASE || 'https://api.bitbop.dev').replace(/\/+$/, '');
const REFLECTOR_TOKEN = process.env.REFLECTOR_TOKEN ? process.env.REFLECTOR_TOKEN.trim() : '';

/**
 * Load & parse hermes.yaml (lightweight parser for the model/providers blocks so zero extra npm deps are needed)
 */
function loadHermesConfig() {
  const hermesPath = new URL('./hermes.yaml', import.meta.url);
  let raw = '';
  try {
    raw = fs.readFileSync(hermesPath, 'utf8');
  } catch {
    return {
      loaded: false,
      provider: 'gemini',
      default_model: 'gemini-2.5-flash',
      base_url: 'https://generativelanguage.googleapis.com/v1beta',
      openai_base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
      vertex_openai_base_url:
        'https://australia-southeast1-aiplatform.googleapis.com/v1/projects/gen-lang-client-0057994039/locations/australia-southeast1/endpoints/openapi',
    };
  }

  const getField = (key, fallback) => {
    const m = raw.match(new RegExp(`^\\s*${key}:\\s*([^#\\r\\n]+)`, 'm'));
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : fallback;
  };

  return {
    loaded: true,
    config_version: Number(getField('_config_version', '50')),
    provider: getField('provider', 'gemini'),
    default_model: process.env.HERMES_MODEL || getField('default', 'gemini-2.5-flash'),
    base_url: process.env.GEMINI_BASE_URL || getField('base_url', 'https://generativelanguage.googleapis.com/v1beta'),
    openai_base_url:
      process.env.GEMINI_OPENAI_BASE_URL ||
      getField('openai_base_url', 'https://generativelanguage.googleapis.com/v1beta/openai'),
    vertex_openai_base_url:
      'https://australia-southeast1-aiplatform.googleapis.com/v1/projects/gen-lang-client-0057994039/locations/australia-southeast1/endpoints/openapi',
    api_key_configured: Boolean(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY),
  };
}

const HERMES_CONFIG = loadHermesConfig();

let cachedEgressIp = null;

async function getExternalTelemetry() {
  if (!cachedEgressIp) {
    try {
      const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) });
      if (r.ok) {
        const d = await r.json();
        cachedEgressIp = d.ip;
      }
    } catch {}
  }
  return {
    provider: process.env.K_SERVICE ? 'google-cloud-run' : 'local-container-reflector',
    service: process.env.K_SERVICE || 'uat-agent-reflector',
    revision: process.env.K_REVISION || 'local',
    region: process.env.CLOUD_RUN_REGION || process.env.GOOGLE_CLOUD_REGION || 'australia-southeast1',
    hostname: os.hostname(),
    egressIp: cachedEgressIp || 'gcp-nat',
    colo: process.env.K_SERVICE ? `GCP-${process.env.CLOUD_RUN_REGION || 'SYD'}` : 'LOCAL-CONTAINER',
    hermes: {
      loaded: HERMES_CONFIG.loaded,
      provider: HERMES_CONFIG.provider,
      model: HERMES_CONFIG.default_model,
      base_url: HERMES_CONFIG.base_url,
      openai_base_url: HERMES_CONFIG.openai_base_url,
      api_key_configured: Boolean(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY),
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Calls the Google Cloud Vertex AI Global endpoint configured in hermes.yaml
 * (https://aiplatform.googleapis.com/v1beta1/projects/gen-lang-client-0057994039/locations/global/publishers/google/models/{model}:generateContent)
 * using the Cloud Run instance's GCP Metadata Server OAuth token (billed directly to GCP credits on gen-lang-client-0057994039).
 */
async function callHermesGoogleEndpoint(messages, modelOverride = null) {
  const getMetadataToken = async () => {
    const metaRes = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000) }
    );
    if (!metaRes.ok) {
      throw new Error(`GCP Metadata token HTTP ${metaRes.status}`);
    }
    const tokenData = await metaRes.json();
    return tokenData.access_token;
  };

  const systemMsg = messages.find((m) => m.role === 'system')?.content || '';
  const userMsg = messages.filter((m) => m.role !== 'system').map((m) => m.content).join('\n');

  const vertexModels = modelOverride
    ? [modelOverride.replace(/^google\//, '')]
    : ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash'];

  const errors = [];
  for (const modelName of vertexModels) {
    const endpoint = `https://aiplatform.googleapis.com/v1beta1/projects/gen-lang-client-0057994039/locations/global/publishers/google/models/${modelName}:generateContent`;
    try {
      const bearerToken = await getMetadataToken();
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearerToken}`,
          'x-goog-user-project': 'gen-lang-client-0057994039',
        },
        body: JSON.stringify({
          systemInstruction: systemMsg ? { parts: [{ text: systemMsg }] } : undefined,
          contents: [{ role: 'user', parts: [{ text: userMsg }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        errors.push(`google-vertex/${modelName} (${res.status}): ${JSON.stringify(data).slice(0, 220)}`);
        continue;
      }

      const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      let parsed = {};
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = { raw: content };
      }

      return {
        provider: 'google-vertex',
        endpoint,
        model: modelName,
        decision: parsed,
        usage: data?.usageMetadata || null,
        fallback_trace: errors,
      };
    } catch (err) {
      errors.push(`google-vertex/${modelName}: ${err.message || String(err)}`);
    }
  }

  throw new Error(`All Hermes Google Vertex endpoints failed: ${errors.join(' | ')}`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Reflector-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

async function decryptBitBopReveal(revealData, secretKeyBytes, kemInstance) {
  const { cipher, sealed_envelope: sealed } = revealData;
  const kyberCtBytes = Buffer.from(cipher.kyber_ciphertext_hex, 'hex');
  const sharedSecret = await kemInstance.decap(kyberCtBytes, secretKeyBytes);

  const transitKey = await crypto.subtle.importKey('raw', sharedSecret, { name: 'AES-GCM' }, false, ['decrypt']);
  const transitIv = Buffer.from(cipher.aes_iv_hex, 'hex');
  const transitCt = Buffer.from(cipher.aes_ciphertext_hex, 'hex');
  const rawEntropyBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: transitIv }, transitKey, transitCt);
  const entropyHex = Buffer.from(rawEntropyBuf).toString('hex');

  const envKeyDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(entropyHex));
  const envKey = await crypto.subtle.importKey('raw', envKeyDigest, { name: 'AES-GCM' }, false, ['decrypt']);
  const envIv = Buffer.from(sealed.iv_hex, 'hex');
  const envCt = Buffer.from(sealed.ciphertext_b64, 'base64');
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: envIv }, envKey, envCt);
  return new TextDecoder().decode(plainBuf);
}

async function launchReflectorBrowser() {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--enable-features=WebRTC',
    '--use-fake-ui-for-media-stream',
    '--enable-unsafe-swiftshader',
  ];
  try {
    return await chromium.launch({ headless: true, args });
  } catch {
    return await chromium.launch({ headless: true, channel: 'chrome', args });
  }
}

async function waitForUatIdle(page, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const busy = await page
      .evaluate(() => (typeof window.__uatBusy === 'function' ? Boolean(window.__uatBusy()) : false))
      .catch(() => false);
    if (!busy) break;
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(200);
}

async function handleReflect(body) {
  const action = body.action || 'ping';
  const telemetry = await getExternalTelemetry();
  const targetOrigin = (body.target_origin || SECRETSENDER_ORIGIN).replace(/\/+$/, '');
  const apiBase = (body.api_base || BITBOP_API_BASE).replace(/\/+$/, '');

  // 1. Ping
  if (action === 'ping') {
    return { ok: true, action: 'ping', edge_telemetry: telemetry, hermes_config: HERMES_CONFIG };
  }

  // 2. Protocol-level Seal
  if (action === 'seal') {
    const r = await fetch(`${targetOrigin}/api/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const share = await r.json();
    return { ok: r.ok, action: 'seal', edge_telemetry: telemetry, share };
  }

  // 3. Protocol-level Claim
  if (action === 'claim') {
    const { escrow_id: escrowId, unlock_key: unlockKey, test_wrong_pin: testWrongPin = true } = body;
    if (!escrowId || !unlockKey) {
      throw new Error('escrow_id and unlock_key are required');
    }

    const kem = new MlKem768();
    const [publicKey, secretKey] = await kem.generateKeyPair();
    const pkHex = Buffer.from(publicKey).toString('hex');
    const steps = [];

    let wrongPinStatus = null;
    if (testWrongPin) {
      const wr = await fetch(`${apiBase}/escrow/reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: escrowId,
          unlock_key: `${unlockKey}-wrong`,
          kyber_public_key: pkHex,
          signature_scheme: 'ml-dsa-44',
        }),
      });
      wrongPinStatus = wr.status;
      steps.push({ step: 'wrong_pin_probe', status: wr.status, passed: wr.status === 403 });
    }

    const rr = await fetch(`${apiBase}/escrow/reveal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        escrow_id: escrowId,
        unlock_key: String(unlockKey),
        kyber_public_key: pkHex,
        signature_scheme: 'ml-dsa-44',
      }),
    });
    const revealData = await rr.json();
    if (rr.status !== 200) {
      return {
        ok: false,
        action: 'claim',
        edge_telemetry: telemetry,
        reveal_status: rr.status,
        error: revealData.error || `HTTP ${rr.status}`,
      };
    }

    const decryptedPlaintext = await decryptBitBopReveal(revealData, secretKey, kem);
    steps.push({ step: 'mlkem768_aes256gcm_decrypt', status: 200, passed: Boolean(decryptedPlaintext) });

    const vr = await fetch(`${apiBase}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(revealData),
    });
    const vd = await vr.json();
    const revealVerified = vr.status === 200 && vd.valid !== false;
    steps.push({ step: 'mldsa44_receipt_verify', status: vr.status, passed: revealVerified });

    const br = await fetch(`${apiBase}/escrow/reveal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        escrow_id: escrowId,
        unlock_key: String(unlockKey),
        kyber_public_key: pkHex,
        signature_scheme: 'ml-dsa-44',
      }),
    });
    steps.push({ step: 'burn_on_read_409_check', status: br.status, passed: br.status === 409 });

    return {
      ok: true,
      action: 'claim',
      edge_telemetry: telemetry,
      escrow_id: escrowId,
      decrypted_plaintext: decryptedPlaintext,
      reveal_verified: revealVerified,
      beacon_sequence: revealData.beacon_sequence,
      wrong_pin_status: wrongPinStatus,
      burn_recheck_status: br.status,
      steps,
    };
  }

  // 4. Full Headless Chromium Browser Seal (runs real DOM + __uatRecorder inside GCP Cloud Run)
  if (action === 'browser_seal') {
    const browser = await launchReflectorBrowser();
    try {
      const context = await browser.newContext({ viewport: body.viewport || { width: 1280, height: 800 } });
      const page = await context.newPage();
      await page.goto(`${targetOrigin}/?uat=1`, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await waitForUatIdle(page);

      await page.fill('#secret', String(body.password || 'GCP-BROWSER-SECRET'));
      if (body.unlockKey) {
        await page.fill('#pin', String(body.unlockKey));
      }
      await page.click('#seal-btn');
      await page.waitForFunction(
        () => typeof window.__uatState === 'function' && Boolean(window.__uatState().escrowId),
        undefined,
        { timeout: 20000 }
      );
      await waitForUatIdle(page);

      const out = await page.evaluate(() => ({
        state: window.__uatState(),
        uatLog: window.__uatRecorder ? window.__uatRecorder.exportLog() : null,
        resultText: document.getElementById('result')?.innerText || '',
      }));

      return {
        ok: true,
        action: 'browser_seal',
        edge_telemetry: telemetry,
        escrow_id: out.state.escrowId,
        claim_url: `${targetOrigin}/?escrow_id=${encodeURIComponent(out.state.escrowId)}`,
        uat_log: out.uatLog,
      };
    } finally {
      await browser.close();
    }
  }

  // 5. Full Headless Chromium Browser Claim (runs real DOM + ML-KEM-768 + WebCrypto in GCP Chromium)
  if (action === 'browser_claim') {
    const { escrow_id: escrowId, unlock_key: unlockKey } = body;
    if (!escrowId || !unlockKey) {
      throw new Error('escrow_id and unlock_key are required for browser_claim');
    }
    const browser = await launchReflectorBrowser();
    try {
      const context = await browser.newContext({ viewport: body.viewport || { width: 1280, height: 800 } });
      const page = await context.newPage();
      await page.goto(`${targetOrigin}/?escrow_id=${encodeURIComponent(escrowId)}&uat=1`, {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });
      await waitForUatIdle(page);

      await page.fill('#unlock', String(unlockKey));
      await page.click('#reveal-btn');
      await page.waitForSelector('#pw-display', { timeout: 20000 });
      await waitForUatIdle(page);

      const out = await page.evaluate(() => ({
        decryptedPlaintext: document.getElementById('pw-display')?.textContent || '',
        resultText: document.getElementById('result')?.innerText || '',
        state: window.__uatState ? window.__uatState() : null,
        uatLog: window.__uatRecorder ? window.__uatRecorder.exportLog() : null,
      }));

      return {
        ok: true,
        action: 'browser_claim',
        edge_telemetry: telemetry,
        escrow_id: escrowId,
        decrypted_plaintext: out.decryptedPlaintext,
        reveal_verified: out.resultText.includes('YES (ML-DSA-44'),
        uat_log: out.uatLog,
      };
    } finally {
      await browser.close();
    }
  }

  // 6. Universal Multi-App Browser Session (for D-D / dungeon.bitbop.dev, pooled.run, or custom scripted steps)
  if (action === 'browser_session') {
    const url = body.url || `${targetOrigin}/?uat=1`;
    const scriptedSteps = Array.isArray(body.steps) ? body.steps : [];
    const browser = await launchReflectorBrowser();
    try {
      const context = await browser.newContext({ viewport: body.viewport || { width: 1280, height: 800 } });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitForUatIdle(page);

      const stepResults = [];
      for (const s of scriptedSteps) {
        if (s.type === 'fill') await page.fill(s.selector, String(s.value ?? ''));
        else if (s.type === 'click') await page.click(s.selector);
        else if (s.type === 'waitForSelector') await page.waitForSelector(s.selector, { timeout: s.timeout || 15000 });
        else if (s.type === 'wait') await page.waitForTimeout(Number(s.ms || 500));
        await waitForUatIdle(page);
        stepResults.push({ step: s, ok: true });
      }

      const telemetryOut = await page.evaluate(() => ({
        title: document.title,
        url: window.location.href,
        vw: window.innerWidth,
        sw: document.documentElement.scrollWidth,
        uatState: typeof window.__uatState === 'function' ? window.__uatState() : null,
        uatLog: typeof window.__uatRecorder === 'object' ? window.__uatRecorder.exportLog() : null,
      }));

      let screenshotB64 = null;
      if (body.screenshot) {
        const buf = await page.screenshot({ type: 'png' });
        screenshotB64 = buf.toString('base64');
      }

      return {
        ok: true,
        action: 'browser_session',
        edge_telemetry: telemetry,
        step_results: stepResults,
        page_telemetry: telemetryOut,
        screenshot_b64: screenshotB64,
      };
    } finally {
      await browser.close();
    }
  }

  // 7. Autonomous Hermes LLM-Driven UAT Loop (uses Google Gemini / Vertex endpoint from hermes.yaml)
  if (action === 'hermes_uat') {
    const goal =
      body.goal ||
      (body.escrow_id
        ? `Claim and decrypt the secret for escrow_id=${body.escrow_id} using unlockKey="${body.unlock_key}" and verify ML-DSA-44 provenance.`
        : `Seal secret "${body.password || 'HERMES-GEMINI-SECRET'}" with unlock PIN "${body.unlockKey || '778899'}" on SecretSender.`);
    const startUrl = body.escrow_id
      ? `${targetOrigin}/?escrow_id=${encodeURIComponent(body.escrow_id)}&uat=1`
      : body.url || `${targetOrigin}/?uat=1`;

    const browser = await launchReflectorBrowser();
    try {
      const context = await browser.newContext({ viewport: body.viewport || { width: 1280, height: 800 } });
      const page = await context.newPage();
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await waitForUatIdle(page);

      const snapshotBefore = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        uatState: typeof window.__uatState === 'function' ? window.__uatState() : null,
        controls: Array.from(document.querySelectorAll('input, textarea, button'))
          .filter((el) => el.offsetParent !== null)
          .map((el) => ({
            id: el.id ? `#${el.id}` : el.tagName.toLowerCase(),
            tag: el.tagName.toLowerCase(),
            text: (el.innerText || el.placeholder || '').slice(0, 80),
          })),
      }));

      const llmResponse = await callHermesGoogleEndpoint(
        [
          {
            role: 'system',
            content:
              'You are a Hermes UAT Reflector Agent running inside Google Cloud Run. Given a browser DOM snapshot and a UAT goal, return a JSON object with {"reasoning": "...", "steps": [{"type": "fill"|"click", "selector": "#id", "value": "..."}]} using the exact element IDs present in controls.',
          },
          {
            role: 'user',
            content: JSON.stringify({ goal, snapshot: snapshotBefore }),
          },
        ],
        body.model || null
      );

      const steps = Array.isArray(llmResponse.decision?.steps) ? llmResponse.decision.steps : [];
      const executed = [];
      for (const s of steps) {
        if (s.type === 'fill' && s.selector) {
          await page.fill(s.selector, String(s.value ?? ''));
          executed.push(s);
        } else if (s.type === 'click' && s.selector) {
          await page.click(s.selector);
          executed.push(s);
        }
        await waitForUatIdle(page);
      }

      if (body.escrow_id) {
        await page.waitForSelector('#pw-display', { timeout: 20000 }).catch(() => {});
      } else {
        await page
          .waitForFunction(
            () => typeof window.__uatState === 'function' && Boolean(window.__uatState().escrowId),
            undefined,
            { timeout: 20000 }
          )
          .catch(() => {});
      }
      await waitForUatIdle(page);

      const afterOut = await page.evaluate(() => ({
        state: typeof window.__uatState === 'function' ? window.__uatState() : null,
        decryptedPlaintext: document.getElementById('pw-display')?.textContent || null,
        resultText: document.getElementById('result')?.innerText || '',
        uatLog: window.__uatRecorder ? window.__uatRecorder.exportLog() : null,
      }));

      let screenshotB64 = null;
      if (body.screenshot) {
        const buf = await page.screenshot({ type: 'png' });
        screenshotB64 = buf.toString('base64');
      }

      return {
        ok: true,
        action: 'hermes_uat',
        edge_telemetry: telemetry,
        hermes_llm: {
          provider: HERMES_CONFIG.provider,
          endpoint: llmResponse.endpoint,
          model: llmResponse.model,
          reasoning: llmResponse.decision?.reasoning || null,
          planned_steps: steps,
          executed_steps: executed,
          usage: llmResponse.usage,
        },
        escrow_id: afterOut.state?.escrowId || body.escrow_id || null,
        decrypted_plaintext: afterOut.decryptedPlaintext,
        reveal_verified: afterOut.resultText.includes('YES (ML-DSA-44'),
        uat_state: afterOut.state,
        uat_log: afterOut.uatLog,
        screenshot_b64: screenshotB64,
      };
    } finally {
      await browser.close();
    }
  }

  throw new Error(`Unsupported reflector action: ${action}`);
}

function renderConsoleHtml(telemetry) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BitBop Ephemeral Cloud Agent Reflector (GCP)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=JetBrains+Mono:wght@400;700&family=Space+Grotesk:wght@700&display=swap" rel="stylesheet" />
  <style>
    :root { --bg: #0F1012; --card: #16181D; --border: #262932; --gold: #FFD600; --emerald: #10B981; --text: #F1F5F9; --muted: #94A3B8; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; padding: 24px; }
    .wrap { max-width: 980px; margin: 0 auto; }
    .hdr { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; border-bottom: 1px solid var(--border); padding-bottom: 16px; margin-bottom: 20px; }
    h1 { font-family: 'Space Grotesk', sans-serif; font-size: 1.35rem; text-transform: uppercase; letter-spacing: 0.06em; margin: 0; color: var(--gold); }
    .badge { font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; padding: 5px 10px; border-radius: 6px; background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.4); color: var(--emerald); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 16px; margin-bottom: 20px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
    .card h2 { font-family: 'Space Grotesk', sans-serif; font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 12px; color: var(--text); }
    label { display: block; font-size: 0.78rem; text-transform: uppercase; color: var(--muted); margin: 10px 0 4px; font-family: 'JetBrains Mono', monospace; }
    input, select, textarea { width: 100%; background: #0B0C0E; border: 1px solid var(--border); color: var(--text); padding: 10px; border-radius: 6px; font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; }
    button { margin-top: 14px; width: 100%; padding: 12px; border-radius: 8px; border: 1px solid var(--gold); background: var(--gold); color: #1A1600; font-family: 'Space Grotesk', sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer; }
    button:hover { background: #FFE14D; }
    button:disabled { opacity: 0.5; cursor: wait; }
    pre { background: #0B0C0E; border: 1px solid var(--border); border-radius: 8px; padding: 14px; overflow-x: auto; font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; color: #CBD5E1; max-height: 420px; }
    img.shot { width: 100%; border-radius: 8px; border: 1px solid var(--border); margin-top: 12px; display: none; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hdr">
      <div>
        <h1>BitBop Ephemeral Cloud Agent Reflector</h1>
        <div style="font-size:0.82rem;color:var(--muted);margin-top:4px;">Scale-to-Zero Google Cloud Run (Playwright Chromium + WebRTC + ML-KEM-768 + Hermes Vertex AI)</div>
      </div>
      <div class="badge">● ${telemetry.colo} | Egress IP: ${telemetry.egressIp} | Rev: ${telemetry.revision}</div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>1. Autonomous Hermes Vertex AI Loop</h2>
        <label>Target URL</label>
        <input id="h-url" value="https://secrets.bitbop.dev/?uat=1" />
        <label>Secret to Seal (or Goal)</label>
        <input id="h-secret" value="GCP-EPHEMERAL-AGENT-SECRET" />
        <label>Unlock PIN</label>
        <input id="h-pin" value="774411" />
        <label>Vertex AI Model (hermes.yaml)</label>
        <select id="h-model">
          <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (Fastest)</option>
          <option value="gemini-3.8-flash">gemini-3.8-flash</option>
          <option value="gemini-3.5-flash">gemini-3.5-flash</option>
        </select>
        <button id="btn-hermes" onclick="runHermes()">Run Hermes Agent in Cloud Chromium</button>
      </div>

      <div class="card">
        <h2>2. Universal Multi-App Browser Session</h2>
        <label>Target Web App (SecretSender / Dungeon P2P / Pooled)</label>
        <input id="b-url" value="https://secrets.bitbop.dev/?uat=1" />
        <button id="btn-session" onclick="runBrowserSession()">Open in Headless Cloud Chromium & Snapshot</button>
        <button id="btn-ping" style="background:#1B1E24;color:#FFD600;margin-top:10px;" onclick="runPing()">Ping Container & Hermes Telemetry</button>
      </div>
    </div>

    <div class="card">
      <h2>Live Agent Output & Chromium Viewport</h2>
      <img id="shot" class="shot" alt="Cloud Chromium Viewport" />
      <pre id="out">${JSON.stringify(telemetry, null, 2)}</pre>
    </div>
  </div>
  <script>
    async function postReflect(payload, btnId) {
      const btn = document.getElementById(btnId);
      const out = document.getElementById('out');
      const shot = document.getElementById('shot');
      if (btn) btn.disabled = true;
      out.textContent = 'Dispatching to Google Cloud Run container (' + payload.action + ')...';
      try {
        const r = await fetch('/reflect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const d = await r.json();
        if (d.screenshot_b64) {
          shot.src = 'data:image/png;base64,' + d.screenshot_b64;
          shot.style.display = 'block';
          delete d.screenshot_b64;
        }
        out.textContent = JSON.stringify(d, null, 2);
      } catch (e) {
        out.textContent = 'Error: ' + e.message;
      } finally {
        if (btn) btn.disabled = false;
      }
    }
    function runHermes() {
      postReflect({
        action: 'hermes_uat',
        url: document.getElementById('h-url').value,
        password: document.getElementById('h-secret').value,
        unlockKey: document.getElementById('h-pin').value,
        model: document.getElementById('h-model').value,
        screenshot: true
      }, 'btn-hermes');
    }
    function runBrowserSession() {
      postReflect({
        action: 'browser_session',
        url: document.getElementById('b-url').value,
        screenshot: true
      }, 'btn-session');
    }
    function runPing() {
      postReflect({ action: 'ping' }, 'btn-ping');
    }
  </script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return;
  }

  const u = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/health')) {
    const telemetry = await getExternalTelemetry();
    const wantsHtml =
      u.pathname === '/' &&
      u.searchParams.get('format') !== 'json' &&
      String(req.headers.accept || '').includes('text/html');
    if (wantsHtml) {
      const html = renderConsoleHtml(telemetry);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    sendJson(res, 200, {
      status: 'ok',
      service: 'bitbop-cloudrun-agent-reflector',
      capabilities: ['ping', 'seal', 'claim', 'browser_seal', 'browser_claim', 'browser_session', 'hermes_uat'],
      hermes_config: HERMES_CONFIG,
      edge_telemetry: telemetry,
    });
    return;
  }

  if (req.method === 'POST' && (u.pathname === '/reflect' || u.pathname === '/api/reflect')) {
    if (REFLECTOR_TOKEN) {
      const provided =
        req.headers['x-reflector-token'] ||
        String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      if (provided !== REFLECTOR_TOKEN) {
        sendJson(res, 401, { ok: false, error: 'Unauthorized reflector token' });
        return;
      }
    }

    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const result = await handleReflect(parsed);
      sendJson(res, result.ok === false ? 422 : 200, result);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message || String(err) });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `[CloudRun-Reflector] Listening on http://0.0.0.0:${PORT} (Hermes provider=${HERMES_CONFIG.provider}, model=${HERMES_CONFIG.default_model}, endpoint=${HERMES_CONFIG.openai_base_url})`
  );
});
