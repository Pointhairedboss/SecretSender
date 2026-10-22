import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import { MlKem768 } from 'mlkem';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5179);
const HOST = process.env.HOST || '127.0.0.1';
const API_BASE = process.env.BITBOP_API_BASE || 'https://api.bitbop.dev';
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ? process.env.PUBLIC_ORIGIN.replace(/\/+$/, '') : '';

let activeApiKey = process.env.BITBOP_API_KEY ? process.env.BITBOP_API_KEY.trim() : '';

const MLKEM_BROWSER_BUNDLE = fs.readFileSync(path.join(__dirname, 'mlkem.browser.js'), 'utf8');

const PUBLIC_DIR = path.join(__dirname, 'public');
const BADGES_DIR = path.join(PUBLIC_DIR, 'badges');

// In-memory cache for static SVG assets: path -> Buffer
const SVG_CACHE = new Map();

function getCachedSvg(filePath) {
  if (SVG_CACHE.has(filePath)) {
    return SVG_CACHE.get(filePath);
  }
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return null;
  const buf = fs.readFileSync(filePath);
  SVG_CACHE.set(filePath, buf);
  return buf;
}

function serveSvgBuffer(req, res, buf) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Allow': 'GET, HEAD',
    });
    res.end('Method not allowed');
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=86400',
    'Content-Length': buf.length,
  });
  if (req.method === 'HEAD') {
    res.end();
  } else {
    res.end(buf);
  }
}

/**
 * Self-provisions a Free Tier BitBop API key (500 req/day, 60-day TTL) via ML-KEM-768
 * if BITBOP_API_KEY is not provided in the environment.
 */
