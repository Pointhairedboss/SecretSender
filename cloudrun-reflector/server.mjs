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
import net from 'node:net';
import { spawn } from 'node:child_process';
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

const TTYD_PORT = 7681;

function startTtydDaemon() {
  try {
    const xtermTheme = JSON.stringify({
      background: '#0B0C0E',
      foreground: '#F1F5F9',
      cursor: '#FFD600',
      selectionBackground: '#262932',
      black: '#0F1012',
      green: '#10B981',
      yellow: '#FFD600',
      blue: '#38BDF8',
      magenta: '#C084FC',
      cyan: '#2DD4BF',
      red: '#F87171',
    });
    const proc = spawn(
      'ttyd',
      [
        '-W',
        '-a',
        '-p',
        String(TTYD_PORT),
        '-b',
        '/terminal',
        '-t',
        'fontSize=14',
        '-t',
        'fontFamily=JetBrains Mono, Consolas, monospace',
        '-t',
        'cursorBlink=true',
        '-t',
        'cursorStyle=bar',
        '-t',
        `theme=${xtermTheme}`,
        '/app/start-hermes-shell.sh',
      ],
      {
        stdio: 'ignore',
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', HERMES_MODEL: 'gemini-3.8-flash' },
      }
    );
    proc.on('error', (err) => {
      console.warn('[ttyd] Not started:', err.message);
    });
    proc.unref();
  } catch (err) {
    console.warn('[ttyd] Spawn skipped:', err.message);
  }
}
startTtydDaemon();

/**
 * OpenAI-compatible /v1/chat/completions proxy for Hermes CLI inside the container.
 * Translates OpenAI messages[] + tools[] into Google Cloud Vertex AI generateContent
 * using the Cloud Run GCP Metadata Server OAuth token (billed to GCP credits on gen-lang-client-0057994039).
 */
