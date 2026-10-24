/**
 * Google Cloud Run — Universal External Agent Reflector (Playwright Chromium + WebRTC + ML-KEM-768 + Hermes Loop)
 *
 * Endpoints:
 *   - GET  /health   -> Container liveness & GCP metadata
 *   - POST /reflect  -> Executes external agent actions:
 *       1. action: "ping"             -> Returns GCP region, revision, and external egress IP telemetry
 *       2. action: "seal"             -> Seals a secret on SecretSender from GCP network (protocol mode)
 *       3. action: "claim"            -> Claims & decrypts a secret from GCP network via ML-KEM-768 + WebCrypto
 *       4. action: "browser_seal"     -> Launches real headless Chromium in GCP, seals secret via real DOM + __uatRecorder
 *       5. action: "browser_claim"    -> Launches real headless Chromium in GCP, claims & decrypts secret via real DOM + __uatRecorder
 *       6. action: "browser_session"  -> Runs an interactive/scripted or Hermes LLM-driven Playwright session on ANY URL
 *                                        (e.g. dungeon.bitbop.dev P2P room, pooled.run, secrets.bitbop.dev)
 */

import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import { MlKem768 } from 'mlkem';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT || 8080);
const SECRETSENDER_ORIGIN = (process.env.SECRETSENDER_ORIGIN || 'https://secrets.bitbop.dev').replace(/\/+$/, '');
const BITBOP_API_BASE = (process.env.BITBOP_API_BASE || 'https://api.bitbop.dev').replace(/\/+$/, '');
const REFLECTOR_TOKEN = process.env.REFLECTOR_TOKEN ? process.env.REFLECTOR_TOKEN.trim() : '';

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
    timestamp: new Date().toISOString(),
  };
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
    return { ok: true, action: 'ping', edge_telemetry: telemetry };
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

  throw new Error(`Unsupported reflector action: ${action}`);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return;
  }

  const u = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/health')) {
    const telemetry = await getExternalTelemetry();
    sendJson(res, 200, {
      status: 'ok',
      service: 'bitbop-cloudrun-agent-reflector',
      capabilities: ['ping', 'seal', 'claim', 'browser_seal', 'browser_claim', 'browser_session'],
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
  console.log(`[CloudRun-Reflector] Listening on http://0.0.0.0:${PORT}`);
});
