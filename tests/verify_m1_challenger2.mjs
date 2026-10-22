import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_FILE = path.join(ROOT_DIR, 'server.mjs');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const BADGES_DIR = path.join(PUBLIC_DIR, 'badges');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function assert(condition, message, detail = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✔ PASS: ${message}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL: ${message}${detail ? ' -> ' + detail : ''}`);
    failures.push({ message, detail });
  }
}

async function request(urlOrOptions, options = {}) {
  return new Promise((resolve, reject) => {
    let reqOptions = {};
    if (typeof urlOrOptions === 'string') {
      const parsed = new URL(urlOrOptions);
      reqOptions = {
        host: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: options.headers || {},
      };
    } else {
      reqOptions = { ...urlOrOptions, ...options };
    }
    const req = http.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
          bodyText: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function runAllChecks() {
  console.log('================================================================');
  console.log('   CHALLENGER 2 EMPIRICAL HARNESS: DOM, TOKENS & RESPONSIVENESS  ');
  console.log('================================================================\n');

  // 1. Static Source & DOM Inspection
  console.log('--- Test Suite 1: BitBop Brand Tokens in server.mjs ---');
  const serverSource = fs.readFileSync(SERVER_FILE, 'utf8');

  // Exact presence of all 9 BitBop color tokens
  const requiredTokens = [
    { token: '#0F1012', desc: 'Surface background' },
    { token: '#0B0C0E', desc: 'Surface container lowest / base' },
    { token: '#16181D', desc: 'Surface container low / shell background' },
    { token: '#1B1E24', desc: 'Surface container / inputs & buttons' },
    { token: '#262932', desc: 'Outline variant / card borders' },
    { token: '#FFD600', desc: 'Primary container / CTA action buttons' },
    { token: '#1A1600', desc: 'On-primary text color' },
    { token: '#10B981', desc: 'Emerald telemetry accents & status' },
    { token: '#F87171', desc: 'Error states' },
  ];

  for (const { token, desc } of requiredTokens) {
    const count = (serverSource.match(new RegExp(token, 'gi')) || []).length;
    assert(count > 0, `BitBop token ${token} (${desc}) present`, `found ${count} occurrences`);
  }

  // Exact CSS rules for .glider-grid
  console.log('\n--- Test Suite 2: CSS Rules (.glider-grid, .scanner-line, outline) ---');
  assert(serverSource.includes('.glider-grid'), 'CSS rule .glider-grid selector defined');
  assert(serverSource.includes('radial-gradient(circle, #262932 1px, transparent 1px)'), '.glider-grid radial dot pattern matches #262932 1px');
  assert(serverSource.includes('background-size: 24px 24px'), '.glider-grid background-size is 24px 24px');
  assert(serverSource.includes('pointer-events: none'), '.glider-grid pointer-events is none');

  // Exact CSS rules for .scanner-line
  assert(serverSource.includes('.scanner-line'), 'CSS rule .scanner-line selector defined');
  assert(serverSource.includes('height: 2px'), '.scanner-line height is 2px');
  assert(serverSource.includes('#10B981'), '.scanner-line emerald telemetry color present');
  assert(serverSource.includes('box-shadow: 0 0 14px #10B981'), '.scanner-line glow box-shadow matches 0 0 14px #10B981');
  assert(serverSource.includes('animation: scan 8s linear infinite'), '.scanner-line scan animation configured for 8s linear infinite');

  // Exact CSS rules for focus-visible outline
  assert(
    serverSource.includes('outline: 2px solid #FFD600 !important;') &&
    serverSource.includes('outline-offset: 4px'),
    'Focus visible outline enforces "2px solid #FFD600 !important; outline-offset: 4px"'
  );

  // Font imports
  console.log('\n--- Test Suite 3: Typography & Font Imports ---');
  assert(serverSource.includes('fonts.googleapis.com/css2'), 'Google Fonts preconnect/link present');
  assert(serverSource.includes('family=Space+Grotesk'), 'Space Grotesk font imported');
  assert(serverSource.includes('family=Inter'), 'Inter font imported');
  assert(serverSource.includes('family=JetBrains+Mono'), 'JetBrains Mono font imported');
  assert(serverSource.includes("'Space Grotesk'"), 'Space Grotesk used in CSS typography');
  assert(serverSource.includes("'Inter'"), 'Inter used in CSS body typography');
  assert(serverSource.includes("'JetBrains Mono'"), 'JetBrains Mono used in telemetry/keys typography');

  // Header & Footer Badges
  console.log('\n--- Test Suite 4: SVG Brand Badges in DOM ---');
  assert(
    serverSource.includes('/badges/bitbop-wordmark-dark.svg'),
    'Header badge /badges/bitbop-wordmark-dark.svg referenced in DOM'
  );
  assert(
    serverSource.includes('/badges/powered-by-bitbop-gold.svg'),
    'Footer badge /badges/powered-by-bitbop-gold.svg referenced in DOM'
  );

  // Mobile Viewport Overflow Protection
  console.log('\n--- Test Suite 5: Mobile Viewport Overflow Protection ---');
  assert(
    serverSource.includes('name="viewport"') && serverSource.includes('width=device-width, initial-scale=1'),
    'Responsive viewport meta tag correctly configured'
  );
  assert(serverSource.includes('max-width: 480px'), '.shell container constrains width to max-width: 480px');
  assert(serverSource.includes('overflow-x: hidden'), 'Body enforces overflow-x: hidden to prevent horizontal bouncing');
  assert(serverSource.includes('word-break: break-all'), 'word-break: break-all enforced for cryptographic/telemetry blocks');
  assert(serverSource.includes('overflow-wrap: anywhere'), 'overflow-wrap: anywhere enforced for cryptographic/telemetry blocks');
  assert(serverSource.includes('box-sizing: border-box'), 'box-sizing: border-box global reset enforced');
  assert(serverSource.includes('width: 190px') && serverSource.includes('max-width: 100%'), 'Brand wordmark has max-width: 100%');
  assert(serverSource.includes('width: 236px') && serverSource.includes('max-width: 100%'), 'Footer badge has max-width: 100%');

  // DOM Structure & Essential Elements
  console.log('\n--- Test Suite 6: DOM Essential Elements & Presets ---');
  const expectedElementIds = [
    'admin-view',
    'secret',
    'pin',
    'unlock-dt',
    'seal-btn',
    'claim-view',
    'claim-id',
    'timelock-box',
    'timelock-heading',
    'timelock-date-text',
    'countdown-wrap',
    'countdown-clock',
    'countdown-sub',
    'timelock-hint',
    'unlock-controls',
    'unlock',
    'reveal-btn',
    'result',
  ];
  for (const elId of expectedElementIds) {
    assert(serverSource.includes(`id="${elId}"`), `DOM element id="${elId}" present in template`);
  }

  // Presets
  const expectedPresets = ['0', '30', '300', '3600', '86400', '172800'];
  for (const preset of expectedPresets) {
    assert(serverSource.includes(`data-sec="${preset}"`), `Preset data-sec="${preset}" present in presets bar`);
  }

  // Zero Server Requests Contract
  console.log('\n--- Test Suite 7: Zero Server Requests Contract During Claim/Reveal ---');
  // Extract client script from server.mjs
  const scriptMatch = serverSource.match(/<script>([\s\S]*?)<\/script>/);
  assert(Boolean(scriptMatch), 'Client-side script extracted from HTML');
  const clientScript = scriptMatch ? scriptMatch[1] : '';

  // Extract probe and reveal functions
  const probeMatch = clientScript.match(/async function probeEscrowStatusOnLoad[\s\S]*?^  \}/m);
  const revealMatch = clientScript.match(/async function performDirectBrowserReveal[\s\S]*?^  \}/m);
  assert(Boolean(probeMatch), 'probeEscrowStatusOnLoad function found');
  assert(Boolean(revealMatch), 'performDirectBrowserReveal function found');

  const probeCode = probeMatch ? probeMatch[0] : '';
  const revealCode = revealMatch ? revealMatch[0] : '';

  // Ensure NO fetch calls to relative paths (e.g. fetch('/', fetch('/api/'))
  const relativeFetchInProbe = probeCode.match(/fetch\s*\(\s*['"`]\/[^'"`]*['"`]/g);
  const relativeFetchInReveal = revealCode.match(/fetch\s*\(\s*['"`]\/[^'"`]*['"`]/g);
  assert(!relativeFetchInProbe, 'probeEscrowStatusOnLoad makes ZERO relative requests to SecretSender', JSON.stringify(relativeFetchInProbe));
  assert(!relativeFetchInReveal, 'performDirectBrowserReveal makes ZERO relative requests to SecretSender', JSON.stringify(relativeFetchInReveal));

  // Ensure calls target BITBOP_API
  assert(probeCode.includes("fetch(BITBOP_API + '/escrow/reveal'"), 'probeEscrowStatusOnLoad targets BITBOP_API directly');
  assert(revealCode.includes("fetch(BITBOP_API + '/escrow/reveal'"), 'performDirectBrowserReveal targets BITBOP_API/escrow/reveal directly');
  assert(revealCode.includes("fetch(BITBOP_API + '/verify'"), 'performDirectBrowserReveal verifies receipt directly against BITBOP_API/verify');
  assert(clientScript.includes("var BITBOP_API = 'https://api.bitbop.dev'"), 'BITBOP_API points to https://api.bitbop.dev');

  // Verify client-side decapsulation
  assert(
    revealCode.includes('kemInstance.decap') || clientScript.includes('kemInstance.decap'),
    'Client-side decapsulation executes locally via kemInstance.decap()'
  );
  assert(
    revealCode.includes('crypto.subtle.decrypt') || clientScript.includes('crypto.subtle.decrypt'),
    'Client-side envelope decryption executes locally via crypto.subtle.decrypt()'
  );

  // 2. Ephemeral Server Live Verification
  console.log('\n--- Test Suite 8: Ephemeral Server Live HTTP Verification ---');
  const TEST_PORT = 5198;
  const serverProcess = spawn(process.execPath, [SERVER_FILE], {
    env: { ...process.env, PORT: String(TEST_PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Wait for server to be ready
  await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      serverProcess.kill();
      reject(new Error('Server start timed out:\n' + output));
    }, 5000);

    serverProcess.stdout.on('data', (d) => {
      output += d.toString();
      if (output.includes(`listening on http://127.0.0.1:${TEST_PORT}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });

    serverProcess.stderr.on('data', (d) => {
      output += d.toString();
    });

    serverProcess.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited unexpectedly with code ${code}:\n` + output));
    });
  });

  const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

  try {
    // Test GET /
    const rootRes = await request(`${BASE_URL}/`);
    assert(rootRes.statusCode === 200, 'GET / returns HTTP 200');
    assert(rootRes.headers['content-type'] === 'text/html; charset=utf-8', 'GET / returns text/html; charset=utf-8');
    assert(rootRes.headers['content-length'] === String(rootRes.body.length), 'GET / Content-Length matches body byte length');
    assert(rootRes.bodyText.includes('<!DOCTYPE html>'), 'GET / returns valid HTML doctype');

    // Test HEAD /
    const headRes = await request(`${BASE_URL}/`, { method: 'HEAD' });
    assert(headRes.statusCode === 200, 'HEAD / returns HTTP 200');
    assert(headRes.body.length === 0, 'HEAD / returns zero-byte body');
    assert(headRes.headers['content-length'] === String(rootRes.body.length), 'HEAD / Content-Length matches GET / Content-Length');

    // Test POST / (Method Not Allowed)
    const postRes = await request(`${BASE_URL}/`, { method: 'POST' });
    assert(postRes.statusCode === 405, 'POST / returns HTTP 405 Method Not Allowed');
    assert(postRes.headers['allow'] === 'GET, HEAD', 'POST / returns Allow: GET, HEAD');

    // Test All Staged SVG Assets
    console.log('\n--- Test Suite 9: Static SVG Brand Asset Delivery Verification ---');
    const svgFiles = [
      { url: '/favicon.svg', path: path.join(PUBLIC_DIR, 'favicon.svg') },
      { url: '/badges/bitbop-favicon.svg', path: path.join(BADGES_DIR, 'bitbop-favicon.svg') },
      { url: '/badges/bitbop-wordmark-dark.svg', path: path.join(BADGES_DIR, 'bitbop-wordmark-dark.svg') },
      { url: '/badges/powered-by-bitbop-gold.svg', path: path.join(BADGES_DIR, 'powered-by-bitbop-gold.svg') },
      { url: '/badges/powered-by-bitbop-emerald.svg', path: path.join(BADGES_DIR, 'powered-by-bitbop-emerald.svg') },
      { url: '/badges/powered-by-bitbop-light.svg', path: path.join(BADGES_DIR, 'powered-by-bitbop-light.svg') },
      { url: '/badges/bitbop-icon-bopper-1982.svg', path: path.join(BADGES_DIR, 'bitbop-icon-bopper-1982.svg') },
      { url: '/badges/bitbop-icon-d20.svg', path: path.join(BADGES_DIR, 'bitbop-icon-d20.svg') },
    ];

    for (const svgItem of svgFiles) {
      assert(fs.existsSync(svgItem.path), `SVG asset on disk: ${path.relative(ROOT_DIR, svgItem.path)}`);
      const diskBytes = fs.readFileSync(svgItem.path);

      // GET
      const res = await request(`${BASE_URL}${svgItem.url}`);
      assert(res.statusCode === 200, `GET ${svgItem.url} returns HTTP 200`);
      assert(res.headers['content-type'] === 'image/svg+xml; charset=utf-8', `GET ${svgItem.url} Content-Type is image/svg+xml; charset=utf-8`);
      assert(res.headers['cache-control'] === 'public, max-age=86400', `GET ${svgItem.url} Cache-Control is public, max-age=86400`);
      assert(res.body.length === diskBytes.length, `GET ${svgItem.url} body length matches file on disk (${diskBytes.length} bytes)`);
      assert(res.bodyText.includes('<svg'), `GET ${svgItem.url} contains <svg`);

      // HEAD
      const headSvg = await request(`${BASE_URL}${svgItem.url}`, { method: 'HEAD' });
      assert(headSvg.statusCode === 200, `HEAD ${svgItem.url} returns HTTP 200`);
      assert(headSvg.body.length === 0, `HEAD ${svgItem.url} returns zero-byte body`);
      assert(headSvg.headers['content-length'] === String(diskBytes.length), `HEAD ${svgItem.url} Content-Length matches GET`);

      // POST (Method Not Allowed)
      const postSvg = await request(`${BASE_URL}${svgItem.url}`, { method: 'POST' });
      assert(postSvg.statusCode === 405, `POST ${svgItem.url} returns HTTP 405`);
      assert(postSvg.headers['allow'] === 'GET, HEAD', `POST ${svgItem.url} returns Allow: GET, HEAD`);
    }

    // Test GET /mlkem.browser.js
    console.log('\n--- Test Suite 10: Client Script Bundle & Health Endpoint ---');
    const mlkemRes = await request(`${BASE_URL}/mlkem.browser.js`);
    assert(mlkemRes.statusCode === 200, 'GET /mlkem.browser.js returns HTTP 200');
    assert(mlkemRes.headers['content-type'] === 'application/javascript; charset=utf-8', 'mlkem.browser.js Content-Type is application/javascript; charset=utf-8');
    assert(mlkemRes.headers['cache-control'] === 'public, max-age=3600', 'mlkem.browser.js Cache-Control is public, max-age=3600');
    assert(mlkemRes.bodyText.includes('BitBopMlKem') || mlkemRes.bodyText.includes('MlKem768'), 'mlkem.browser.js contains ML-KEM bundle');

    // Test GET /health
    const healthRes = await request(`${BASE_URL}/health`);
    assert(healthRes.statusCode === 200, 'GET /health returns HTTP 200');
    const healthJson = JSON.parse(healthRes.bodyText);
    assert(healthJson.status === 'ok' && healthJson.service === 'SecretSender', 'GET /health payload is { status: "ok", service: "SecretSender" }');

    // Security & Traversal Hardening Suite
    console.log('\n--- Test Suite 11: Security & Path Traversal Hardening ---');
    const traversalAttacks = [
      { path: '/badges/../server.mjs', expected: 403, name: 'Parent traversal via /badges/../server.mjs' },
      { path: '/badges/%2e%2e/server.mjs', expected: 403, name: 'URL-encoded %2e%2e traversal' },
      { path: '/badges/%2E%2E/server.mjs', expected: 403, name: 'Uppercase URL-encoded %2E%2E traversal' },
      { path: '/badges/..%2fserver.mjs', expected: 403, name: 'Mixed dot-slash encoded traversal' },
      { path: '/badges/..\\server.mjs', expected: 403, name: 'Backslash traversal attempt' },
      { path: '/badges/%5cserver.mjs', expected: 403, name: 'URL-encoded backslash traversal' },
      { path: '/badges/%5Cserver.mjs', expected: 403, name: 'Uppercase URL-encoded %5C traversal' },
      { path: '/badges/nonexistent.svg', expected: 404, name: 'Missing SVG badge returns 404' },
      { path: '/badges/malicious.exe', expected: 404, name: 'Non-svg extension returns 404' },
      { path: '/badges/sub/badge.svg', expected: 404, name: 'Subdirectory path returns 404' },
      { path: '/unknown-route', expected: 404, name: 'Unknown route returns 404' },
    ];

    for (const attack of traversalAttacks) {
      const res = await request({ host: '127.0.0.1', port: TEST_PORT, path: attack.path });
      assert(res.statusCode === attack.expected, `${attack.name} returns HTTP ${attack.expected}`, `actual: ${res.statusCode}`);
      assert(!res.bodyText.includes('import http'), `${attack.name} does NOT disclose source code`);
    }

    // Stress & Concurrency Suite
    console.log('\n--- Test Suite 12: Concurrency Stress Test (100 parallel requests) ---');
    const endpoints = [
      '/',
      '/favicon.svg',
      '/badges/bitbop-wordmark-dark.svg',
      '/badges/powered-by-bitbop-gold.svg',
      '/badges/powered-by-bitbop-emerald.svg',
      '/badges/powered-by-bitbop-light.svg',
      '/badges/bitbop-icon-bopper-1982.svg',
      '/badges/bitbop-icon-d20.svg',
      '/mlkem.browser.js',
      '/health',
    ];

    const concurrentReqs = [];
    for (let i = 0; i < 100; i++) {
      const ep = endpoints[i % endpoints.length];
      concurrentReqs.push(request(`${BASE_URL}${ep}`));
    }

    const concurrentResults = await Promise.all(concurrentReqs);
    const all200 = concurrentResults.every((r) => r.statusCode === 200);
    assert(all200, '100 concurrent requests across all endpoints complete with HTTP 200');

  } finally {
    serverProcess.kill('SIGKILL');
  }

  // Summary
  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log('================================================================');

  if (failedTests > 0) {
    console.error('\nFAILURES RECORDED:');
    for (const f of failures) {
      console.error(`- ${f.message}: ${f.detail}`);
    }
    process.exit(1);
  } else {
    console.log('\n✔ ALL CHALLENGER CHECKS PASSED EMPIRICALLY (100%).');
    process.exit(0);
  }
}

runAllChecks().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