async function handleVertexOpenAiChatCompletions(req, res) {
  const raw = await readBody(req);
  const body = raw ? JSON.parse(raw) : {};
  let requestedModel = String(body.model || 'gemini-3.8-flash').trim().replace(/^google\//, '');
  if (requestedModel === 'gemini-2.5-flash' || requestedModel === 'gemini-2.0-flash') {
    requestedModel = 'gemini-3.8-flash';
  }
  const modelName = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'].includes(requestedModel)
    ? requestedModel
    : 'gemini-3.8-flash';

  const metaRes = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000) }
  );
  if (!metaRes.ok) {
    sendJson(res, 500, { error: { message: `GCP Metadata token HTTP ${metaRes.status}` } });
    return;
  }
  const { access_token: bearerToken } = await metaRes.json();

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const systemParts = [];
  const contents = [];

  for (const m of messages) {
    const text =
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content.map((c) => c.text || JSON.stringify(c)).join('\n')
          : String(m.content ?? '');
    if (m.role === 'system' || m.role === 'developer') {
      if (text) systemParts.push({ text });
    } else if (m.role === 'assistant') {
      if (Array.isArray(m.vertex_parts) && m.vertex_parts.length > 0) {
        contents.push({ role: 'model', parts: m.vertex_parts });
      } else {
        const parts = [];
        if (text) parts.push({ text });
        if (Array.isArray(m.tool_calls)) {
          for (const tc of m.tool_calls) {
            let args = {};
            try {
              args = JSON.parse(tc.function?.arguments || '{}');
            } catch {}
            const fcPart = { functionCall: { name: tc.function?.name || 'tool', args } };
            if (tc.thought_signature) {
              fcPart.thoughtSignature = tc.thought_signature;
            }
            parts.push(fcPart);
          }
        }
        if (parts.length) contents.push({ role: 'model', parts });
      }
    } else if (m.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: m.name || 'tool_result',
              response: { result: text },
            },
          },
        ],
      });
    } else {
      contents.push({ role: 'user', parts: [{ text: text || ' ' }] });
    }
  }

  const vertexPayload = {
    contents: contents.length ? contents : [{ role: 'user', parts: [{ text: 'Hello' }] }],
    generationConfig: {
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.2,
      maxOutputTokens: Number(body.max_tokens || 4096),
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
    ],
  };
  if (systemParts.length) {
    vertexPayload.systemInstruction = { parts: systemParts };
  }
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    const fnDecls = body.tools
      .filter((t) => t.type === 'function' && t.function?.name)
      .map((t) => {
        const decl = {
          name: t.function.name,
          description: t.function.description || '',
        };
        if (t.function.parameters) {
          decl.parameters = t.function.parameters;
        }
        return decl;
      });
    if (fnDecls.length) {
      vertexPayload.tools = [{ functionDeclarations: fnDecls }];
    }
  }

  const endpoint = `https://aiplatform.googleapis.com/v1beta1/projects/gen-lang-client-0057994039/locations/global/publishers/google/models/${modelName}:generateContent`;
  const vRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearerToken}`,
      'x-goog-user-project': 'gen-lang-client-0057994039',
    },
    body: JSON.stringify(vertexPayload),
  });
  const vData = await vRes.json();
  if (!vRes.ok) {
    sendJson(res, vRes.status, { error: { message: JSON.stringify(vData) } });
    return;
  }

  const candidateParts = vData?.candidates?.[0]?.content?.parts || [];
  const textOut = candidateParts
    .filter((p) => typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
  const toolCalls = candidateParts
    .filter((p) => p.functionCall)
    .map((p, idx) => ({
      id: p.functionCall.id || `call_${Date.now()}_${idx}`,
      type: 'function',
      thought_signature: p.thoughtSignature || null,
      function: {
        name: p.functionCall.name,
        arguments: JSON.stringify(p.functionCall.args || {}),
      },
    }));

  const msgObj = {
    role: 'assistant',
    content: textOut || (toolCalls.length ? null : ''),
    vertex_parts: candidateParts,
  };
  if (toolCalls.length) {
    msgObj.tool_calls = toolCalls;
  }

  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  if (body.stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const chunk = {
      id,
      object: 'chat.completion.chunk',
      created,
      model: modelName,
      choices: [
        {
          index: 0,
          delta: msgObj,
          finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
        },
      ],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  sendJson(res, 200, {
    id,
    object: 'chat.completion',
    created,
    model: modelName,
    choices: [
      {
        index: 0,
        message: msgObj,
        finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
      },
    ],
    usage: {
      prompt_tokens: vData?.usageMetadata?.promptTokenCount || 0,
      completion_tokens: vData?.usageMetadata?.candidatesTokenCount || 0,
      total_tokens: vData?.usageMetadata?.totalTokenCount || 0,
    },
  });
}

function renderConsoleHtml(telemetry) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BitBop Ephemeral Cloud Agent & Hermes Terminal (GCP)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=JetBrains+Mono:wght@400;700&family=Space+Grotesk:wght@700&display=swap" rel="stylesheet" />
  <style>
    :root { --bg: #0F1012; --card: #16181D; --border: #262932; --gold: #FFD600; --emerald: #10B981; --text: #F1F5F9; --muted: #94A3B8; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; padding: 20px; }
    .wrap { max-width: 1120px; margin: 0 auto; }
    .hdr { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; border-bottom: 1px solid var(--border); padding-bottom: 14px; margin-bottom: 18px; }
    h1 { font-family: 'Space Grotesk', sans-serif; font-size: 1.3rem; text-transform: uppercase; letter-spacing: 0.06em; margin: 0; color: var(--gold); }
    .badge { font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; padding: 5px 10px; border-radius: 6px; background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.4); color: var(--emerald); }
    .term-card { background: #0B0C0E; border: 1.5px solid var(--gold); border-radius: 10px; padding: 12px; margin-bottom: 18px; box-shadow: 0 0 24px rgba(255, 214, 0, 0.12); }
    .term-hdr { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
    .term-hdr h2 { font-family: 'Space Grotesk', sans-serif; font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 0; color: var(--gold); }
    .term-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
    .chip-btn { margin: 0; width: auto; padding: 6px 11px; font-size: 0.74rem; border-radius: 6px; background: #16181D; color: var(--text); border: 1px solid var(--border); font-family: 'JetBrains Mono', monospace; text-transform: none; letter-spacing: 0; cursor: pointer; }
    .chip-btn:hover { border-color: var(--gold); color: var(--gold); background: #1B1E24; }
    .chip-btn.gold { background: rgba(255,214,0,0.14); border-color: var(--gold); color: var(--gold); font-weight: 700; }
    .btn-link { font-family: 'Space Grotesk', sans-serif; font-size: 0.78rem; font-weight: 700; text-transform: uppercase; padding: 6px 12px; border-radius: 6px; background: var(--gold); color: #1A1600; text-decoration: none; }
    iframe.term { width: 100%; height: 520px; border: 1px solid var(--border); border-radius: 8px; background: #0B0C0E; }
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
        <h1>BitBop Ephemeral Cloud Agent & Hermes Terminal</h1>
        <div style="font-size:0.82rem;color:var(--muted);margin-top:4px;">Scale-to-Zero Google Cloud Run (Interactive Hermes CLI + Playwright Chromium + Vertex AI)</div>
      </div>
      <div class="badge">● ${telemetry.colo} | Egress IP: ${telemetry.egressIp} | Rev: ${telemetry.revision}</div>
    </div>

    <div class="term-card">
      <div class="term-hdr">
        <h2>Interactive Hermes Terminal (Live PTY inside Google Cloud Run · Vertex AI)</h2>
        <a class="btn-link" href="/terminal/" target="_blank">Open Full-Screen Hermes Terminal ↗</a>
      </div>
      <div class="term-toolbar">
        <button class="chip-btn gold" onclick="injectTerm('/audit')">🛡️ Audit *.bitbop.dev Security/TLS</button>
        <button class="chip-btn" onclick="injectTerm('Inspect DNS CAA,SPF,DMARC and TLS 1.3 ciphers for bitbop.dev and secrets.bitbop.dev')">🔍 DNS & TLS 1.3 Check</button>
        <button class="chip-btn" onclick="injectTerm('/model gemini-3.8-flash')">⚡ Model: gemini-3.8-flash</button>
        <button class="chip-btn" onclick="injectTerm('/model gemini-3.5-flash-lite')">🚀 Model: gemini-3.5-flash-lite</button>
        <button class="chip-btn" onclick="injectTerm('/config')">📄 View hermes.yaml</button>
        <button class="chip-btn" onclick="injectTerm('/reset')">🔄 Reset Context (/reset)</button>
        <button class="chip-btn" onclick="injectTerm('/bash')">🐚 Drop to Bash (/bash)</button>
      </div>
      <iframe id="hermes-term-frame" class="term" src="/terminal/" allow="clipboard-read; clipboard-write"></iframe>
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
    async function injectTerm(cmd) {
      try {
        await fetch('/api/terminal-inject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: cmd })
        });
        const frame = document.getElementById('hermes-term-frame');
        if (frame && frame.contentWindow) frame.contentWindow.focus();
      } catch (e) {
        console.error('Inject error:', e);
      }
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

  if (req.method === 'POST' && u.pathname === '/api/terminal-inject') {
    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const cmd = String(parsed.command || '').trim();
      const cardId = String(parsed.cardId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
      if (cmd) {
        const targetFile = cardId ? `/tmp/hermes-inject-${cardId}.cmd` : '/tmp/hermes-inject.cmd';
        fs.writeFileSync(targetFile, cmd + '\n', 'utf8');
      }
      sendJson(res, 200, { ok: true, cardId: cardId || null, injected: cmd });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // Persistent Session Hydration API (/api/session-state)
  if (req.method === 'GET' && u.pathname === '/api/session-state') {
    try {
      const cardId = String(u.searchParams.get('cardId') || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
      if (cardId) {
        const file = `/tmp/hermes-session-${cardId}.json`;
        if (fs.existsSync(file)) {
          const state = JSON.parse(fs.readFileSync(file, 'utf8'));
          sendJson(res, 200, { ok: true, cardId, state });
        } else {
          sendJson(res, 200, { ok: true, cardId, state: null });
        }
        return;
      }
      const files = fs.readdirSync('/tmp').filter((f) => f.startsWith('hermes-session-') && f.endsWith('.json'));
      const sessions = {};
      for (const f of files) {
        try {
          const parsed = JSON.parse(fs.readFileSync(`/tmp/${f}`, 'utf8'));
          if (parsed && parsed.sessionId) {
            sessions[parsed.sessionId] = parsed;
          }
        } catch {}
      }
      sendJson(res, 200, { ok: true, sessions });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (req.method === 'POST' && u.pathname === '/api/session-state') {
    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const cardId = String(parsed.cardId || 'card-1').trim().replace(/[^a-zA-Z0-9_-]/g, '');
      fs.writeFileSync('/tmp/hermes-next-session-id', cardId, 'utf8');
      if (parsed.state && typeof parsed.state === 'object') {
        fs.writeFileSync(`/tmp/hermes-session-${cardId}.json`, JSON.stringify(parsed.state, null, 2), 'utf8');
      }
      sendJson(res, 200, { ok: true, cardId });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // Proxy /terminal* HTTP requests to ttyd on 127.0.0.1:7681
  if (u.pathname === '/terminal' || u.pathname.startsWith('/terminal/')) {
    if (u.pathname === '/terminal') {
      res.writeHead(302, { Location: '/terminal/' });
      res.end();
      return;
    }
    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: TTYD_PORT,
        path: u.pathname + u.search,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on('error', (err) => {
      sendJson(res, 502, { ok: false, error: `Hermes terminal daemon (ttyd) error: ${err.message}` });
    });
    req.pipe(proxyReq);
    return;
  }

  // OpenAI-compatible /v1/* endpoints for local Hermes CLI inside the container
  if (req.method === 'GET' && u.pathname === '/v1/models') {
    sendJson(res, 200, {
      object: 'list',
      data: [
        { id: 'gemini-3.8-flash', object: 'model', owned_by: 'google-vertex' },
        { id: 'gemini-3.5-flash', object: 'model', owned_by: 'google-vertex' },
        { id: 'gemini-3.5-flash-lite', object: 'model', owned_by: 'google-vertex' },
        { id: 'gemma-4-26b-a4b-it-maas', object: 'model', owned_by: 'google-vertex' },
      ],
    });
    return;
  }

  if (req.method === 'POST' && u.pathname === '/v1/chat/completions') {
    try {
      await handleVertexOpenAiChatCompletions(req, res);
    } catch (err) {
      sendJson(res, 500, { error: { message: err.message || String(err) } });
    }
    return;
  }

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
      capabilities: ['ping', 'seal', 'claim', 'browser_seal', 'browser_claim', 'browser_session', 'hermes_uat', 'terminal'],
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

// Proxy WebSocket upgrades (/terminal/ws) directly to ttyd on 127.0.0.1:7681
server.on('upgrade', (req, clientSocket, head) => {
  const u = new URL(req.url || '/', `http://localhost:${PORT}`);
  if (!u.pathname.startsWith('/terminal')) {
    clientSocket.destroy();
    return;
  }

  const upstream = net.connect(TTYD_PORT, '127.0.0.1', () => {
    let rawReq = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      rawReq += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    rawReq += '\r\n';
    upstream.write(rawReq);
    if (head && head.length) upstream.write(head);
    clientSocket.pipe(upstream).pipe(clientSocket);
  });

  upstream.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstream.destroy());
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `[CloudRun-Reflector] Listening on http://0.0.0.0:${PORT} (Hermes provider=${HERMES_CONFIG.provider}, model=${HERMES_CONFIG.default_model}, endpoint=${HERMES_CONFIG.openai_base_url})`
  );
});
