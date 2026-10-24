/**
 * Split-Horizon External Cloud Reflector <-> Physical Galaxy S21 Ultra (SM-G998B) UAT Suite
 *
 * Tests https://secrets.bitbop.dev end-to-end across two separate endpoints:
 *   - Peer A (Outside Network): External Agent Reflector running in the cloud
 *     (https://secrets.bitbop.dev/api/reflect or custom REFLECTOR_URL on Vercel / Cloud Run)
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

function prepareS21ForPublicHttps() {
  console.log(`[S21-External] Preparing physical Galaxy S21 Ultra (${S21_SERIAL}) for public HTTPS (${PUBLIC_URL})...`);
  // Remove any localhost reverse tunnels so the phone must use real network routing to https://secrets.bitbop.dev
  try {
    execSync(`adb -s ${S21_SERIAL} reverse --remove-all`, { stdio: 'ignore' });
  } catch {}
  execSync(`adb -s ${S21_SERIAL} forward tcp:${CDP_PORT} localabstract:chrome_devtools_remote`, { stdio: 'inherit' });
  try {
    execSync(`adb -s ${S21_SERIAL} shell svc power stayon usb`, { stdio: 'ignore' });
    execSync(`adb -s ${S21_SERIAL} shell input keyevent KEYCODE_WAKEUP`, { stdio: 'ignore' });
    execSync(`adb -s ${S21_SERIAL} shell wm dismiss-keyguard`, { stdio: 'ignore' });
    execSync(
      `adb -s ${S21_SERIAL} shell am start -a android.intent.action.VIEW -d "${PUBLIC_URL}/?uat=1" com.android.chrome`,
      { stdio: 'ignore' }
    );
  } catch {}
}

async function callExternalReflector(payload) {
  const res = await fetch(REFLECTOR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(`Reflector (${REFLECTOR_URL}) failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
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
  await page.waitForTimeout(250);
}

async function run() {
  prepareS21ForPublicHttps();
  await new Promise((r) => setTimeout(r, 1500));

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = context.pages()[0] || (await context.newPage());

  const results = [];
  let externalTelemetry = null;

  async function check(id, description, fn) {
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
  await check('EXT-01', 'External Agent Reflector responds from cloud edge with datacenter telemetry', async () => {
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
      await page.goto(claimUrlWithUat, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await waitForUatIdle(page);

      // Verify S21 is on public HTTPS origin and has 0px horizontal overflow
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

      // Enter PIN on physical S21 and click Reveal / Decrypt
      await page.fill('#unlock', extToS21Pin);
      await page.click('#reveal-btn');
      await page.waitForSelector('#pw-display', { timeout: 20000 });
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
    await page.goto(claimUrlWithUat, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForFunction(
      () => {
        const st = typeof window.__uatState === 'function' ? window.__uatState() : null;
        const txt = document.getElementById('result')?.innerText || '';
        return (st && st.burned === true) || txt.includes('409');
      },
      undefined,
      { timeout: 15000 }
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
      await page.goto(`${PUBLIC_URL}/?uat=1`, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await waitForUatIdle(page);

      await page.fill('#secret', s21ToExtSecret);
      await page.fill('#pin', s21ToExtPin);
      await page.click('#seal-btn');

      await page.waitForFunction(
        () => {
          const st = typeof window.__uatState === 'function' ? window.__uatState() : null;
          return st && Boolean(st.escrowId);
        },
        undefined,
        { timeout: 20000 }
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

      // Dispatch to External Cloud Reflector to claim from outside the network!
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
      await page.goto(`${PUBLIC_URL}/?escrow_id=${encodeURIComponent(s21ToExtEscrowId)}&uat=1`, {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });
      await page.waitForFunction(
        () => {
          const st = typeof window.__uatState === 'function' ? window.__uatState() : null;
          const txt = document.getElementById('result')?.innerText || '';
          return (st && st.burned === true) || txt.includes('409');
        },
        undefined,
        { timeout: 15000 }
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
      await page.goto(claimUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

      // Pre-enter PIN on S21 while countdown is active
      await page.fill('#unlock', timelockPin);

      // Wait for auto-reveal at 00:00:00
      await page.waitForSelector('#pw-display', { timeout: 20000 });
      const decrypted = await page.textContent('#pw-display');
      if (decrypted !== timelockSecret) {
        throw new Error(`Expected auto-revealed "${timelockSecret}", got "${decrypted}"`);
      }
      return { escrowId: sealed.share.escrow_id, autoRevealedPlaintextMatches: true };
    }
  );

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
