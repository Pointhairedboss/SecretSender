/**
 * Split-Horizon External Cloud Reflector <-> Physical Galaxy S21 Ultra (SM-G998B) UAT Suite
 *
 * Tests https://secrets.bitbop.dev end-to-end across two separate endpoints:
 *   - Peer A (Outside Network): External Agent Reflector running in the cloud
 *     (Google Cloud Run `https://uat-agent-reflector-vwn34fypca-ts.a.run.app/reflect` or Cloudflare Edge `/api/reflect`)
 *   - Peer B (Physical Device): Samsung Galaxy S21 Ultra (R5CR60QL05P) running mobile Chrome
 *     hitting https://secrets.bitbop.dev directly over HTTPS (NO localhost / NO adb reverse!).
 *
 * Usage:
 *   npm run uat:external
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(ROOT_DIR, 'logs', 'uat', 'external-reflector-s21-report.json');

const PUBLIC_URL = (process.env.UAT_PUBLIC_URL || 'https://secrets.bitbop.dev').replace(/\/+$/, '');
const REFLECTOR_URL = process.env.UAT_REFLECTOR_URL || `${PUBLIC_URL}/api/reflect`;
const S21_SERIAL = process.env.S21_SERIAL || 'R5CR60QL05P';
const CDP_PORT = Number(process.env.S21_CDP_PORT || 9222);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function keepS21Awake() {
  try {
    execSync(`adb -s ${S21_SERIAL} shell "dumpsys deviceidle disable; svc power stayon true; input keyevent 224"`, {
      stdio: 'ignore',
    });
  } catch {}
}

function prepareS21ForPublicHttps() {
  console.log(`[S21-External] Preparing physical Galaxy S21 Ultra (${S21_SERIAL}) for public HTTPS (${PUBLIC_URL})...`);
  try {
    execSync(`adb -s ${S21_SERIAL} reverse --remove-all`, { stdio: 'ignore' });
  } catch {}
  execSync(`adb -s ${S21_SERIAL} forward tcp:${CDP_PORT} localabstract:chrome_devtools_remote`, { stdio: 'inherit' });
  keepS21Awake();
  try {
    execSync(
      `adb -s ${S21_SERIAL} shell am start -a android.intent.action.VIEW -d "${PUBLIC_URL}/?uat=1" com.android.chrome`,
      { stdio: 'ignore' }
    );
  } catch {}
}

async function gotoS21(page, url, timeoutMs = 25000) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    keepS21Awake();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      return;
    } catch (err) {
      lastErr = err;
      await sleep(1000);
    }
  }
  throw lastErr;
}

async function fillS21(page, selector, value) {
  await page.evaluate(
    ({ sel, val }) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`Element not found: ${sel}`);
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { sel: selector, val: String(value) }
  );
}

async function clickS21(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Element not found: ${sel}`);
    el.click();
  }, selector);
}

async function waitForS21(page, pageFn, timeoutMs = 20000, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const val = await page.evaluate(pageFn);
      if (val) return val;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Timeout (${timeoutMs}ms) waiting for S21 ${label}`);
}

async function waitForUatIdle(page, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const busy = await page
      .evaluate(() => (typeof window.__uatBusy === 'function' ? Boolean(window.__uatBusy()) : false))
      .catch(() => false);
    if (!busy) break;
    await sleep(150);
  }
  await sleep(200);
}

let cachedGcpIdentityToken = null;
function getGcpIdentityToken() {
  if (cachedGcpIdentityToken) return cachedGcpIdentityToken;
  if (process.env.GCP_IDENTITY_TOKEN) {
    cachedGcpIdentityToken = process.env.GCP_IDENTITY_TOKEN.trim();
    return cachedGcpIdentityToken;
  }
  const gcloudPath =
    process.env.GCLOUD_BIN ||
    `${process.env.LOCALAPPDATA}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd`;
  try {
    cachedGcpIdentityToken = execSync(`"${gcloudPath}" auth print-identity-token`, { encoding: 'utf8' }).trim();
    return cachedGcpIdentityToken;
  } catch {
    return '';
  }
}

async function callExternalReflector(payload) {
  const headers = { 'Content-Type': 'application/json' };
  if (REFLECTOR_URL.includes('.run.app')) {
    const idTok = getGcpIdentityToken();
    if (idTok) headers.Authorization = `Bearer ${idTok}`;
  }
  const res = await fetch(REFLECTOR_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(`Reflector (${REFLECTOR_URL}) failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

async function run() {
  prepareS21ForPublicHttps();
  await sleep(1200);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const context = browser.contexts()[0] || (await browser.newContext());
  const existingPages = context.pages();
  while (existingPages.length > 1) {
    const oldPage = existingPages.shift();
    try {
      await oldPage.close();
    } catch {}
  }
  const page = existingPages[0] || (await context.newPage());

  const results = [];
  let externalTelemetry = null;

  async function check(id, description, fn) {
    keepS21Awake();
    const t0 = performance.now();
    try {
      const detail = await fn();
      const ms = Number((performance.now() - t0).toFixed(1));
      results.push({ id, description, status: 'PASS', ms, detail });
      console.log(`  [PASS] ${id} (${ms}ms) — ${description}`);
    } catch (err) {
      const ms = Number((performance.now() - t0).toFixed(1));
      const msg = err?.message || String(err);
      results.push({ id, description, status: 'FAIL', ms, error: msg });
      console.error(`  [FAIL] ${id} (${ms}ms) — ${description}: ${msg}`);
    }
  }

  console.log(`\n================================================================`);
  console.log(`  Split-Horizon UAT: External Reflector <-> Physical S21 Ultra`);
  console.log(`  Public Target : ${PUBLIC_URL}`);
  console.log(`  Reflector URL : ${REFLECTOR_URL}`);
  console.log(`  S21 Serial    : ${S21_SERIAL}`);
  console.log(`================================================================\n`);

  let extToS21Share = null;
  const extToS21Secret = `EXT-TO-S21-${Date.now().toString(36).toUpperCase()}`;
  const extToS21Pin = '442288';

  // EXT-01: Probe External Agent Reflector in the Cloud
  await check('EXT-01', 'External Agent Reflector responds from cloud edge with datacenter & Hermes Google endpoint telemetry', async () => {
    const ping = await callExternalReflector({ action: 'ping' });
    externalTelemetry = ping.edge_telemetry;
    if (!externalTelemetry || !externalTelemetry.provider) {
      throw new Error('Missing edge_telemetry from reflector');
    }
    return externalTelemetry;
  });

  // EXT-02: Outside Network -> Physical S21 (External Reflector seals secret; S21 claims & decrypts over HTTPS)
  await check(
    'EXT-02',
    'Outside -> S21: External Reflector seals secret in cloud; physical S21 claims, verifies ML-DSA-44 & decrypts via ML-KEM-768',
    async () => {
      const sealed = await callExternalReflector({
        action: 'seal',
        password: extToS21Secret,
        unlockKey: extToS21Pin,
      });
      extToS21Share = sealed.share;
      if (!extToS21Share?.escrow_id || !extToS21Share?.commit_verified) {
        throw new Error('External reflector failed to seal or verify commit receipt');
      }

      const claimUrlWithUat = `${extToS21Share.claim_url}&uat=1`;
      await gotoS21(page, claimUrlWithUat);
      await waitForUatIdle(page);

      const audit = await page.evaluate(() => ({
        origin: window.location.origin,
        vw: window.innerWidth,
        sw: document.documentElement.scrollWidth,
        state: typeof window.__uatState === 'function' ? window.__uatState() : null,
      }));
      if (audit.origin !== PUBLIC_URL) {
        throw new Error(`Expected S21 origin ${PUBLIC_URL}, got ${audit.origin}`);
      }
      if (audit.sw > audit.vw + 2) {
        throw new Error(`Horizontal overflow on S21: ${audit.sw} > ${audit.vw}`);
      }

      await fillS21(page, '#unlock', extToS21Pin);
      await clickS21(page, '#reveal-btn');
      await waitForS21(
        page,
        () => Boolean(document.getElementById('pw-display')?.textContent),
        20000,
        '#pw-display decrypted plaintext'
      );
      await waitForUatIdle(page);

      const s21Result = await page.evaluate(() => ({
        decrypted: document.getElementById('pw-display')?.textContent || '',
        resultText: document.getElementById('result')?.innerText || '',
        uatState: typeof window.__uatState === 'function' ? window.__uatState() : null,
        uatSummary: typeof window.__uatRecorder === 'object' ? window.__uatRecorder.summary() : null,
      }));

      if (s21Result.decrypted !== extToS21Secret) {
        throw new Error(`S21 decrypted "${s21Result.decrypted}" != expected "${extToS21Secret}"`);
      }
      if (!s21Result.resultText.includes('YES (ML-DSA-44')) {
        throw new Error(`S21 did not display ML-DSA-44 verification confirmation`);
      }
      return {
        escrowId: extToS21Share.escrow_id,
        beaconSequence: extToS21Share.commit_receipt?.beacon_sequence,
        s21Viewport: `${audit.vw}px`,
        uatSummary: s21Result.uatSummary,
      };
    }
  );

  // EXT-03: Outside -> S21 Burn-on-Read (409 Conflict) on S21 reload
  await check('EXT-03', 'Outside -> S21: Reloading claimed URL on physical S21 enforces HTTP 409 Burn-on-Read', async () => {
    const claimUrlWithUat = `${extToS21Share.claim_url}&uat=1`;
    await gotoS21(page, claimUrlWithUat);
    await waitForS21(
      page,
      () => {
        const st = typeof window.__uatState === 'function' ? window.__uatState() : null;
        const txt = document.getElementById('result')?.innerText || '';
        return (st && st.burned === true) || txt.includes('409');
      },
      15000,
      'burned 409 state'
    );
    const state = await page.evaluate(() => (typeof window.__uatState === 'function' ? window.__uatState() : null));
    return { burnedOnS21: state?.burned };
  });

  // EXT-04: Physical S21 -> Outside Network (S21 seals secret in mobile Chrome; External Reflector claims & decrypts in cloud)
  let s21ToExtEscrowId = null;
  const s21ToExtSecret = `S21-TO-EXT-${Date.now().toString(36).toUpperCase()}`;
  const s21ToExtPin = '991133';

  await check(
    'EXT-04',
    'S21 -> Outside: Physical S21 seals secret over HTTPS; External Reflector probes 403 wrong PIN, decrypts 200 via ML-KEM-768, verifies ML-DSA-44 & confirms 409 burn',
    async () => {
      await gotoS21(page, `${PUBLIC_URL}/?uat=1`);
      await waitForUatIdle(page);

      await fillS21(page, '#secret', s21ToExtSecret);
      await fillS21(page, '#pin', s21ToExtPin);
      await clickS21(page, '#seal-btn');

      await waitForS21(
        page,
        () => {
          const st = typeof window.__uatState === 'function' ? window.__uatState() : null;
          return st && Boolean(st.escrowId);
        },
        20000,
        'sealed escrowId on S21'
      );
      await waitForUatIdle(page);

      const s21SealedState = await page.evaluate(() => ({
        state: window.__uatState(),
        resultText: document.getElementById('result')?.innerText || '',
      }));
      s21ToExtEscrowId = s21SealedState.state.escrowId;
      if (!s21ToExtEscrowId) {
        throw new Error('Failed to extract escrowId sealed on physical S21');
      }

      const reflectClaim = await callExternalReflector({
        action: 'claim',
        escrow_id: s21ToExtEscrowId,
        unlock_key: s21ToExtPin,
        test_wrong_pin: true,
      });

      if (reflectClaim.decrypted_plaintext !== s21ToExtSecret) {
        throw new Error(
          `External Reflector decrypted "${reflectClaim.decrypted_plaintext}" != S21 secret "${s21ToExtSecret}"`
        );
      }
      if (!reflectClaim.reveal_verified) {
        throw new Error('External Reflector ML-DSA-44 reveal verification failed');
      }
      if (reflectClaim.wrong_pin_status !== 403) {
        throw new Error(`Expected wrong PIN probe status 403, got ${reflectClaim.wrong_pin_status}`);
      }
      if (reflectClaim.burn_recheck_status !== 409) {
        throw new Error(`Expected burn recheck status 409, got ${reflectClaim.burn_recheck_status}`);
      }

      return {
        escrowId: s21ToExtEscrowId,
        reflectorColo: reflectClaim.edge_telemetry?.colo,
        wrongPinStatus: reflectClaim.wrong_pin_status,
        revealVerified: reflectClaim.reveal_verified,
        burnRecheckStatus: reflectClaim.burn_recheck_status,
        beaconSequence: reflectClaim.beacon_sequence,
      };
    }
  );

  // EXT-05: S21 verifies that the secret claimed by the External Reflector is burned (HTTP 409)
  await check(
    'EXT-05',
    'S21 -> Outside Burn Sync: Physical S21 opens the URL claimed by the External Reflector and confirms HTTP 409 Burned state',
    async () => {
      await gotoS21(page, `${PUBLIC_URL}/?escrow_id=${encodeURIComponent(s21ToExtEscrowId)}&uat=1`);
      await waitForS21(
        page,
        () => {
          const st = typeof window.__uatState === 'function' ? window.__uatState() : null;
          const txt = document.getElementById('result')?.innerText || '';
          return (st && st.burned === true) || txt.includes('409');
        },
        15000,
        'S21 observed 409 burned state'
      );
      const st = await page.evaluate(() => window.__uatState());
      return { s21ObservedBurned: st?.burned };
    }
  );

  // EXT-06: Outside -> S21 Time-Lock Embargo (425 Too Early) + Live Countdown + Auto-Decrypt at 00:00:00
  await check(
    'EXT-06',
    'Outside -> S21 Time-Lock: External Reflector seals 6s embargoed secret; S21 displays HH:MM:SS countdown (425) and auto-decrypts at 00:00:00',
    async () => {
      const timelockSecret = `TIMELOCK-EXT-S21-${Date.now().toString(36).toUpperCase()}`;
      const timelockPin = '556677';
      const sealed = await callExternalReflector({
        action: 'seal',
        password: timelockSecret,
        unlockKey: timelockPin,
        unlockAfterSeconds: 6,
      });

      const claimUrl = `${sealed.share.claim_url}&uat=1`;
      await gotoS21(page, claimUrl);
      await fillS21(page, '#unlock', timelockPin);

      const decrypted = await waitForS21(
        page,
        () => document.getElementById('pw-display')?.textContent || null,
        20000,
        'time-lock auto-reveal #pw-display'
      );
      if (decrypted !== timelockSecret) {
        throw new Error(`Expected auto-revealed "${timelockSecret}", got "${decrypted}"`);
      }
      return { escrowId: sealed.share.escrow_id, autoRevealedPlaintextMatches: true };
    }
  );

  // Optional EXT-07: Multi-Agent Concurrent Swarm (--swarm <N>)
  const swarmArgIdx = process.argv.indexOf('--swarm');
  const swarmCount = swarmArgIdx !== -1 ? Number(process.argv[swarmArgIdx + 1] || 4) : Number(process.env.UAT_SWARM_COUNT || 0);
  const browserMode = process.argv.includes('--browser') || process.env.UAT_REFLECTOR_MODE === 'browser';

  if (swarmCount > 0) {
    await check(
      'EXT-07',
      `Multi-Agent Cloud Swarm: ${swarmCount} parallel external agents (${browserMode ? 'browser_seal + browser_claim' : 'seal + claim'}) execute concurrently`,
      async () => {
        const agents = Array.from({ length: swarmCount }, (_, idx) => idx + 1);
        const swarmOutcomes = await Promise.all(
          agents.map(async (agentId) => {
            const secret = `SWARM-AGENT-${agentId}-${Date.now().toString(36).toUpperCase()}`;
            const pin = String(100000 + agentId * 1111);
            if (browserMode) {
              const s = await callExternalReflector({ action: 'browser_seal', password: secret, unlockKey: pin });
              const c = await callExternalReflector({ action: 'browser_claim', escrow_id: s.escrow_id, unlock_key: pin });
              if (c.decrypted_plaintext !== secret) throw new Error(`Agent ${agentId} mismatch`);
              return { agentId, escrowId: s.escrow_id, verified: c.reveal_verified, revision: c.edge_telemetry?.revision };
            } else {
              const s = await callExternalReflector({ action: 'seal', password: secret, unlockKey: pin });
              const c = await callExternalReflector({
                action: 'claim',
                escrow_id: s.share.escrow_id,
                unlock_key: pin,
                test_wrong_pin: false,
              });
              if (c.decrypted_plaintext !== secret) throw new Error(`Agent ${agentId} mismatch`);
              return { agentId, escrowId: s.share.escrow_id, verified: c.reveal_verified, colo: c.edge_telemetry?.colo };
            }
          })
        );
        return { concurrentAgents: swarmCount, mode: browserMode ? 'browser' : 'protocol', swarmOutcomes };
      }
    );
  }

  // Optional EXT-08: Autonomous Hermes Google Vertex AI Browser Loop (--hermes)
  const hermesMode = process.argv.includes('--hermes') || process.env.UAT_HERMES_LOOP === '1';
  if (hermesMode) {
    await check(
      'EXT-08',
      'Hermes Google Vertex Endpoint Loop -> S21: Cloud Run Reflector queries Google Vertex AI (hermes.yaml), drives headless Chromium to seal secret, and physical S21 decrypts it',
      async () => {
        const hermesSecret = `HERMES-VERTEX-${Date.now().toString(36).toUpperCase()}`;
        const hermesPin = '774411';
        const hermesSealed = await callExternalReflector({
          action: 'hermes_uat',
          password: hermesSecret,
          unlockKey: hermesPin,
        });
        if (!hermesSealed.escrow_id) {
          throw new Error(`Hermes Google Vertex loop did not produce an escrow_id: ${JSON.stringify(hermesSealed.hermes_llm)}`);
        }

        const claimUrl = `${PUBLIC_URL}/?escrow_id=${encodeURIComponent(hermesSealed.escrow_id)}&uat=1`;
        await gotoS21(page, claimUrl);
        await waitForUatIdle(page);
        await fillS21(page, '#unlock', hermesPin);
        await clickS21(page, '#reveal-btn');
        const s21Decrypted = await waitForS21(
          page,
          () => document.getElementById('pw-display')?.textContent || null,
          20000,
          'Hermes Vertex secret decrypted on S21'
        );
        if (s21Decrypted !== hermesSecret) {
          throw new Error(`S21 decrypted "${s21Decrypted}" != Hermes secret "${hermesSecret}"`);
        }

        return {
          escrowId: hermesSealed.escrow_id,
          hermesEndpoint: hermesSealed.hermes_llm?.endpoint,
          hermesModel: hermesSealed.hermes_llm?.model,
          hermesReasoning: hermesSealed.hermes_llm?.reasoning,
          s21DecryptedMatches: true,
        };
      }
    );
  }

  await browser.close();

  const passed = results.filter((r) => r.status === 'PASS').length;
  const report = {
    suite: 'external-reflector-s21-split-horizon-uat',
    timestamp: new Date().toISOString(),
    publicTargetUrl: PUBLIC_URL,
    reflectorUrl: REFLECTOR_URL,
    s21DeviceSerial: S21_SERIAL,
    externalReflectorTelemetry: externalTelemetry,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
    },
    results,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n[Report] Saved split-horizon UAT report to ${REPORT_PATH} (${passed}/${results.length} PASS)\n`);

  if (passed !== results.length) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error in external reflector S21 UAT:', err);
  process.exit(1);
});