async function ensureBitBopApiKey() {
  if (activeApiKey) return activeApiKey;
  try {
    const kem = new MlKem768();
    const [publicKey, secretKey] = await kem.generateKeyPair();
    const res = await fetch(`${API_BASE}/api/keys/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kyber_public_key: Buffer.from(publicKey).toString('hex'),
        signature_scheme: 'ml-dsa-44',
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const sharedSecret = await kem.decap(Buffer.from(data.cipher.kyber_ciphertext_hex, 'hex'), secretKey);
      const iv = Buffer.from(data.cipher.aes_iv_hex, 'hex');
      const ct = Buffer.from(data.cipher.aes_ciphertext_hex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(sharedSecret), iv);
      decipher.setAuthTag(ct.subarray(ct.length - 16));
      const keyPlain = Buffer.concat([decipher.update(ct.subarray(0, ct.length - 16)), decipher.final()]).toString('utf8');
      activeApiKey = keyPlain.trim();
      console.log(`[SecretSender] Self-provisioned BitBop Free Tier key (${activeApiKey.slice(0, 16)}...)`);
      return activeApiKey;
    }
  } catch (e) {
    console.warn(`[SecretSender] Auto-mint fallback to sandbox key (${e.message})`);
  }
  activeApiKey = 'test-key-1';
  return activeApiKey;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function genPin() {
  return crypto.randomBytes(4).toString('hex');
}

async function apiFetch(pathname, opts = {}) {
  const res = await fetch(API_BASE + pathname, opts);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

async function verifyReceipt(receipt) {
  const { status, data } = await apiFetch('/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(receipt),
  });
  return { ok: status === 200 && data.valid !== false, status, data };
}

async function handleShare(body, req) {
  const parsed = JSON.parse(body);
  const { password, unlockKey, unlockAfterSeconds, unlockAtIso } = parsed;
  if (!password || typeof password !== 'string') {
    throw new Error('Secret password is required');
  }

  const pin = unlockKey && String(unlockKey).trim() ? String(unlockKey).trim() : genPin();

  // Compute unlock_after_seconds from either explicit seconds or a future ISO timestamp
  let delaySeconds = 0;
  if (typeof unlockAfterSeconds === 'number' && Number.isFinite(unlockAfterSeconds) && unlockAfterSeconds > 0) {
    delaySeconds = Math.ceil(unlockAfterSeconds);
  } else if (unlockAtIso) {
    const targetMs = Date.parse(String(unlockAtIso));
    if (!Number.isNaN(targetMs)) {
      delaySeconds = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
    }
  }

  // Never hash the plaintext password into public context_hash!
  // Use a non-secret random nonce + timestamp so the public receipt reveals zero password entropy.
  const contextMaterial = `bitbop-otp-vault:v2:${Date.now()}:${crypto.randomUUID()}`;
  const contextHash = 'sha256:' + crypto.createHash('sha256').update(contextMaterial, 'utf8').digest('hex');

  const apiKey = await ensureBitBopApiKey();
  const sealPayloadB64 = Buffer.from(password, 'utf8').toString('base64');
  const { status, data } = await apiFetch('/escrow/commit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      context_hash: contextHash,
      seal_payload_b64: sealPayloadB64,
      store_sealed_envelope: true,
      reveal_policy: 'once',
      unlock_after_seconds: delaySeconds,
      unlock_key: pin,
      signature_scheme: 'ml-dsa-44',
    }),
  });

  if (status !== 200) {
    throw new Error(data.error || data.message || 'BitBop commit failed (' + status + ')');
  }

  // Claim URL carries ONLY ?escrow_id=... (zero side-channel metadata in URL)
  // Normalize 127.0.0.1 -> localhost so mobile Chrome treats local origin as a W3C Secure Context (window.crypto.subtle)
  const escrowId = data.escrow_id;
  const proto = req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']).split(',')[0].trim() : 'http';
  const safeHost = String(req.headers.host || `localhost:${PORT}`).replace(/^127\.0\.0\.1\b/, 'localhost');
  const origin = PUBLIC_ORIGIN || `${proto}://${safeHost}`;
  const claimUrl = `${origin}/?escrow_id=${encodeURIComponent(escrowId)}`;
  const provenanceUrl =
    'https://www.bitbop.dev/provenance?escrow_id=' +
    encodeURIComponent(escrowId) +
    '&sequence=' +
    encodeURIComponent(String(data.beacon_sequence || ''));

  const smsBody =
    'BitBop One-Time Secret: ' +
    claimUrl +
    ' | Unlock Key: ' +
    pin +
    (delaySeconds > 0 ? ' | Unlocks: ' + data.unlock_at : '') +
    ' | Provenance: ' +
    provenanceUrl;

  const verification = await verifyReceipt(data);

  return {
    escrow_id: escrowId,
    unlock_key: pin,
    unlock_at: data.unlock_at,
    unlock_after_seconds: delaySeconds,
    claim_url: claimUrl,
    provenance_url: provenanceUrl,
    sms_body: smsBody,
    sms_link: 'sms:?body=' + encodeURIComponent(smsBody),
    commit_receipt: data,
    commit_verified: verification.ok,
    commit_verification: verification.data,
  };
}

function buildHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>SecretSender — Quantum-Sealed One-Time Secrets</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600;700;800&display=swap" rel="stylesheet" crossorigin="anonymous">
<style>
  :root {
    --color-surface: #0F1012;
    --color-surface-container-lowest: #0B0C0E;
    --color-surface-container-low: #16181D;
    --color-surface-container: #1B1E24;
    --color-surface-container-high: #21252D;
    --color-surface-container-highest: #282D37;
    --color-outline-variant: #262932;
    --color-border-subtle: #1E2028;
    --color-primary-container: #FFD600;
    --color-primary-fixed: #FFE14D;
    --color-primary-fixed-dim: #E6C000;
    --color-on-primary: #1A1600;
    --color-emerald-telemetry: #10B981;
    --color-emerald-dark: #062419;
    --color-emerald-light: #34D399;
    --color-error: #F87171;
    --color-error-container: #7F1D1D;
    --color-warning: #FBBF24;
    --color-on-surface: #F1F5F9;
    --color-on-surface-variant: #CBD5E1;
    --color-outline: #94A3B8;
  }

  * {
    box-sizing: border-box;
  }
  *::before, *::after {
    box-sizing: border-box;
  }

  html {
    color-scheme: dark;
    background-color: #0F1012;
    -webkit-text-size-adjust: 100%;
  }

  body {
    font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 20px 12px;
    background-color: #0F1012;
    color: #CBD5E1;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    overflow-x: hidden;
    position: relative;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  /* Fixed Glider Grid Radial Dot Pattern */
  .glider-grid {
    position: fixed;
    inset: 0;
    background-image: radial-gradient(circle, #262932 1px, transparent 1px);
    background-size: 24px 24px;
    opacity: 0.35;
    pointer-events: none;
    z-index: 0;
  }

  /* Application Shell Card */
  .shell {
    position: relative;
    width: 100%;
    max-width: 480px;
    background: #16181D;
    background-color: #16181D;
    border: 1px solid #262932;
    border-color: #262932;
    border-radius: 14px;
    padding: 24px 20px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.03);
    overflow: hidden;
    z-index: 1;
  }

  /* Telemetry Scanner Line */
  .scanner-line {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 2px;
    background: #10B981;
    background-color: #10B981;
    box-shadow: 0 0 14px #10B981;
    opacity: 0.6;
    pointer-events: none;
    z-index: 10;
    animation: scan 8s linear infinite;
  }
  @keyframes scan {
    0% { top: 0; opacity: 0.8; }
    50% { opacity: 1; }
    100% { top: 100%; opacity: 0.8; }
  }

  /* Header Branding */
  .brand-header {
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid #1E2028;
  }
  .brand-top-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }
  .brand-wordmark-link {
    display: inline-block;
    line-height: 0;
    text-decoration: none;
  }
  .brand-wordmark {
    width: 190px;
    height: 40px;
    max-width: 100%;
    height: auto;
    display: block;
  }
  .header-status-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: #10B981;
    background: #062419;
    border: 1px solid rgba(16, 185, 129, 0.35);
    padding: 3px 8px;
    border-radius: 9999px;
  }
  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #10B981;
    background: #062419;
    border: 1px solid rgba(16, 185, 129, 0.35);
    padding: 4px 10px;
    border-radius: 6px;
  }
  .beacon-pip {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #10B981;
    background-color: #10B981;
    box-shadow: 0 0 8px #10B981;
    display: inline-block;
    flex-shrink: 0;
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.45; transform: scale(0.85); }
  }

  /* Typography */
  h1 {
    font-family: 'Space Grotesk', system-ui, sans-serif;
    font-size: 1.5rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: #F1F5F9;
    margin: 12px 0 6px;
  }
  .sub {
    color: #94A3B8;
    font-size: 0.88rem;
    margin: 0 0 18px;
    line-height: 1.45;
  }
  label {
    display: block;
    margin: 14px 0 6px;
    font-family: 'Space Grotesk', system-ui, sans-serif;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #94A3B8;
  }

  /* Form Inputs */
  input[type="text"], input[type="datetime-local"] {
    width: 100%;
    max-width: 100%;
    padding: 12px 14px;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 14.5px;
    border: 1px solid #262932;
    border-radius: 8px;
    background: #0B0C0E;
    color: #F1F5F9;
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  input[type="text"]#secret,
  input[type="text"]#pin,
  input[type="text"]#unlock {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 14px;
  }
  input[type="text"]::placeholder {
    color: #64748B;
  }
  input[type="text"]:focus, input[type="datetime-local"]:focus {
    border-color: #FFD600;
  }

  /* Focus Visible Global Outline */
  a:focus-visible,
  button:focus-visible,
  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible,
  [tabindex]:focus-visible {
    outline: 2px solid #FFD600 !important;
    outline-offset: 4px !important;
  }

  /* Presets Bar */
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
    width: 100%;
  }
  .preset-btn {
    flex: 0 1 auto;
    white-space: nowrap;
    padding: 6px 10px;
    font-size: 11.5px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-weight: 600;
    background: #1B1E24;
    color: #94A3B8;
    border: 1px solid #262932;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .preset-btn:hover:not(.active) {
    background: #21252D;
    color: #F1F5F9;
    border-color: #FFD600;
  }
  .preset-btn.active {
    background: #062419;
    color: #10B981;
    border-color: #10B981;
    box-shadow: 0 0 10px rgba(16, 185, 129, 0.25);
  }

  /* Primary CTA Action Buttons */
  button.primary, .btn-primary, #seal-btn, #reveal-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    margin-top: 18px;
    padding: 13px 18px;
    font-family: 'Space Grotesk', system-ui, -apple-system, sans-serif;
    font-size: 0.92rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: #FFD600;
    background-color: #FFD600;
    color: #1A1600;
    border: 1px solid #FFD600;
    border-radius: 8px;
    cursor: pointer;
    text-decoration: none;
    text-align: center;
    box-shadow: 0 2px 8px rgba(255, 214, 0, 0.25);
    transition: background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.05s ease;
  }
  button.primary:hover:not(:disabled), .btn-primary:hover, #seal-btn:hover:not(:disabled), #reveal-btn:hover:not(:disabled) {
    background: #FFE14D;
    background-color: #FFE14D;
    border-color: #FFE14D;
    box-shadow: 0 4px 14px rgba(255, 214, 0, 0.35);
  }
  button.primary:active:not(:disabled), #seal-btn:active:not(:disabled), #reveal-btn:active:not(:disabled) {
    background-color: #E6C000;
    border-color: #E6C000;
    transform: scale(0.97);
  }
  button.primary:disabled, #seal-btn:disabled, #reveal-btn:disabled {
    background: #282D37 !important;
    background-color: #282D37 !important;
    border-color: #282D37 !important;
    color: #64748B !important;
    cursor: not-allowed !important;
    box-shadow: none !important;
    transform: none !important;
    opacity: 0.65;
  }

  /* Secondary Buttons */
  .btn, .btn-secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 14px;
    font-family: 'Space Grotesk', system-ui, -apple-system, sans-serif;
    font-size: 0.82rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: #1B1E24;
    color: #CBD5E1;
    border: 1px solid #262932;
    border-radius: 8px;
    cursor: pointer;
    text-decoration: none;
    text-align: center;
    box-shadow: none;
    transition: all 0.15s ease;
  }
  .btn:hover, .btn-secondary:hover:not(:disabled) {
    background: #21252D;
    border-color: #FFD600;
    color: #FFD600;
  }

  /* SMS Button */
  a.btn-sms {
    background: #062419;
    color: #10B981;
    border: 1px solid rgba(16, 185, 129, 0.4);
  }
  a.btn-sms:hover {
    background: #0B3B2B;
    border-color: #10B981;
    color: #34D399;
  }

  /* Card and Panels */
  .card {
    background: #0B0C0E;
    border: 1px solid #262932;
    border-radius: 10px;
    padding: 16px;
    margin: 18px 0 0;
  }

  /* Time-Lock Embargo Card */
  .timelock-card {
    background: #0B0C0E;
    border: 1px solid rgba(16, 185, 129, 0.4);
    border-radius: 10px;
    padding: 16px;
    margin: 14px 0;
    text-align: center;
    box-shadow: 0 0 16px rgba(16, 185, 129, 0.1);
  }
  .timelock-title {
    font-size: 0.76rem;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #10B981;
    margin-bottom: 6px;
  }
  .timelock-date {
    font-family: 'Space Grotesk', system-ui, sans-serif;
    font-size: 1.02rem;
    font-weight: 700;
    color: #F1F5F9;
    margin-bottom: 8px;
  }

  /* 24-Hour Countdown Clock */
  .countdown-clock {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 2.1rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #10B981;
    background: #062419;
    border: 1.5px solid #10B981;
    border-radius: 8px;
    padding: 10px 16px;
    display: inline-block;
    margin: 8px 0;
    box-shadow: 0 0 16px rgba(16, 185, 129, 0.3), inset 0 0 10px rgba(16, 185, 129, 0.15);
  }
  .countdown-sub {
    font-size: 0.78rem;
    color: #94A3B8;
    margin-top: 6px;
    line-height: 1.4;
  }

  /* Status Colors */
  .ok { color: #10B981; }
  .err { color: #F87171; }
  .warn { color: #FBBF24; }

  /* Monospace Telemetry / Keys / Hashes */
  .mono {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    word-break: break-all;
    overflow-wrap: anywhere;
    font-size: 0.82rem;
    background: #0B0C0E;
    color: #34D399;
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid #262932;
    margin: 4px 0 10px;
  }

  /* Responsive Multi-Button Rows */
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
    width: 100%;
  }
  .row button, .row .btn, .row a {
    flex: 1 1 140px;
    min-width: 0;
    margin-top: 0;
  }

  /* Plaintext Secret Display */
  #pw-display {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 1.25rem;
    font-weight: 800;
    color: #10B981;
    padding: 14px;
    background: #062419;
    border: 1.5px solid #10B981;
    border-radius: 8px;
    margin: 12px 0;
    word-break: break-all;
    overflow-wrap: anywhere;
    box-shadow: 0 0 14px rgba(16, 185, 129, 0.25);
  }

  /* Footer Branding */
  .brand-footer {
    margin-top: 24px;
    padding-top: 18px;
    border-top: 1px solid #1E2028;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .footer-badge-link {
    display: inline-block;
    line-height: 0;
    text-decoration: none;
    transition: transform 0.15s ease;
  }
  .footer-badge-link:hover {
    transform: translateY(-1px);
  }
  .footer-badge-img {
    width: 236px;
    height: 36px;
    max-width: 100%;
    height: auto;
    display: block;
  }
  .footer-sub {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10px;
    color: #64748B;
    letter-spacing: 0.04em;
    line-height: 1.4;
  }
</style>
<script src="/mlkem.browser.js"></script>
</head>
<body>
<div class="glider-grid" aria-hidden="true"></div>

<div class="shell">
  <div class="scanner-line" aria-hidden="true"></div>

  <header class="brand-header">
    <div class="brand-top-row">
      <a href="https://www.bitbop.dev" target="_blank" rel="noopener noreferrer" class="brand-wordmark-link" title="BitBop.dev — Quantum Hardware Escrow">
        <img src="/badges/bitbop-wordmark-dark.svg" alt="BitBop.dev" class="brand-wordmark" width="200" height="42">
      </a>
      <div class="header-status-badge">
        <span class="beacon-pip" aria-hidden="true"></span>
        <span class="badge-text">LIVE ESCROW</span>
      </div>
    </div>
    <div class="eyebrow">
      <span class="beacon-pip" aria-hidden="true"></span>
      <span>NIST FIPS 203 ML-KEM-768 · BURN-ON-READ</span>
    </div>
  </header>

  <!-- ADMIN VIEW -->
  <div id="admin-view">
    <h1>SecretSender</h1>
    <p class="sub">Hardware-sealed one-time password delivery with optional future reveal embargo and zero-storage burn-on-read.</p>

    <label for="secret">Secret Password</label>
    <input type="text" id="secret" autocomplete="off" placeholder="Enter password or secret to share">

    <label for="pin">Unlock Key / PIN (optional)</label>
    <input type="text" id="pin" autocomplete="off" placeholder="Auto-generated if left blank">

    <label for="unlock-dt">Future Reveal Date / Embargo (optional)</label>
    <input type="datetime-local" id="unlock-dt">
    <div class="presets">
      <button type="button" class="preset-btn active" data-sec="0">Immediate</button>
      <button type="button" class="preset-btn" data-sec="30">+30s (Demo)</button>
      <button type="button" class="preset-btn" data-sec="300">+5m</button>
      <button type="button" class="preset-btn" data-sec="3600">+1h</button>
      <button type="button" class="preset-btn" data-sec="86400">+24h</button>
      <button type="button" class="preset-btn" data-sec="172800">+48h (&gt;24h)</button>
    </div>

    <button type="button" class="primary" id="seal-btn">Seal &amp; Create Share Link</button>
  </div>

  <!-- RECIPIENT / CLAIM VIEW -->
  <div id="claim-view" style="display:none">
    <h1>Claim One-Time Secret</h1>
    <p class="sub">Client-side ML-KEM-768 + WebCrypto decryption directly from BitBop Edge (zero queries to app server).</p>
    <div class="mono" id="claim-id"></div>

    <!-- Time-Lock & 24h HH:MM:SS Countdown Box -->
    <div id="timelock-box" class="timelock-card" style="display:none">
      <div class="timelock-title" id="timelock-heading">⏳ Time-Locked Secret</div>
      <div class="timelock-date" id="timelock-date-text"></div>
      <div id="countdown-wrap" style="display:none">
        <div class="countdown-clock" id="countdown-clock">00:00:00</div>
        <div class="countdown-sub" id="countdown-sub">Final 24-hour countdown (HH:MM:SS)</div>
      </div>
      <div class="countdown-sub" id="timelock-hint">Pre-enter your Unlock Key below — secret will auto-decrypt in your browser at 00:00:00.</div>
    </div>

    <div id="unlock-controls">
      <label for="unlock">Unlock Key / PIN</label>
      <input type="text" id="unlock" autocomplete="off" placeholder="Enter Unlock Key from sender">
      <button type="button" class="primary" id="reveal-btn">Reveal / Decrypt</button>
    </div>
  </div>

  <div id="result" class="card" style="display:none"></div>

  <footer class="brand-footer">
    <a href="https://www.bitbop.dev" target="_blank" rel="noopener noreferrer" class="footer-badge-link" title="Powered by BitBop.dev — Hardware Entropy &amp; Post-Quantum Provenance">
      <img src="/badges/powered-by-bitbop-gold.svg" alt="Powered by BitBop.dev" width="236" height="36" class="footer-badge-img">
    </a>
    <div class="footer-sub">
      Hardware Entropy · Zero-Plaintext Storage · NIST FIPS 204 Provenance
    </div>
  </footer>
</div>

<script>
(function() {
  var BITBOP_API = 'https://api.bitbop.dev';
  var params = new URLSearchParams(window.location.search);
  var escrowId = params.get('escrow_id');
  var selectedPresetSeconds = 0;
  var unlockAtMs = null;
  var countdownTimer = null;
  var revealInFlight = false;
  var sealInFlight = false;

  var currentEscrowId = escrowId || null;
  var timelockActive = false;
  var currentRemainingSeconds = null;
  var revealed = false;
  var burned = false;
  var lastError = null;
  var secretPlaintext = null;

  // --- White-Box Flight Recorder & Deterministic Seam ---
  var isDevOrLocal = Boolean(
    typeof window !== 'undefined' && (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === '[::1]' ||
      window.location.search.includes('uat=1')
    )
  );

  var MAX_UAT_EVENTS = 5000;
  var inFlightFetchCount = 0;
  var activeHolds = new Map();
  var uatEventsList = [];
  var uatStartedAt = Date.now();

  var uatRecorder = {
    record: function(ev) {
      if (!isDevOrLocal) return;
      var entry = Object.assign({ t: Date.now() }, ev);
      uatEventsList.push(entry);
      if (uatEventsList.length > MAX_UAT_EVENTS) {
        uatEventsList.splice(0, uatEventsList.length - MAX_UAT_EVENTS);
      }
    },
    beginHold: function(id, why) {
      if (!isDevOrLocal) return function() {};
      activeHolds.set(id, Date.now());
      this.record({ type: 'hold', id: id, on: true, why: why });
      var self = this;
      return function() { self.endHold(id, why); };
    },
    endHold: function(id, why) {
      if (!isDevOrLocal) return;
      var started = activeHolds.get(id);
      if (started === undefined) return;
      activeHolds.delete(id);
      this.record({
        type: 'hold',
        id: id,
        on: false,
        heldMs: Date.now() - started,
        why: why
      });
    },
    events: function(sinceIndex) {
      return uatEventsList.slice(sinceIndex || 0);
    },
    clear: function() {
      uatEventsList = [];
      uatStartedAt = Date.now();
      activeHolds.clear();
    },
    summary: function() {
      var actions = uatEventsList.filter(function(e) { return e.type === 'action'; });
      var net = uatEventsList.filter(function(e) { return e.type === 'network'; });
      var networkStatuses = {};
      for (var i = 0; i < net.length; i++) {
        var st = String(net[i].status);
        networkStatuses[st] = (networkStatuses[st] || 0) + 1;
      }
      var errors = uatEventsList.filter(function(e) { return e.type === 'error'; }).length;
      var holds = uatEventsList.filter(function(e) { return e.type === 'hold' && !e.on; });
      var maxHoldMs = 0;
      for (var h = 0; h < holds.length; h++) {
        if (typeof holds[h].heldMs === 'number' && holds[h].heldMs > maxHoldMs) {
          maxHoldMs = holds[h].heldMs;
        }
      }
      return {
        minutes: Math.round((Date.now() - uatStartedAt) / 6000) / 10,
        actions: actions.length,
        networkCalls: net.length,
        networkStatuses: networkStatuses,
        errors: errors,
        holds: { count: holds.length, maxMs: maxHoldMs }
      };
    },
    exportLog: function() {
      return {
        format: 'web-uat/1',
        savedAt: new Date().toISOString(),
        url: window.location.href,
        userAgent: navigator.userAgent,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        state: getUatState(),
        summary: this.summary(),
        events: uatEventsList.slice()
      };
    },
    download: function(filenamePrefix) {
      var prefix = filenamePrefix || 'web-uat';
      var blob = new Blob([JSON.stringify(this.exportLog(), null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = prefix + '-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function() {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
    }
  };

  function getUatState() {
    var isClaim = Boolean(currentEscrowId) || (document.getElementById('claim-view') && document.getElementById('claim-view').style.display !== 'none');
    var remSec = null;
    if (unlockAtMs) {
      var s = Math.max(0, Math.ceil((unlockAtMs - Date.now()) / 1000));
      remSec = timelockActive ? s : (currentRemainingSeconds !== null ? currentRemainingSeconds : 0);
    }
    return {
      view: isClaim ? 'claim' : 'admin',
      escrowId: currentEscrowId || null,
      timelockActive: Boolean(timelockActive),
      remainingSeconds: remSec,
      revealed: Boolean(revealed),
      burned: Boolean(burned),
      error: lastError || null,
      secretPlaintext: secretPlaintext || null
    };
  }

  function isUatBusy() {
    return (
      inFlightFetchCount > 0 ||
      activeHolds.size > 0 ||
      Boolean(revealInFlight) ||
      Boolean(sealInFlight)
    );
  }

  if (isDevOrLocal) {
    window.__uatRecorder = uatRecorder;
    window.__uatState = getUatState;
    window.__uatBusy = isUatBusy;

    if (typeof window.fetch === 'function') {
      var origFetch = window.fetch.bind(window);
      window.fetch = async function(input, init) {
        var urlStr = typeof input === 'string' ? input : (input && input.url ? input.url : (input instanceof Request ? input.url : String(input)));
        var method = (init && init.method ? init.method : (input && input.method ? input.method : 'GET')).toUpperCase();
        var t0 = Date.now();
        inFlightFetchCount++;
        try {
          var res = await origFetch(input, init);
          uatRecorder.record({
            type: 'network',
            method: method,
            url: urlStr,
            status: res.status,
            ok: res.ok,
            ms: Date.now() - t0
          });
          return res;
        } catch (err) {
          uatRecorder.record({
            type: 'network',
            method: method,
            url: urlStr,
            status: 0,
            ok: false,
            ms: Date.now() - t0,
            error: String(err && err.message ? err.message : err)
          });
          throw err;
        } finally {
          inFlightFetchCount = Math.max(0, inFlightFetchCount - 1);
        }
      };
    }

    document.addEventListener('click', function(e) {
      var target = e.target;
      if (!target) return;
      var el = target.closest('button, a, input, [role="button"]') || target;
      var desc = el.id ? '#' + el.id : (el.className && typeof el.className === 'string' ? el.tagName.toLowerCase() + '.' + String(el.className).trim().split(/\s+/).join('.') : el.tagName.toLowerCase());
      uatRecorder.record({
        type: 'action',
        name: 'click',
        target: desc,
        payload: { text: (el.textContent || '').trim().slice(0, 50) }
      });
    }, true);

    document.addEventListener('input', function(e) {
      var target = e.target;
      if (!target || !target.tagName) return;
      var tag = target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        var desc = target.id ? '#' + target.id : tag;
        uatRecorder.record({
          type: 'action',
          name: 'input',
          target: desc,
          payload: {
            type: target.type || 'text',
            valueLength: (target.value || '').length
          }
        });
      }
    }, true);

    window.addEventListener('error', function(e) {
      uatRecorder.record({
        type: 'error',
        where: 'window',
        message: String(e.message || e),
        stack: e.error && e.error.stack ? e.error.stack : undefined
      });
    });

    window.addEventListener('unhandledrejection', function(e) {
      var reason = e.reason;
      uatRecorder.record({
        type: 'error',
        where: 'promise',
        message: String(reason && reason.message ? reason.message : reason),
        stack: reason && reason.stack ? reason.stack : undefined
      });
    });

    var origConsoleError = console.error.bind(console);
    console.error = function() {
      origConsoleError.apply(console, arguments);
      var msg = Array.prototype.slice.call(arguments).map(function(a) {
        return typeof a === 'string' ? a : (a instanceof Error ? a.message : JSON.stringify(a));
      }).join(' ');
      uatRecorder.record({
        type: 'error',
        where: 'console',
        message: msg.slice(0, 1000)
      });
    };

    uatRecorder.record({
      type: 'action',
      name: 'navigation',
      target: window.location.href,
      payload: { view: escrowId ? 'claim' : 'admin', escrowId: escrowId || null }
    });
  }

  function bytesToHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      out += bytes[i].toString(16).padStart(2, '0');
    }
    return out;
  }
  function hexToBytes(hex) {
    var clean = String(hex).trim();
    var out = new Uint8Array(clean.length / 2);
    for (var i = 0; i < out.length; i++) {
      out[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return out;
  }
  function base64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }

  function pad2(n) {
    return String(Math.floor(Math.max(0, n))).padStart(2, '0');
  }

  function formatHhMmSs(totalSeconds) {
    var s = Math.max(0, Math.ceil(totalSeconds));
    var hrs = Math.floor(s / 3600);
    var mins = Math.floor((s % 3600) / 60);
    var secs = s % 60;
    return pad2(hrs) + ':' + pad2(mins) + ':' + pad2(secs);
  }

  function showMessage(title, detail, tone) {
    if (tone === 'err') {
      lastError = title + (detail ? ': ' + detail : '');
      uatRecorder.record({
        type: 'state',
        label: 'error_message',
        summary: { title: title, detail: detail, tone: tone }
      });
    } else if (tone === 'ok') {
      lastError = null;
    }

    var el = document.getElementById('result');
    el.style.display = 'block';
    el.style.borderColor = tone === 'err' ? '#F87171' : tone === 'warn' ? '#FBBF24' : '#10B981';
    el.style.backgroundColor = tone === 'err' ? 'rgba(127, 29, 29, 0.25)' : '#0B0C0E';
    el.textContent = '';

    var h = document.createElement('div');
    h.className = tone === 'err' ? 'err' : tone === 'warn' ? 'warn' : 'ok';
    h.style.fontFamily = "'Space Grotesk', system-ui, sans-serif";
    h.style.fontWeight = '700';
    h.style.fontSize = '0.95rem';
    h.style.marginBottom = detail ? '6px' : '0';
    h.textContent = title;
    el.appendChild(h);

    if (detail) {
      var p = document.createElement('div');
      p.style.color = '#CBD5E1';
      p.style.fontSize = '0.85rem';
      p.textContent = detail;
      el.appendChild(p);
    }
  }

  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function() { alert('Copied!'); }).catch(function() { prompt('Copy:', t); });
    } else {
      prompt('Copy:', t);
    }
  }

  // Preset buttons on Admin view
  var presetBtns = document.querySelectorAll('.preset-btn');
  for (var i = 0; i < presetBtns.length; i++) {
    presetBtns[i].addEventListener('click', function(ev) {
      var btn = ev.currentTarget;
      selectedPresetSeconds = parseInt(btn.getAttribute('data-sec') || '0', 10);
      for (var j = 0; j < presetBtns.length; j++) presetBtns[j].classList.remove('active');
      btn.classList.add('active');
      var dtInput = document.getElementById('unlock-dt');
      if (selectedPresetSeconds > 0) {
        var target = new Date(Date.now() + selectedPresetSeconds * 1000);
        var localIso = new Date(target.getTime() - target.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        dtInput.value = localIso;
      } else {
        dtInput.value = '';
      }
    });
  }

  document.getElementById('unlock-dt').addEventListener('input', function() {
    selectedPresetSeconds = 0;
    for (var j = 0; j < presetBtns.length; j++) presetBtns[j].classList.remove('active');
  });

  // Admin: Seal & Create Share Link
  document.getElementById('seal-btn').addEventListener('click', function() {
    var secret = document.getElementById('secret').value;
    var pin = document.getElementById('pin').value;
    var dtVal = document.getElementById('unlock-dt').value;

    if (!secret) {
      showMessage('Enter a secret password.', '', 'err');
      return;
    }

    var payload = { password: secret, unlockKey: pin || undefined };
    if (selectedPresetSeconds > 0) {
      payload.unlockAfterSeconds = selectedPresetSeconds;
    } else if (dtVal) {
      var parsedMs = Date.parse(dtVal);
      if (!Number.isNaN(parsedMs) && parsedMs > Date.now()) {
        payload.unlockAfterSeconds = Math.ceil((parsedMs - Date.now()) / 1000);
      }
    }

    sealInFlight = true;
    var releaseHold = uatRecorder.beginHold('seal', 'Admin sealing secret via BitBop');
    var btn = document.getElementById('seal-btn');
    btn.disabled = true;
    btn.textContent = 'Sealing via BitBop...';

    fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d }; }); })
      .then(function(res) {
        btn.disabled = false;
        btn.textContent = 'Seal & Create Share Link';
        if (!res.ok) {
          showMessage(res.d.error || 'Failed to seal secret', '', 'err');
          return;
        }
        var d = res.d;
        currentEscrowId = d.escrow_id;
        lastError = null;
        uatRecorder.record({
          type: 'state',
          label: 'secret_sealed',
          summary: { escrowId: d.escrow_id, unlockKey: d.unlock_key }
        });

        var el = document.getElementById('result');
        el.style.display = 'block';
        el.style.borderColor = '#10B981';
        el.textContent = '';

        var h2 = document.createElement('h2');
        h2.className = 'ok';
        h2.style.margin = '0 0 10px';
        h2.style.fontSize = '1.15rem';
        h2.textContent = 'Secret Sealed';
        el.appendChild(h2);

        function addField(labelTxt, valTxt) {
          var l = document.createElement('div');
          l.style.fontSize = '0.75rem';
          l.style.color = '#94A3B8';
          l.style.textTransform = 'uppercase';
          l.textContent = labelTxt;
          var v = document.createElement('div');
          v.className = 'mono';
          v.textContent = valTxt;
          el.appendChild(l);
          el.appendChild(v);
        }

        addField('Claim URL', d.claim_url);
        addField('Unlock Key', d.unlock_key);
        if (d.unlock_after_seconds > 0 && d.unlock_at) {
          addField('Available On (Time-Lock Embargo)', new Date(d.unlock_at).toLocaleString() + ' (' + d.unlock_at + ')');
        }

        var verP = document.createElement('p');
        verP.style.fontSize = '0.85rem';
        verP.style.margin = '8px 0';
        verP.textContent = 'Commit verified: ' + (d.commit_verified ? 'YES (ML-DSA-44)' : 'check manually');
        verP.className = d.commit_verified ? 'ok' : 'warn';
        el.appendChild(verP);

        var provLink = document.createElement('a');
        provLink.href = d.provenance_url;
        provLink.target = '_blank';
        provLink.rel = 'noopener noreferrer';
        provLink.className = 'btn btn-secondary';
        provLink.style.marginTop = '6px';
        provLink.textContent = 'Verify Provenance on BitBop';
        el.appendChild(provLink);

        var row = document.createElement('div');
        row.className = 'row';

        var smsA = document.createElement('a');
        smsA.className = 'btn btn-sms';
        smsA.href = d.sms_link;
        smsA.textContent = 'Send via SMS';

        var copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'btn btn-secondary';
        copyBtn.textContent = 'Copy SMS Body';
        copyBtn.addEventListener('click', function() { copyText(d.sms_body); });

        row.appendChild(smsA);
        row.appendChild(copyBtn);
        el.appendChild(row);
      })
      .catch(function(e) {
        btn.disabled = false;
        btn.textContent = 'Seal & Create Share Link';
        showMessage(e.message, '', 'err');
      })
      .finally(function() {
        sealInFlight = false;
        releaseHold();
      });
  });

  // Pure Browser-Side ML-KEM-768 + WebCrypto AES-256-GCM Decryption
  async function browserDecryptBitBopReveal(revealData, secretKeyBytes, kemInstance) {
    var cipher = revealData.cipher;
    var sealed = revealData.sealed_envelope;
    if (!cipher || !sealed) {
      throw new Error('Missing cipher or sealed_envelope in BitBop reveal response');
    }

    // Step 1: ML-KEM-768 decapsulation -> 32-byte sharedSecret
    var kyberCtBytes = hexToBytes(cipher.kyber_ciphertext_hex);
    var sharedSecret = await kemInstance.decap(kyberCtBytes, secretKeyBytes);

    // Step 2: AES-256-GCM decrypt cipher.aes_ciphertext_hex using raw sharedSecret -> 32 raw entropy bytes -> 64-char hex
    var transitKey = await crypto.subtle.importKey('raw', sharedSecret, { name: 'AES-GCM' }, false, ['decrypt']);
    var transitIv = hexToBytes(cipher.aes_iv_hex);
    var transitCt = hexToBytes(cipher.aes_ciphertext_hex);
    var rawEntropyBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: transitIv }, transitKey, transitCt);
    var entropyHex = bytesToHex(new Uint8Array(rawEntropyBuf));

    // Step 3: Derive envelope key = SHA-256(utf8(entropyHex)) and AES-256-GCM decrypt sealed_envelope.ciphertext_b64
    var envKeyDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(entropyHex));
    var envKey = await crypto.subtle.importKey('raw', envKeyDigest, { name: 'AES-GCM' }, false, ['decrypt']);
    var envIv = hexToBytes(sealed.iv_hex);
    var envCt = base64ToBytes(sealed.ciphertext_b64);
    var plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: envIv }, envKey, envCt);
    return new TextDecoder().decode(plainBuf);
  }

  // Update Time-Lock UI & 24-Hour HH:MM:SS Countdown
  function startTimelockCountdown(isoDateStr) {
    var parsed = Date.parse(isoDateStr);
    if (Number.isNaN(parsed)) return;
    unlockAtMs = parsed;
    timelockActive = true;
    uatRecorder.record({
      type: 'state',
      label: 'timelock_started',
      summary: { unlockAt: isoDateStr, unlockAtMs: unlockAtMs }
    });

    var box = document.getElementById('timelock-box');
    var heading = document.getElementById('timelock-heading');
    var dateText = document.getElementById('timelock-date-text');
    var wrap = document.getElementById('countdown-wrap');
    var clock = document.getElementById('countdown-clock');
    var sub = document.getElementById('countdown-sub');
    var hint = document.getElementById('timelock-hint');
    var revealBtn = document.getElementById('reveal-btn');

    box.style.display = 'block';
    dateText.textContent = 'Available: ' + new Date(unlockAtMs).toLocaleString();

    if (countdownTimer) clearInterval(countdownTimer);

    function tick() {
      var remSec = (unlockAtMs - Date.now()) / 1000;
      currentRemainingSeconds = Math.max(0, Math.ceil(remSec));
      if (remSec <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        timelockActive = false;
        currentRemainingSeconds = 0;
        uatRecorder.record({
          type: 'state',
          label: 'timelock_expired',
          summary: { unlockAt: isoDateStr }
        });
        heading.textContent = '🔓 Time-Lock Expired — Ready to Reveal';
        wrap.style.display = 'block';
        clock.textContent = '00:00:00';
        sub.textContent = 'Embargo window complete';
        revealBtn.disabled = false;
        revealBtn.textContent = 'Reveal / Decrypt';

        var enteredKey = document.getElementById('unlock').value.trim();
        if (enteredKey && !revealInFlight) {
          hint.textContent = 'Countdown reached 00:00:00 — auto-decrypting secret in browser...';
          performDirectBrowserReveal(enteredKey);
        } else {
          hint.textContent = 'Enter your Unlock Key below and click Reveal / Decrypt.';
        }
        return;
      }

      timelockActive = true;

      heading.textContent = '⏳ Time-Locked Secret (Embargo Active)';
      revealBtn.disabled = true;
      revealBtn.textContent = 'Locked Until Available Date';

      // Display the date it becomes available, then countdown in HH:MM:SS for the last 24 hours
      if (remSec <= 86400) {
        wrap.style.display = 'block';
        clock.textContent = formatHhMmSs(remSec);
        sub.textContent = 'Final 24-hour countdown (HH:MM:SS)';
      } else {
        wrap.style.display = 'none';
      }
    }

    tick();
    countdownTimer = setInterval(tick, 250);
  }

  // Direct Browser -> BitBop Edge Reveal (Zero queries to our app server!)
  async function performDirectBrowserReveal(unlockKeyStr) {
    if (revealInFlight) return;
    revealInFlight = true;
    var releaseHold = uatRecorder.beginHold('reveal', 'Direct browser decapsulation & reveal');
    var btn = document.getElementById('reveal-btn');
    btn.disabled = true;
    btn.textContent = 'Decrypting in Browser (ML-KEM-768)...';

    try {
      var kem = new window.BitBopMlKem.MlKem768();
      var kp = await kem.generateKeyPair();
      var publicKeyBytes = kp[0];
      var secretKeyBytes = kp[1];
      var pkHex = bytesToHex(publicKeyBytes);

      var r = await fetch(BITBOP_API + '/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: escrowId,
          unlock_key: unlockKeyStr,
          kyber_public_key: pkHex,
          signature_scheme: 'ml-dsa-44'
        })
      });
      var d = await r.json();

      if (r.status === 425) {
        if (d.unlock_at) startTimelockCountdown(d.unlock_at);
        showMessage('Time-Locked (425 Too Early)', 'Secret becomes available on ' + new Date(d.unlock_at).toLocaleString(), 'warn');
        return;
      }

      btn.disabled = false;
      btn.textContent = 'Reveal / Decrypt';

      if (r.status === 403) {
        showMessage('Wrong unlock key (403). Secret NOT burned.', 'Remaining attempts before backoff: ' + (d.remaining_attempts !== undefined ? d.remaining_attempts : 'retry'), 'err');
        return;
      }
      if (r.status === 409) {
        burned = true;
        showMessage('Secret permanently burned (409). Cannot retrieve again.', 'This one-time record was already unsealed and destroyed.', 'warn');
        return;
      }
      if (!r.ok) {
        showMessage(d.error || 'Reveal failed (' + r.status + ')', '', 'err');
        return;
      }

      // Decrypt ML-KEM-768 + AES-256-GCM directly in browser WebCrypto
      var plaintext = await browserDecryptBitBopReveal(d, secretKeyBytes, kem);
      secretPlaintext = plaintext;
      revealed = true;
      burned = true;
      lastError = null;

      uatRecorder.record({
        type: 'state',
        label: 'secret_revealed',
        summary: { escrowId: d.escrow_id, secretLength: plaintext.length }
      });

      // Verify ML-DSA-44 receipt directly against https://api.bitbop.dev/verify
      var verifyOk = false;
      try {
        var vr = await fetch(BITBOP_API + '/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(d)
        });
        var vd = await vr.json();
        verifyOk = vr.ok && vd.valid !== false;
      } catch (_) {}

      var provenanceUrl =
        'https://www.bitbop.dev/provenance?escrow_id=' +
        encodeURIComponent(d.escrow_id) +
        '&sequence=' +
        encodeURIComponent(String(d.beacon_sequence || ''));

      // Render decrypted secret using textContent (never innerHTML)
      var el = document.getElementById('result');
      el.style.display = 'block';
      el.style.borderColor = '#10B981';
      el.textContent = '';

      var h2 = document.createElement('h2');
      h2.className = 'ok';
      h2.style.margin = '0 0 8px';
      h2.style.fontSize = '1.15rem';
      h2.textContent = 'Secret Revealed (Burned)';
      el.appendChild(h2);

      var pwBox = document.createElement('div');
      pwBox.id = 'pw-display';
      pwBox.textContent = plaintext;
      el.appendChild(pwBox);

      var copyPwBtn = document.createElement('button');
      copyPwBtn.type = 'button';
      copyPwBtn.className = 'btn btn-secondary';
      copyPwBtn.style.marginTop = '4px';
      copyPwBtn.textContent = 'Copy Secret Password';
      copyPwBtn.addEventListener('click', function() { copyText(plaintext); });
      el.appendChild(copyPwBtn);

      var burnP = document.createElement('p');
      burnP.className = 'ok';
      burnP.style.fontSize = '0.85rem';
      burnP.textContent = 'This secret is now permanently burned in BitBop hardware escrow and cannot be read again.';
      el.appendChild(burnP);

      var verP = document.createElement('p');
      verP.style.fontSize = '0.85rem';
      verP.className = verifyOk ? 'ok' : 'warn';
      verP.textContent = 'Reveal verified: ' + (verifyOk ? 'YES (ML-DSA-44 Beacon #' + d.beacon_sequence + ')' : 'check manually');
      el.appendChild(verP);

      var provA = document.createElement('a');
      provA.href = provenanceUrl;
      provA.target = '_blank';
      provA.rel = 'noopener noreferrer';
      provA.className = 'btn btn-secondary';
      provA.textContent = 'View Provenance on BitBop';
      el.appendChild(provA);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Reveal / Decrypt';
      showMessage('Decryption error: ' + e.message, '', 'err');
    } finally {
      revealInFlight = false;
      releaseHold();
    }
  }

  // Probe BitBop directly on Claim Page load (without side-channel URL params or burning the secret)
  async function probeEscrowStatusOnLoad() {
    var releaseHold = uatRecorder.beginHold('probe', 'Probing escrow status on load');
    try {
      var kem = new window.BitBopMlKem.MlKem768();
      var kp = await kem.generateKeyPair();
      var pkHex = bytesToHex(kp[0]);

      var r = await fetch(BITBOP_API + '/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: escrowId,
          kyber_public_key: pkHex,
          signature_scheme: 'ml-dsa-44'
        })
      });
      var d = await r.json();

      if (r.status === 425 && d.unlock_at) {
        startTimelockCountdown(d.unlock_at);
      } else if (r.status === 409) {
        burned = true;
        showMessage('Secret permanently burned (409). Cannot retrieve again.', 'This one-time secret has already been claimed.', 'warn');
      }
    } catch (_) {
    } finally {
      releaseHold();
    }
  }

  if (escrowId) {
    currentEscrowId = escrowId;
    document.getElementById('admin-view').style.display = 'none';
    document.getElementById('claim-view').style.display = 'block';
    document.getElementById('claim-id').textContent = 'Escrow ID: ' + escrowId;
    probeEscrowStatusOnLoad();
  }

  document.getElementById('reveal-btn').addEventListener('click', function() {
    var key = document.getElementById('unlock').value.trim();
    if (!key) {
      showMessage('Enter unlock key.', '', 'err');
      return;
    }
    performDirectBrowserReveal(key);
  });
})();
</script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const rawUrl = req.url || '/';
    // Path traversal early defense: reject any parent escapement or encoded path tricks
    if (rawUrl.includes('..') || rawUrl.includes('%2e') || rawUrl.includes('%2E') || rawUrl.includes('\\') || rawUrl.includes('%5c') || rawUrl.includes('%5C')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    const u = new URL(rawUrl, 'http://localhost');

    // Root route /
    if (u.pathname === '/') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Allow': 'GET, HEAD',
        });
        res.end('Method not allowed');
        return;
      }
      const html = buildHtml();
      const buf = Buffer.from(html, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Content-Length': buf.length,
      });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(buf);
      }
      return;
    }

    // Favicon route /favicon.svg
    if (u.pathname === '/favicon.svg') {
      const faviconPath = path.join(PUBLIC_DIR, 'favicon.svg');
      const buf = getCachedSvg(faviconPath);
      if (!buf) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Favicon not found');
        return;
      }
      return serveSvgBuffer(req, res, buf);
    }

    // Badges route /badges/:filename
    if (u.pathname.startsWith('/badges/')) {
      // Layer 1: Strict Regex Whitelist
      const badgeMatch = u.pathname.match(/^\/badges\/([a-zA-Z0-9_-]+\.svg)$/);
      if (!badgeMatch) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Badge not found');
        return;
      }
      const badgeFilename = badgeMatch[1];

      // Layer 2: Canonical Directory Boundary Verification
      const resolvedPath = path.resolve(BADGES_DIR, badgeFilename);
      const normalizedBadgesDir = path.resolve(BADGES_DIR);
      if (!resolvedPath.startsWith(normalizedBadgesDir + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      // Layer 3: File existence & type check (via getCachedSvg)
      const buf = getCachedSvg(resolvedPath);
      if (!buf) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Badge not found');
        return;
      }
      return serveSvgBuffer(req, res, buf);
    }

    // Client-side ML-KEM bundle Route
    if (u.pathname === '/mlkem.browser.js') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', 'Allow': 'GET, HEAD' });
        res.end('Method not allowed');
        return;
      }
      const buf = Buffer.from(MLKEM_BROWSER_BUNDLE, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'Content-Length': buf.length,
      });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(buf);
      }
      return;
    }

    // Health route
    if (req.method === 'GET' && u.pathname === '/health') {
      return json(res, 200, { status: 'ok', service: 'SecretSender' });
    }

    // Share API route
    if (req.method === 'POST' && u.pathname === '/api/share') {
      const body = await readBody(req);
      try {
        const result = await handleShare(body, req);
        json(res, 200, result);
      } catch (e) {
        json(res, 500, { error: e.message });
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

export { buildHtml, handleShare, ensureBitBopApiKey };

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  server.listen(PORT, HOST, () => {
    console.log(`SecretSender listening on http://${HOST}:${PORT}`);
  });
}
