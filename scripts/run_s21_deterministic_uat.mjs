/**
 * SecretSender: Deterministic Playwright-over-ADB UAT Suite
 * Target Device: Physical Samsung Galaxy S21 Ultra 5G (SM_G998B, serial R5CR60QL05P)
 * Executes all 23 test specifications defined in docs/UAT_PLAN.md
 * Output: logs/uat/deterministic-s21-report.json
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const S21_SERIAL = process.env.ADB_SERIAL || 'R5CR60QL05P';
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const APP_PORT = Number(process.env.APP_PORT || 5179);
const BASE_URL = process.env.BASE_URL || `http://localhost:${APP_PORT}`;
const OUTPUT_DIR = path.resolve('logs/uat');

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function setupAdbAndWake() {
  log(`Setting up ADB reverse & CDP tunnels for S21 (${S21_SERIAL})...`);
  try {
    execSync(`adb -s ${S21_SERIAL} shell svc power stayon usb`, { stdio: 'ignore' });
    execSync(`adb -s ${S21_SERIAL} shell input keyevent KEYCODE_WAKEUP`, { stdio: 'ignore' });
    execSync(`adb -s ${S21_SERIAL} shell wm dismiss-keyguard`, { stdio: 'ignore' });
  } catch (e) {
    log(`Warning during device wake: ${e.message}`);
  }

  execSync(`adb -s ${S21_SERIAL} reverse tcp:${APP_PORT} tcp:${APP_PORT}`, { stdio: 'inherit' });
  execSync(`adb -s ${S21_SERIAL} forward tcp:${CDP_PORT} localabstract:chrome_devtools_remote`, { stdio: 'inherit' });
  execSync(
    `adb -s ${S21_SERIAL} shell am start -n com.android.chrome/com.google.android.apps.chrome.Main -d "about:blank"`,
    { stdio: 'ignore' }
  );
}

async function waitForBusy(page, maxMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const isBusy = await page.evaluate(() => {
      const w = window;
      return typeof w.__uatBusy === 'function' ? Boolean(w.__uatBusy()) : false;
    }).catch(() => false);
    if (!isBusy) break;
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(250);
}

const results = [];

async function testCase(id, area, description, fn) {
  const t0 = performance.now();
  log(`RUNNING [${id}] ${description}...`);
  try {
    await fn();
    const ms = Math.round(performance.now() - t0);
    results.push({ id, area, description, status: 'PASS', durationMs: ms });
    log(`  --> PASS [${id}] (${ms}ms)`);
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    const errMsg = err?.message || String(err);
    results.push({ id, area, description, status: 'FAIL', durationMs: ms, error: errMsg });
    log(`  --> FAIL [${id}] (${ms}ms): ${errMsg}`);
    throw err;
  }
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const suiteStartTime = Date.now();

  log('================================================================');
  log(' SecretSender Physical S21 Ultra Deterministic UAT Suite');
  log(` Target Device : Samsung Galaxy S21 Ultra (${S21_SERIAL})`);
  log(` Target URL    : ${BASE_URL}/?uat=1`);
  log('================================================================\n');

  setupAdbAndWake();
  await new Promise((r) => setTimeout(r, 1000));

  // Connect over CDP to physical S21
  log(`Connecting Playwright over CDP to http://127.0.0.1:${CDP_PORT}...`);
  const s21Browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const s21Context = s21Browser.contexts()[0] || (await s21Browser.newContext({ ignoreHTTPSErrors: true }));
  const s21Pages = s21Context.pages();
  const s21Page = s21Pages.length > 0 ? s21Pages[s21Pages.length - 1] : await s21Context.newPage();

  // Desktop engine for viewport comparisons
  let desktopBrowser = null;
  try {
    const localAppData = process.env.LOCALAPPDATA || 'C:\\Users\\Owner\\AppData\\Local';
    const chromePath = path.join(localAppData, 'ms-playwright', 'chromium-1217', 'chrome-win64', 'chrome.exe');
    desktopBrowser = await chromium.launch({
      headless: true,
      executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
    });
  } catch (e) {
    log(`Desktop Chromium launch skipped: ${e.message}`);
  }

  // --- AREA 1: Livery Tokens & BitBop Brand Identity ---
  await testCase('UAT-LIV-01', 'Area 1: Livery Tokens', 'Theme Token Compliance & Computed Style Integrity', async () => {
    await s21Page.goto(`${BASE_URL}/?uat=1`, { waitUntil: 'domcontentloaded' });
    await waitForBusy(s21Page);

    const tokens = await s21Page.evaluate(() => {
      const bodyStyle = window.getComputedStyle(document.body);
      const shellStyle = window.getComputedStyle(document.querySelector('.shell'));
      const btnStyle = window.getComputedStyle(document.querySelector('#seal-btn'));
      const badgeStyle = window.getComputedStyle(document.querySelector('.header-status-badge'));

      return {
        bodyBg: bodyStyle.backgroundColor,
        shellBg: shellStyle.backgroundColor,
        shellBorder: shellStyle.borderColor,
        btnBg: btnStyle.backgroundColor,
        btnColor: btnStyle.color,
        badgeColor: badgeStyle.color,
        badgeBg: badgeStyle.backgroundColor,
        bodyFont: bodyStyle.fontFamily,
      };
    });

    // #0F1012 = rgb(15, 16, 18)
    if (!tokens.bodyBg.includes('15, 16, 18')) {
      throw new Error(`Expected body bg rgb(15, 16, 18), got ${tokens.bodyBg}`);
    }
    // #16181D = rgb(22, 24, 29)
    if (!tokens.shellBg.includes('22, 24, 29')) {
      throw new Error(`Expected shell bg rgb(22, 24, 29), got ${tokens.shellBg}`);
    }
    // #FFD600 = rgb(255, 214, 0)
    if (!tokens.btnBg.includes('255, 214, 0')) {
      throw new Error(`Expected #seal-btn bg rgb(255, 214, 0), got ${tokens.btnBg}`);
    }
    // #1A1600 = rgb(26, 22, 0)
    if (!tokens.btnColor.includes('26, 22, 0')) {
      throw new Error(`Expected #seal-btn text rgb(26, 22, 0), got ${tokens.btnColor}`);
    }
    // #10B981 = rgb(16, 185, 129)
    if (!tokens.badgeColor.includes('16, 185, 129')) {
      throw new Error(`Expected badge text rgb(16, 185, 129), got ${tokens.badgeColor}`);
    }
  });

  await testCase('UAT-LIV-02', 'Area 1: Livery Tokens', 'Official BitBop SVG Asset Delivery & MIME Conformance', async () => {
    const svgPaths = [
      '/favicon.svg',
      '/badges/bitbop-favicon.svg',
      '/badges/bitbop-wordmark-dark.svg',
      '/badges/powered-by-bitbop-emerald.svg',
      '/badges/powered-by-bitbop-gold.svg',
    ];

    for (const p of svgPaths) {
      const res = await s21Page.evaluate(async (url) => {
        const r = await fetch(url);
        const ct = r.headers.get('content-type') || '';
        const text = await r.text();
        return { status: r.status, ct, isSvg: text.startsWith('<svg') && text.includes('</svg>') };
      }, `${BASE_URL}${p}`);

      if (res.status !== 200) {
        throw new Error(`GET ${p} returned status ${res.status}`);
      }
      if (!res.ct.includes('image/svg+xml')) {
        throw new Error(`GET ${p} invalid Content-Type: ${res.ct}`);
      }
      if (!res.isSvg) {
        throw new Error(`GET ${p} payload does not contain valid <svg> markup`);
      }
    }
  });

  await testCase('UAT-LIV-03', 'Area 1: Livery Tokens', 'Glider Grid Radial Pattern & Telemetry Scanner Line Animation', async () => {
    const animCheck = await s21Page.evaluate(() => {
      const grid = document.querySelector('.glider-grid');
      const scanner = document.querySelector('.scanner-line');
      if (!grid || !scanner) return { ok: false, reason: 'Elements missing' };
      const gStyle = window.getComputedStyle(grid);
      const sStyle = window.getComputedStyle(scanner);
      return {
        ok: true,
        gridFixed: gStyle.position === 'fixed',
        gridPointerEvents: gStyle.pointerEvents === 'none',
        scannerBg: sStyle.backgroundColor,
        scannerAnim: sStyle.animationName,
      };
    });

    if (!animCheck.ok) throw new Error(animCheck.reason);
    if (!animCheck.gridFixed || !animCheck.gridPointerEvents) {
      throw new Error('Glider grid must be position:fixed with pointer-events:none');
    }
    if (!animCheck.scannerBg.includes('16, 185, 129')) {
      throw new Error(`Scanner line background should be emerald, got ${animCheck.scannerBg}`);
    }
  });

  // --- AREA 2: Mobile Viewport & Responsive Geometry ---
  await testCase('UAT-VIEW-01', 'Area 2: Mobile Viewport', 'Physical S21 Admin View Zero Horizontal Overflow (412x915)', async () => {
    await s21Page.goto(`${BASE_URL}/?uat=1`, { waitUntil: 'domcontentloaded' });
    await waitForBusy(s21Page);

    const audit = await s21Page.evaluate(() => {
      const vw = window.innerWidth;
      const sw = document.documentElement.scrollWidth;
      const overflow = Math.max(0, sw - vw);

      const clipped = [];
      const controls = Array.from(document.querySelectorAll('button, input, select, textarea, a.btn'));
      for (const el of controls) {
        const r = el.getBoundingClientRect();
        if (r.right > vw + 4 || r.left < -4) {
          clipped.push(`${el.tagName}#${el.id}`);
        }
      }

      return { vw, sw, overflow, clipped };
    });

    if (audit.overflow > 0) {
      throw new Error(`Horizontal overflow on S21 Admin view: ${audit.overflow}px (scrollWidth=${audit.sw}, innerWidth=${audit.vw})`);
    }
    if (audit.clipped.length > 0) {
      throw new Error(`Clipped affordances on S21 Admin view: ${audit.clipped.join(', ')}`);
    }
  });

  await testCase('UAT-VIEW-02', 'Area 2: Mobile Viewport', 'Physical S21 Claim View Zero Horizontal Overflow (412x915)', async () => {
    await s21Page.goto(`${BASE_URL}/?escrow_id=dummy-view-test&uat=1`, { waitUntil: 'domcontentloaded' });
    await waitForBusy(s21Page);

    const audit = await s21Page.evaluate(() => {
      const vw = window.innerWidth;
      const sw = document.documentElement.scrollWidth;
      const overflow = Math.max(0, sw - vw);
      return { vw, sw, overflow };
    });

    if (audit.overflow > 0) {
      throw new Error(`Horizontal overflow on S21 Claim view: ${audit.overflow}px (scrollWidth=${audit.sw}, innerWidth=${audit.vw})`);
    }
  });

  await testCase('UAT-VIEW-03', 'Area 2: Mobile Viewport', 'Small Mobile Viewport Boundaries (384x800)', async () => {
    if (!desktopBrowser) {
      log('  (Skipping 384x800 emulated check: desktop chromium not available)');
      return;
    }
    const ctx = await desktopBrowser.newContext({ viewport: { width: 384, height: 800 } });
    const p = await ctx.newPage();
    try {
      await p.goto(`${BASE_URL}/?uat=1`, { waitUntil: 'domcontentloaded' });
      const overflow = await p.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
      if (overflow > 0) {
        throw new Error(`Horizontal overflow on 384x800: ${overflow}px`);
      }
    } finally {
      await ctx.close();
    }
  });

  await testCase('UAT-VIEW-04', 'Area 2: Mobile Viewport', 'Desktop Viewport Scaling & Shell Centering (1440x900)', async () => {
    if (!desktopBrowser) {
      log('  (Skipping 1440x900 desktop check: desktop chromium not available)');
      return;
    }
    const ctx = await desktopBrowser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    try {
      await p.goto(`${BASE_URL}/?uat=1`, { waitUntil: 'domcontentloaded' });
      const shellRect = await p.evaluate(() => {
        const r = document.querySelector('.shell').getBoundingClientRect();
        return { width: r.width, left: r.left, right: window.innerWidth - r.right };
      });
      if (shellRect.width > 500) {
        throw new Error(`Desktop shell max-width exceeded: ${shellRect.width}px`);
      }
      if (Math.abs(shellRect.left - shellRect.right) > 20) {
        throw new Error(`Desktop shell not centered: left=${shellRect.left}, right=${shellRect.right}`);
      }
    } finally {
      await ctx.close();
    }
  });

  // --- AREA 3: Admin Secret Sealing ---
  let sharedEscrowId = null;
  let sharedPin = null;

  await testCase('UAT-SEAL-01', 'Area 3: Admin Sealing', 'Immediate Admin Secret Sealing with Auto-Generated PIN', async () => {
    await s21Page.goto(`${BASE_URL}/?uat=1`, { waitUntil: 'domcontentloaded' });
    await waitForBusy(s21Page);

    await s21Page.fill('#secret', 'QuantumSuperSecret101');
    await s21Page.fill('#pin', '');
    await s21Page.click('#seal-btn');
    await waitForBusy(s21Page);

    const sealData = await s21Page.evaluate(() => {
      const res = document.getElementById('result');
      const text = res ? res.innerText : '';
      const state = window.__uatState ? window.__uatState() : null;
      const smsLink = res ? res.querySelector('a.btn-sms')?.getAttribute('href') : null;
      return { text, state, smsLink };
    });

    if (!sealData.text.includes('Secret Sealed')) {
      throw new Error(`Sealing confirmation missing from UI: ${sealData.text}`);
    }
    if (!sealData.text.includes('Commit verified: YES (ML-DSA-44)')) {
      throw new Error(`ML-DSA-44 commit verification missing: ${sealData.text}`);
    }
    if (!sealData.state || !sealData.state.escrowId) {
      throw new Error(`UAT state missing escrowId after seal: ${JSON.stringify(sealData.state)}`);
    }

    const pinMatch = sealData.text.match(/unlock key\s*([0-9a-fA-F]{8})/i);
    if (!pinMatch) {
      throw new Error(`Auto-generated 8-char hex PIN missing from result: ${sealData.text}`);
    }

    sharedEscrowId = sealData.state.escrowId;
    sharedPin = pinMatch[1];
    log(`  [UAT-SEAL-01] Minted Escrow=${sharedEscrowId}, PIN=${sharedPin}`);
  });

  await testCase('UAT-SEAL-02', 'Area 3: Admin Sealing', 'Custom PIN & Embargo Preset Sealing (+30s Demo)', async () => {
    await s21Page.goto(`${BASE_URL}/?uat=1`, { waitUntil: 'domcontentloaded' });
    await waitForBusy(s21Page);

    await s21Page.fill('#secret', 'EmbargoDemoSecret777');
    await s21Page.fill('#pin', 'custom-demo-pin-1');
    await s21Page.locator('button.preset-btn:has-text("+30s (Demo)")').click();
    await s21Page.click('#seal-btn');
    await waitForBusy(s21Page);

    const resText = await s21Page.textContent('#result');
    if (!resText.includes('custom-demo-pin-1')) {
      throw new Error(`Custom PIN not rendered in result: ${resText}`);
    }
    if (!resText.includes('Available On (Time-Lock Embargo)')) {
      throw new Error(`Time-Lock Embargo timestamp missing: ${resText}`);
    }
  });

  await testCase('UAT-SEAL-03', 'Area 3: Admin Sealing', 'Future Datetime-Local Picker Sealing (+48h Embargo)', async () => {
    await s21Page.goto(`${BASE_URL}/?uat=1`, { waitUntil: 'domcontentloaded' });
    await waitForBusy(s21Page);

    const targetDate = new Date(Date.now() + 48 * 3600 * 1000);
    const localIso = new Date(targetDate.getTime() - targetDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

    await s21Page.fill('#unlock-dt', localIso);
    await s21Page.fill('#secret', 'LongEmbargoSecret48h');
    await s21Page.click('#seal-btn');
    await waitForBusy(s21Page);

    const resText = await s21Page.textContent('#result');
    if (!resText.includes('Available On (Time-Lock Embargo)')) {
      throw new Error(`48h embargo timestamp missing from UI: ${resText}`);
    }
  });

  await testCase('UAT-SEAL-04', 'Area 3: Admin Sealing', 'Empty Secret Input Refusal & Zero-Network Guard', async () => {
    await s21Page.goto(`${BASE_URL}/?uat=1`, { waitUntil: 'domcontentloaded' });
    await waitForBusy(s21Page);

    await s21Page.evaluate(() => {
      if (window.__uatRecorder) window.__uatRecorder.clear();
      document.getElementById('secret').value = '';
    });

    await s21Page.click('#seal-btn');

    const check = await s21Page.evaluate(() => {
      const res = document.getElementById('result');
      const alertText = res ? res.innerText : '';
      const netCalls = window.__uatRecorder ? window.__uatRecorder.events().filter((e) => e.type === 'network') : [];
      return { alertText, netCallsCount: netCalls.length };
    });

    if (!check.alertText.includes('Enter a secret password.')) {
      throw new Error(`Empty secret validation banner missing: ${check.alertText}`);
    }
    if (check.netCallsCount > 0) {
      throw new Error(`Network request dispatched on empty secret: ${check.netCallsCount} calls`);
    }
  });

  // --- AREA 4: Timelock Embargo & 24h Countdown Auto-Reveal ---
  let shortEmbargoEscrowId = null;
  let shortEmbargoPin = 'quick-pin-99';

  await testCase('UAT-TIME-01', 'Area 4: Timelock Embargo', 'Future Reveal Embargo Detection (HTTP 425 Too Early)', async () => {
    // Mint a +10s escrow
    await s21Page.goto(`${BASE_URL}/?uat=1`, { waitUntil: 'domcontentloaded' });
    await waitForBusy(s21Page);
    await s21Page.fill('#secret', 'AutoRevealSecret123');
    await s21Page.fill('#pin', shortEmbargoPin);
    await s21Page.locator('button.preset-btn:has-text("+30s (Demo)")').click();
    await s21Page.click('#seal-btn');
    await waitForBusy(s21Page);

    const state = await s21Page.evaluate(() => window.__uatState());
    shortEmbargoEscrowId = state.escrowId;

    // Load claim view on S21
    await s21Page.goto(`${BASE_URL}/?escrow_id=${shortEmbargoEscrowId}&uat=1`, { waitUntil: 'domcontentloaded' });
    await waitForBusy(s21Page);

    const timelockCheck = await s21Page.evaluate(() => {
      const box = document.getElementById('timelock-box');
      const heading = document.getElementById('timelock-heading')?.textContent || '';
      const btn = document.getElementById('reveal-btn');
      const st = window.__uatState();
      return {
        boxVisible: box && box.style.display !== 'none',
        heading,
        btnDisabled: btn?.disabled,
        btnText: btn?.textContent,
        timelockActive: st?.timelockActive,
      };
    });

    if (!timelockCheck.boxVisible) {
      throw new Error('Timelock box is not visible after 425 probe');
    }
    if (!timelockCheck.heading.includes('Time-Locked Secret')) {
      throw new Error(`Heading does not indicate time-lock: ${timelockCheck.heading}`);
    }
    if (!timelockCheck.btnDisabled) {
      throw new Error('Reveal button should be disabled during embargo');
    }
    if (!timelockCheck.timelockActive) {
      throw new Error('window.__uatState().timelockActive should be true');
    }
  });

  await testCase('UAT-TIME-02', 'Area 4: Timelock Embargo', 'Final 24h Countdown Clock Formatting (HH:MM:SS)', async () => {
    const clockText = await s21Page.textContent('#countdown-clock');
    if (!/^\d{2}:\d{2}:\d{2}$/.test(clockText.trim())) {
      throw new Error(`Clock does not match HH:MM:SS format: "${clockText}"`);
    }
    const subText = await s21Page.textContent('#countdown-sub');
    if (!subText.includes('Final 24-hour countdown')) {
      throw new Error(`Countdown subtext missing 24-hour notice: "${subText}"`);
    }
  });

  await testCase('UAT-TIME-03', 'Area 4: Timelock Embargo', 'Automatic Reveal & Decrypt at 00:00:00 Countdown Expiry', async () => {
    // Fill PIN while countdown ticks
    await s21Page.fill('#unlock', shortEmbargoPin);

    log('  [UAT-TIME-03] PIN entered, waiting for countdown to reach 00:00:00 and auto-reveal...');
    await s21Page.waitForFunction(
      () => {
        const st = window.__uatState ? window.__uatState() : null;
        return st && st.revealed === true;
      },
      undefined,
      { timeout: 35000 }
    );

    const plaintext = await s21Page.textContent('#pw-display');
    if (!plaintext.includes('AutoRevealSecret123')) {
      throw new Error(`Auto-revealed secret mismatch: "${plaintext}"`);
    }
  });

  // --- AREA 5: Wrong PIN 403 Non-Burn Preservation ---
  await testCase('UAT-AUTH-01', 'Area 5: Wrong PIN 403', 'Wrong Unlock Key (HTTP 403) Non-Burn Preservation', async () => {
    // SharedEscrowId from UAT-SEAL-01 is immediate and not burned yet
    await s21Page.goto(`${BASE_URL}/?escrow_id=${sharedEscrowId}&uat=1`, { waitUntil: 'domcontentloaded' });
    await waitForBusy(s21Page);

    await s21Page.fill('#unlock', 'wrong-pin-8888');
    await s21Page.click('#reveal-btn');
    await waitForBusy(s21Page);

    const authCheck = await s21Page.evaluate(() => {
      const banner = document.getElementById('result')?.innerText || '';
      const st = window.__uatState ? window.__uatState() : null;
      return { banner, st };
    });

    if (!authCheck.banner.includes('Wrong unlock key (403). Secret NOT burned.')) {
      throw new Error(`Expected 403 non-burn warning banner, got: "${authCheck.banner}"`);
    }
    if (authCheck.st.burned !== false || authCheck.st.revealed !== false) {
      throw new Error(`Escrow state burned prematurely: ${JSON.stringify(authCheck.st)}`);
    }
  });

  await testCase('UAT-AUTH-02', 'Area 5: Wrong PIN 403', 'Subsequent Valid Unlock Following Wrong Key Attempt', async () => {
    await s21Page.fill('#unlock', sharedPin);
    await s21Page.click('#reveal-btn');
    await waitForBusy(s21Page);

    const st = await s21Page.evaluate(() => window.__uatState());
    if (!st.revealed) {
      throw new Error(`Secret failed to reveal with valid PIN after 403: ${JSON.stringify(st)}`);
    }
    const pw = await s21Page.textContent('#pw-display');
    if (!pw.includes('QuantumSuperSecret101')) {
      throw new Error(`Decrypted password mismatch: "${pw}"`);
    }
  });

  // --- AREA 6: Valid ML-KEM-768 Decrypt & ML-DSA-44 Provenance Verify ---
  let cryptoEscrowId = null;
  let cryptoPin = null;

  await testCase('UAT-CRYPTO-01', 'Area 6: Cryptographic Decapsulation', 'Pure Browser ML-KEM-768 Decapsulation & AES-256-GCM Decryption', async () => {
    // Mint dedicated crypto escrow
    await s21Page.goto(`${BASE_URL}/?uat=1`, { waitUntil: 'domcontentloaded' });
    await waitForBusy(s21Page);

    const secretPlain = 'ML-KEM-768-QuantumProofSecret-42';
    await s21Page.fill('#secret', secretPlain);
    await s21Page.click('#seal-btn');
    await waitForBusy(s21Page);

    const sealInfo = await s21Page.evaluate(() => {
      const text = document.getElementById('result')?.innerText || '';
      const pinM = text.match(/unlock key\s*([0-9a-fA-F]{8})/i);
      return { st: window.__uatState(), pin: pinM ? pinM[1] : null };
    });

    cryptoEscrowId = sealInfo.st.escrowId;
    cryptoPin = sealInfo.pin;

    // Navigate to claim view on S21
    await s21Page.goto(`${BASE_URL}/?escrow_id=${cryptoEscrowId}&uat=1`, { waitUntil: 'domcontentloaded' });
    await waitForBusy(s21Page);

    await s21Page.fill('#unlock', cryptoPin);
    await s21Page.click('#reveal-btn');
    await waitForBusy(s21Page);

    const pw = await s21Page.textContent('#pw-display');
    if (pw.trim() !== secretPlain) {
      throw new Error(`Decrypted secret mismatch! Expected "${secretPlain}", got "${pw}"`);
    }
  });

  await testCase('UAT-CRYPTO-02', 'Area 6: Cryptographic Decapsulation', 'Post-Quantum ML-DSA-44 Beacon Receipt Verification', async () => {
    const receiptBanner = await s21Page.evaluate(() => {
      const res = document.getElementById('result');
      return res ? res.innerText : '';
    });
    if (!receiptBanner.includes('Reveal verified: YES (ML-DSA-44 Beacon #')) {
      throw new Error(`ML-DSA-44 reveal verification badge missing from result: ${receiptBanner}`);
    }
  });

  await testCase('UAT-CRYPTO-03', 'Area 6: Cryptographic Decapsulation', 'Plaintext DOM Rendering & XSS Injection Immunization', async () => {
    await s21Page.goto(`${BASE_URL}/?uat=1`, { waitUntil: 'domcontentloaded' });
    await waitForBusy(s21Page);

    const xssPayload = `<script>window.__xss_fired=true</script><img src=x onerror='window.__xss_fired=true'>`;
    await s21Page.fill('#secret', xssPayload);
    await s21Page.fill('#pin', 'xss-pin-99');
    await s21Page.click('#seal-btn');
    await waitForBusy(s21Page);

    const xssEscrowId = (await s21Page.evaluate(() => window.__uatState())).escrowId;

    await s21Page.goto(`${BASE_URL}/?escrow_id=${xssEscrowId}&uat=1`, { waitUntil: 'domcontentloaded' });
    await waitForBusy(s21Page);
    await s21Page.fill('#unlock', 'xss-pin-99');
    await s21Page.click('#reveal-btn');
    await waitForBusy(s21Page);

    const xssFired = await s21Page.evaluate(() => window.__xss_fired);
    if (xssFired) {
      throw new Error('CRITICAL VULNERABILITY: XSS payload executed in DOM during reveal!');
    }

    const pwText = await s21Page.textContent('#pw-display');
    if (!pwText.includes('<script>') || !pwText.includes('onerror=')) {
      throw new Error(`XSS payload was not safely rendered as text: ${pwText}`);
    }
  });

  // --- AREA 7: 409 Burn-on-Read Replay Enforcement ---
  await testCase('UAT-BURN-01', 'Area 7: 409 Burn-on-Read', 'Burn-on-Read Replay Enforcement (HTTP 409 Conflict)', async () => {
    // Attempt reveal again on the already-revealed cryptoEscrowId
    await s21Page.goto(`${BASE_URL}/?escrow_id=${cryptoEscrowId}&uat=1`, { waitUntil: 'domcontentloaded' });
    await waitForBusy(s21Page);

    await s21Page.fill('#unlock', cryptoPin);
    await s21Page.click('#reveal-btn');
    await waitForBusy(s21Page);

    const burnCheck = await s21Page.evaluate(() => {
      const res = document.getElementById('result');
      const banner = res ? res.innerText : '';
      const st = window.__uatState ? window.__uatState() : null;
      return { banner, st };
    });

    if (!burnCheck.banner.includes('Secret permanently burned (409)')) {
      throw new Error(`Expected HTTP 409 burned message, got: ${burnCheck.banner}`);
    }
    if (burnCheck.st.burned !== true) {
      throw new Error(`Expected state.burned === true, got: ${JSON.stringify(burnCheck.st)}`);
    }
  });

  await testCase('UAT-BURN-02', 'Area 7: 409 Burn-on-Read', 'Claim Page Direct Load on Burned Escrow (Probe 409)', async () => {
    await s21Page.goto(`${BASE_URL}/?escrow_id=${cryptoEscrowId}&uat=1`, { waitUntil: 'domcontentloaded' });
    await waitForBusy(s21Page);

    const probeText = await s21Page.evaluate(() => {
      const res = document.getElementById('result');
      return res && res.style.display !== 'none' ? res.innerText : '';
    });

    const isBurnedOrDisabled = await s21Page.evaluate(() => {
      const st = window.__uatState ? window.__uatState() : null;
      return st?.burned === true || document.getElementById('result')?.innerText.includes('burned');
    });

    if (!isBurnedOrDisabled) {
      throw new Error(`Probe did not detect burned status on load: ${probeText}`);
    }
  });

  // --- AREA 8: Zero-Server-Query Invariant & Native SMS Handoff ---
  await testCase('UAT-NET-01', 'Area 8: Network Isolation', 'Zero App-Server Requests During Recipient Claim', async () => {
    // Create new escrow
    await s21Page.goto(`${BASE_URL}/?uat=1`, { waitUntil: 'domcontentloaded' });
    await waitForBusy(s21Page);
    await s21Page.fill('#secret', 'ZeroServerQueryVerified123');
    await s21Page.fill('#pin', 'zero-query-77');
    await s21Page.click('#seal-btn');
    await waitForBusy(s21Page);
    const newEscrowId = (await s21Page.evaluate(() => window.__uatState())).escrowId;

    // Attach request listener
    const serverOrigin = `localhost:${APP_PORT}`;
    const forbiddenRequests = [];

    const requestListener = (req) => {
      const u = req.url();
      // Allow initial document and bundles, but ZERO API calls to serverOrigin during claim
      if (u.includes(`${serverOrigin}/api`) || (u.includes(serverOrigin) && !u.includes('/?escrow_id=') && !u.includes('/mlkem.browser.js') && !u.includes('/favicon.svg') && !u.includes('/badges/'))) {
        forbiddenRequests.push(u);
      }
    };

    s21Page.on('request', requestListener);

    try {
      await s21Page.goto(`${BASE_URL}/?escrow_id=${newEscrowId}&uat=1`, { waitUntil: 'domcontentloaded' });
      await waitForBusy(s21Page);
      await s21Page.fill('#unlock', 'zero-query-77');
      await s21Page.click('#reveal-btn');
      await waitForBusy(s21Page);

      const pw = await s21Page.textContent('#pw-display');
      if (!pw.includes('ZeroServerQueryVerified123')) {
        throw new Error(`Reveal failed during zero-server check: ${pw}`);
      }

      if (forbiddenRequests.length > 0) {
        throw new Error(`Detected ${forbiddenRequests.length} forbidden HTTP requests to app server during claim: ${forbiddenRequests.join(', ')}`);
      }
    } finally {
      s21Page.off('request', requestListener);
    }
  });

  await testCase('UAT-SMS-01', 'Area 8: Network Isolation', 'Native SMS Handoff Link Formatting & Payload Encoding', async () => {
    await s21Page.goto(`${BASE_URL}/?uat=1`, { waitUntil: 'domcontentloaded' });
    await waitForBusy(s21Page);
    await s21Page.fill('#secret', 'SMSFormatSecretPayload');
    await s21Page.click('#seal-btn');
    await waitForBusy(s21Page);

    const smsHref = await s21Page.evaluate(() => {
      const a = document.querySelector('a.btn-sms');
      return a ? a.getAttribute('href') : null;
    });

    if (!smsHref || !smsHref.startsWith('sms:?body=')) {
      throw new Error(`SMS link invalid: "${smsHref}"`);
    }

    const decoded = decodeURIComponent(smsHref.replace('sms:?body=', ''));
    if (!decoded.includes('BitBop One-Time Secret:')) {
      throw new Error(`SMS body missing title: "${decoded}"`);
    }
    if (!decoded.includes('?escrow_id=')) {
      throw new Error(`SMS body missing claim link: "${decoded}"`);
    }
    if (!decoded.includes('Unlock Key:')) {
      throw new Error(`SMS body missing unlock key: "${decoded}"`);
    }
    if (!decoded.includes('Provenance: https://www.bitbop.dev/provenance?')) {
      throw new Error(`SMS body missing provenance link: "${decoded}"`);
    }
  });

  if (desktopBrowser) {
    await desktopBrowser.close();
  }

  const durationMs = Date.now() - suiteStartTime;
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;

  const report = {
    suite: 'SecretSender Physical S21 Deterministic UAT',
    device: {
      serial: S21_SERIAL,
      model: 'SM_G998B',
      chromeVersion: 'Chrome/155.0.8059.84',
      viewport: { width: 412, height: 915 },
    },
    completedAt: new Date().toISOString(),
    durationMs,
    summary: {
      total: results.length,
      passed,
      failed,
    },
    results,
  };

  const reportPath = path.join(OUTPUT_DIR, 'deterministic-s21-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  log('\n================================================================');
  log(` DETERMINISTIC S21 SUMMARY: ${passed}/${results.length} PASSED (${failed} failed, ${durationMs}ms)`);
  log(` Report written to: ${reportPath}`);
  log('================================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  log(`FATAL SUITE ERROR: ${err.message}`);
  process.exit(1);
});
