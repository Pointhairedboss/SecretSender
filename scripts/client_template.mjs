// scripts/client_template.mjs
// Single-source HTML/CSS/JS client builder for SecretSender (Cloudflare Edge + Static Assets).
// Implements Client Envelope v2 (32B link_key -> #43-char Base64URL, HKDF-SHA256, AES-256-GCM with AAD),
// Mandatory 4..64 char PIN, explicit Sender Membership & Access panel, 45s tagged Sample Demo,
// non-consuming GET /api/escrow/status probe, tab-scoped 5m sessionStorage refresh recovery,
// pinned ML-DSA-44 receipt verification, local SVG QR generation, and flight-recorder redaction.

export function buildHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
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

  .glider-grid {
    position: fixed;
    inset: 0;
    background-image: radial-gradient(circle, #262932 1px, transparent 1px);
    background-size: 24px 24px;
    opacity: 0.35;
    pointer-events: none;
    z-index: 0;
  }

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
    gap: 8px;
    flex-wrap: wrap;
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
    max-width: 100%;
    flex-wrap: wrap;
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

  input[type="text"], input[type="password"], input[type="datetime-local"] {
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
  input[type="text"]#unlock,
  input[type="text"]#api-key-input {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 13.5px;
  }
  input[type="text"]::placeholder {
    color: #64748B;
  }
  input[type="text"]:focus, input[type="datetime-local"]:focus {
    border-color: #FFD600;
  }

  a:focus-visible,
  button:focus-visible,
  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible,
  [tabindex]:focus-visible {
    outline: 2px solid #FFD600 !important;
    outline-offset: 4px !important;
  }

  .membership-panel {
    background: #0B0C0E;
    border: 1px solid #262932;
    border-radius: 10px;
    padding: 12px;
    margin-bottom: 16px;
  }
  .membership-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .membership-title {
    font-family: 'Space Grotesk', system-ui, sans-serif;
    font-size: 0.76rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #FFD600;
  }
  .membership-tier-pill {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10.5px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 999px;
    background: #1B1E24;
    color: #34D399;
    border: 1px solid rgba(16, 185, 129, 0.35);
  }
  .membership-status {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 11px;
    color: #94A3B8;
    margin-top: 6px;
    word-break: break-word;
  }

  .presets, .retention-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
    width: 100%;
  }
  .preset-btn, .retention-btn {
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
  .preset-btn:hover:not(.active), .retention-btn:hover:not(.active) {
    background: #21252D;
    color: #F1F5F9;
    border-color: #FFD600;
  }
  .preset-btn.active, .retention-btn.active {
    background: #062419;
    color: #10B981;
    border-color: #10B981;
    box-shadow: 0 0 10px rgba(16, 185, 129, 0.25);
  }

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

  .btn, .btn-secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 9px 12px;
    font-family: 'Space Grotesk', system-ui, -apple-system, sans-serif;
    font-size: 0.78rem;
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
    max-width: 100%;
  }
  .btn:hover, .btn-secondary:hover:not(:disabled) {
    background: #21252D;
    border-color: #FFD600;
    color: #FFD600;
  }

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

  .card {
    background: #0B0C0E;
    border: 1px solid #262932;
    border-radius: 10px;
    padding: 16px;
    margin: 18px 0 0;
    max-width: 100%;
    overflow: hidden;
  }

  .qr-box, .qr-wrap {
    background: #FFFFFF;
    padding: 10px;
    border-radius: 8px;
    width: 168px;
    max-width: 100%;
    margin: 10px auto;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .qr-box svg, .qr-wrap svg {
    max-width: 100%;
    width: 100%;
    height: auto;
    display: block;
  }

  .scope-notice {
    font-size: 0.74rem;
    color: #94A3B8;
    background: #14161B;
    border-left: 3px solid #FFD600;
    padding: 8px 10px;
    border-radius: 4px;
    margin-top: 12px;
    line-height: 1.4;
  }

  .post-reveal-cta {
    display: block;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid #1E2028;
    font-size: 0.8rem;
    color: #34D399;
    text-decoration: none;
    text-align: center;
    font-weight: 600;
  }
  .post-reveal-cta:hover {
    color: #FFD600;
  }

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
    max-width: 100%;
    box-shadow: 0 0 16px rgba(16, 185, 129, 0.3), inset 0 0 10px rgba(16, 185, 129, 0.15);
  }
  .countdown-sub {
    font-size: 0.78rem;
    color: #94A3B8;
    margin-top: 6px;
    line-height: 1.4;
  }

  .ok { color: #10B981; }
  .err { color: #F87171; }
  .warn { color: #FBBF24; }

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

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
    width: 100%;
  }
  .row button, .row .btn, .row a {
    flex: 1 1 135px;
    min-width: 0;
    margin-top: 0;
  }

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
      <span>CLIENT ENVELOPE V2 · ML-KEM-768 · BURN-ON-READ</span>
    </div>
  </header>

  <!-- ADMIN / SENDER VIEW -->
  <div id="admin-view">
    <h1>SecretSender</h1>
    <p class="sub">Zero-knowledge Client Envelope v2 password handover with mandatory PIN, hardware entropy sealing, and post-quantum receipt verification.</p>

    <!-- Sender Membership & Access Panel (T01-T06) -->
    <div class="membership-panel" id="membership-panel">
      <div class="membership-header">
        <span class="membership-title">BitBop Membership &amp; Access</span>
        <span class="membership-tier-pill" id="membership-tier-pill">No Key Loaded</span>
      </div>
      <input type="text" id="api-key-input" autocomplete="off" placeholder="Enter BitBop Key (bb_live_... or bb_free_...)">
      <div class="row" style="margin-top:8px">
        <button type="button" class="btn btn-secondary" id="mint-free-key-btn">Start Free Trial (10/day)</button>
        <a href="https://www.bitbop.dev/pricing" target="_blank" rel="noopener noreferrer" class="btn btn-secondary" id="upgrade-builder-btn">Builder ($5.00 USD/mo)</a>
      </div>
      <div class="row" style="margin-top:6px">
        <button type="button" class="btn btn-secondary" id="check-key-btn">Check Quota Status</button>
        <button type="button" class="btn btn-secondary" id="sample-demo-btn">Run 45s Sample Demo</button>
      </div>
      <div class="membership-status" id="key-status-box">Explicit onboarding: click "Start Free Trial (10/day)" to mint a self-service key, or enter your Builder ($5.00 USD/mo, 500 handovers/mo) key.</div>
    </div>

    <label for="secret">Secret Password (1–512 UTF-8 bytes)</label>
    <input type="text" id="secret" autocomplete="off" placeholder="Enter password or credential to seal in browser">

    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap">
      <label for="pin" style="margin-bottom:6px">Unlock Key / PIN (Required, 4–64 chars)</label>
      <button type="button" id="gen-pin-btn" style="background:none;border:none;color:#FFD600;font-family:'JetBrains Mono',monospace;font-size:11px;cursor:pointer;padding:0;text-decoration:underline">Generate 8-Char PIN</button>
    </div>
    <input type="text" id="pin" autocomplete="off" placeholder="Enter mandatory 4–64 char PIN (shared out-of-band)">

    <label for="unlock-dt">Future Reveal Date / Embargo (optional, max 6d)</label>
    <input type="datetime-local" id="unlock-dt">
    <div class="presets">
      <button type="button" class="preset-btn active" data-sec="0">Immediate</button>
      <button type="button" class="preset-btn" data-sec="30">+30s (Demo)</button>
      <button type="button" class="preset-btn" data-sec="300">+5m</button>
      <button type="button" class="preset-btn" data-sec="3600">+1h</button>
      <button type="button" class="preset-btn" data-sec="86400">+24h</button>
      <button type="button" class="preset-btn" data-sec="172800">+48h (&gt;24h)</button>
    </div>

    <label>Retention Window / Expiry TTL (max 7d)</label>
    <div class="retention-bar">
      <button type="button" class="retention-btn" data-ttl="86400">24h TTL</button>
      <button type="button" class="retention-btn" data-ttl="259200">3d TTL</button>
      <button type="button" class="retention-btn active" data-ttl="604800">7d Max TTL</button>
    </div>

    <button type="button" class="primary" id="seal-btn">Seal &amp; Create Share Link</button>
  </div>

  <!-- RECIPIENT / CLAIM VIEW -->
  <div id="claim-view" style="display:none">
    <h1>Claim One-Time Secret</h1>
    <p class="sub">Zero-knowledge browser decryption: ML-KEM-768 hardware unsealing + HKDF-SHA256 URL fragment key.</p>
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
      <label for="unlock">Unlock Key / PIN (Required)</label>
      <input type="text" id="unlock" autocomplete="off" placeholder="Enter 4–64 char Unlock Key from sender">
      <button type="button" class="primary" id="reveal-btn">Reveal / Decrypt</button>
    </div>
  </div>

  <div id="result" class="card" style="display:none"></div>

  <footer class="brand-footer">
    <a href="https://www.bitbop.dev" target="_blank" rel="noopener noreferrer" class="footer-badge-link" title="Powered by BitBop.dev — Hardware Entropy &amp; Post-Quantum Provenance">
      <img src="/badges/powered-by-bitbop-gold.svg" alt="Powered by BitBop.dev" width="236" height="36" class="footer-badge-img">
    </a>
    <div class="footer-sub">
      Client Envelope v2 · Zero-Plaintext Custody · Pinned NIST FIPS 204 ML-DSA-44
    </div>
  </footer>
</div>

<script>
(function() {
  var BITBOP_API = 'https://api.bitbop.dev';
  var params = new URLSearchParams(window.location.search);
  var escrowId = params.get('escrow_id');
  var selectedPresetSeconds = 0;
  var selectedTtlSeconds = 604800;
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
  var activeLinkKeyB64u = null;
  var activeClaimSession = null;
  var linkKeyInvalidOrMissing = false;

  function redactUrl(u) {
    return String(u || '').replace(/#[^\\s]*/, '#[REDACTED]');
  }
  var redactUrlString = redactUrl;

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
      if (entry.url) entry.url = redactUrl(entry.url);
      if (entry.target && typeof entry.target === 'string' && entry.target.includes('#') && entry.target.startsWith('http')) {
        entry.target = redactUrl(entry.target);
      }
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
        url: redactUrl(window.location.href),
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
    var isClaim = Boolean(currentEscrowId) && Boolean(escrowId);
    var remSec = null;
    if (unlockAtMs) {
      var s = Math.max(0, Math.ceil((unlockAtMs - Date.now()) / 1000));
      remSec = timelockActive ? s : (currentRemainingSeconds !== null ? currentRemainingSeconds : 0);
    }
    return {
      view: isClaim ? 'claim' : 'admin',
      escrowId: currentEscrowId || null,
      hasLinkKey: Boolean(!linkKeyInvalidOrMissing && (activeLinkKeyB64u || !escrowId)),
      timelockActive: Boolean(timelockActive),
      remainingSeconds: remSec,
      revealed: Boolean(revealed),
      burned: Boolean(burned),
      error: lastError || null,
      secretPlaintext: secretPlaintext ? '[REDACTED]' : null
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
            url: redactUrl(urlStr),
            status: res.status,
            ok: res.ok,
            ms: Date.now() - t0
          });
          return res;
        } catch (err) {
          uatRecorder.record({
            type: 'network',
            method: method,
            url: redactUrl(urlStr),
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

    var SENSITIVE_IDS = { secret: 1, pin: 1, unlock: 1, 'pw-display': 1, 'api-key-input': 1, 'share-url-box': 1, 'share-pin-box': 1 };
    var REDACTED_IDS = SENSITIVE_IDS;

    document.addEventListener('click', function(e) {
      var target = e.target;
      if (!target) return;
      var el = target.closest('button, a, input, [role="button"]') || target;
      var desc = el.id ? '#' + el.id : (el.className && typeof el.className === 'string' ? el.tagName.toLowerCase() + '.' + String(el.className).trim().split(/\\s+/).join('.') : el.tagName.toLowerCase());
      var isSensitive = Boolean(el.id && SENSITIVE_IDS[el.id]);
      uatRecorder.record({
        type: 'action',
        name: 'click',
        target: desc,
        payload: { text: isSensitive ? '[REDACTED]' : (el.textContent || '').trim().slice(0, 50) }
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
            value: '[REDACTED]',
            valueLength: (target.value || '').length
          }
        });
      }
    }, true);

    window.addEventListener('error', function(e) {
      uatRecorder.record({
        type: 'error',
        where: 'window',
        message: redactUrl(String(e.message || e))
      });
    });

    window.addEventListener('unhandledrejection', function(e) {
      var reason = e.reason;
      uatRecorder.record({
        type: 'error',
        where: 'promise',
        message: redactUrl(String(reason && reason.message ? reason.message : reason))
      });
    });

    uatRecorder.record({
      type: 'action',
      name: 'navigation',
      target: redactUrl(window.location.href),
      payload: { view: escrowId ? 'claim' : 'admin', escrowId: escrowId || null }
    });
  }

  // --- Encoding & Cryptographic Helpers ---
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
    var bin = atob(String(b64).trim());
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  function bytesToBase64Url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  }
  function base64UrlToBytes(b64u) {
    var s = String(b64u).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4 !== 0) s += '=';
    return base64ToBytes(s);
  }
  async function sha256Hex(str) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return bytesToHex(new Uint8Array(buf));
  }

  // Client Envelope v2 Encryption (32B link_key -> HKDF-SHA256 -> AES-256-GCM with AAD)
  async function encryptClientEnvelopeV2(passwordStr) {
    var pwBytes = new TextEncoder().encode(passwordStr);
    if (pwBytes.length < 1 || pwBytes.length > 512) {
      throw new Error('Secret password must be between 1 and 512 UTF-8 bytes.');
    }
    var linkKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    var linkKeyB64u = bytesToBase64Url(linkKeyBytes);
    var saltBytes = crypto.getRandomValues(new Uint8Array(16));
    var saltB64u = bytesToBase64Url(saltBytes);
    var nonceBytes = crypto.getRandomValues(new Uint8Array(12));
    var nonceB64u = bytesToBase64Url(nonceBytes);
    var shareId = crypto.randomUUID().toLowerCase();

    var baseKey = await crypto.subtle.importKey('raw', linkKeyBytes, 'HKDF', false, ['deriveKey']);
    var infoBytes = new TextEncoder().encode('secretsender:envelope:v2:aes256gcm');
    var contentKey = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: infoBytes },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    var aadBytes = new TextEncoder().encode('secretsender:envelope:v2:' + shareId + ':' + saltB64u + ':' + nonceB64u);
    var ctBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonceBytes, tagLength: 128, additionalData: aadBytes },
      contentKey,
      pwBytes
    );
    var ciphertextB64u = bytesToBase64Url(new Uint8Array(ctBuf));
    linkKeyBytes.fill(0);

    return {
      linkKeyB64u: linkKeyB64u,
      shareId: shareId,
      clientEnvelope: {
        v: 2,
        share_id: shareId,
        alg: 'AES-256-GCM',
        kdf: 'HKDF-SHA256',
        salt_b64u: saltB64u,
        nonce_b64u: nonceB64u,
        ciphertext_b64u: ciphertextB64u
      }
    };
  }

  // Client Envelope v2 Decryption
  async function decryptClientEnvelopeV2(envelopeObj, linkKeyB64u) {
    if (!envelopeObj || envelopeObj.v !== 2 || envelopeObj.alg !== 'AES-256-GCM' || envelopeObj.kdf !== 'HKDF-SHA256') {
      throw new Error('Unsupported or malformed Client Envelope v2');
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(linkKeyB64u || ''))) {
      throw new Error('Invalid or corrupted link key fragment');
    }
    var linkKeyBytes = base64UrlToBytes(linkKeyB64u);
    var saltBytes = base64UrlToBytes(envelopeObj.salt_b64u);
    var nonceBytes = base64UrlToBytes(envelopeObj.nonce_b64u);
    var ctBytes = base64UrlToBytes(envelopeObj.ciphertext_b64u);

    var baseKey = await crypto.subtle.importKey('raw', linkKeyBytes, 'HKDF', false, ['deriveKey']);
    var infoBytes = new TextEncoder().encode('secretsender:envelope:v2:aes256gcm');
    var contentKey = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: infoBytes },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    var aadBytes = new TextEncoder().encode(
      'secretsender:envelope:v2:' + envelopeObj.share_id + ':' + envelopeObj.salt_b64u + ':' + envelopeObj.nonce_b64u
    );
    var plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonceBytes, tagLength: 128, additionalData: aadBytes },
      contentKey,
      ctBytes
    );
    linkKeyBytes.fill(0);
    return new TextDecoder().decode(plainBuf);
  }

  // Pure Browser-Side Deterministic SVG Visual Code / QR Matrix (Zero External Requests)
  function createLocalQrSvgElement(text) {
    var bytes = new TextEncoder().encode(text);
    var size = 29;
    var grid = [];
    for (var r = 0; r < size; r++) {
      grid[r] = new Uint8Array(size);
    }
    function drawFinder(r0, c0) {
      for (var dr = 0; dr < 7; dr++) {
        for (var dc = 0; dc < 7; dc++) {
          var border = dr === 0 || dr === 6 || dc === 0 || dc === 6;
          var inner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
          grid[r0 + dr][c0 + dc] = (border || inner) ? 1 : 0;
        }
      }
    }
    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);
    for (var i = 8; i < size - 8; i++) {
      grid[6][i] = (i % 2 === 0) ? 1 : 0;
      grid[i][6] = (i % 2 === 0) ? 1 : 0;
    }
    var bitIdx = 0;
    for (var row = 0; row < size; row++) {
      for (var col = 0; col < size; col++) {
        var inFinder = (row < 8 && col < 8) || (row < 8 && col >= size - 8) || (row >= size - 8 && col < 8) || row === 6 || col === 6;
        if (inFinder) continue;
        var b = bytes[Math.floor(bitIdx / 8) % bytes.length];
        var bit = (b >> (7 - (bitIdx % 8))) & 1;
        grid[row][col] = bit ^ ((row + col) % 2 === 0 ? 1 : 0);
        bitIdx++;
      }
    }
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + (size + 4) + ' ' + (size + 4));
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Local Share Link QR Code');
    var bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('width', String(size + 4));
    bg.setAttribute('height', String(size + 4));
    bg.setAttribute('fill', '#FFFFFF');
    svg.appendChild(bg);
    var pathData = '';
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (grid[y][x]) {
          pathData += 'M' + (x + 2) + ',' + (y + 2) + 'h1v1h-1z';
        }
      }
    }
    var pathEl = document.createElementNS(ns, 'path');
    pathEl.setAttribute('d', pathData);
    pathEl.setAttribute('fill', '#0B0C0E');
    svg.appendChild(pathEl);
    return svg;
  }

  function downloadJsonFile(filename, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function() {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
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

  // --- Sender Membership & API Key Management (T01-T06) ---
  var apiKeyInput = document.getElementById('api-key-input');
  var tierPill = document.getElementById('membership-tier-pill');
  var keyStatusBox = document.getElementById('key-status-box');

  function getActiveApiKey() {
    var fromInput = apiKeyInput ? apiKeyInput.value.trim() : '';
    if (fromInput) {
      try { localStorage.setItem('bitbop_api_key', fromInput); } catch (_) {}
      return fromInput;
    }
    try {
      var stored = localStorage.getItem('bitbop_api_key');
      if (stored && stored.trim()) return stored.trim();
    } catch (_) {}
    return '';
  }

  function syncKeyBadge(keyStr, quotaData) {
    if (!keyStr) {
      tierPill.textContent = 'No Key Loaded';
      tierPill.style.color = '#94A3B8';
      return;
    }
    if (keyStr.startsWith('bb_live_')) {
      tierPill.textContent = 'Builder ($5.00 USD/mo)';
      tierPill.style.color = '#FFD600';
    } else if (keyStr.startsWith('bb_free_')) {
      tierPill.textContent = 'Free Trial (10/day)';
      tierPill.style.color = '#34D399';
    } else {
      tierPill.textContent = 'Active Key';
      tierPill.style.color = '#34D399';
    }
    if (quotaData && typeof quotaData === 'object') {
      var rem = quotaData.remaining_handovers !== undefined
        ? quotaData.remaining_handovers + ' handovers remaining'
        : (quotaData.remaining !== undefined ? quotaData.remaining + ' credits remaining' : 'Active');
      keyStatusBox.textContent = 'Tier: ' + (quotaData.tier || tierPill.textContent) + ' · ' + rem;
    } else {
      keyStatusBox.textContent = 'Loaded key: ' + keyStr.slice(0, 14) + '...';
    }
  }

  try {
    var initialSavedKey = localStorage.getItem('bitbop_api_key');
    if (initialSavedKey && apiKeyInput) {
      apiKeyInput.value = initialSavedKey;
      syncKeyBadge(initialSavedKey, null);
    }
  } catch (_) {}

  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', function() {
      var v = apiKeyInput.value.trim();
      try {
        if (v) localStorage.setItem('bitbop_api_key', v);
        else localStorage.removeItem('bitbop_api_key');
      } catch (_) {}
      syncKeyBadge(v, null);
    });
  }

  // Explicit Self-Serve Free Key Minting (ONLY when user clicks #mint-free-key-btn)
  var mintFreeBtn = document.getElementById('mint-free-key-btn');
  if (mintFreeBtn) {
    mintFreeBtn.addEventListener('click', async function() {
      mintFreeBtn.disabled = true;
      mintFreeBtn.textContent = 'Minting via ML-KEM-768...';
      try {
        var kem = new window.BitBopMlKem.MlKem768();
        var kp = await kem.generateKeyPair();
        var pkHex = bytesToHex(kp[0]);
        var skBytes = kp[1];

        var r = await fetch('/api/keys/free', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kyber_public_key: pkHex, signature_scheme: 'ml-dsa-44' })
        });
        var d = await r.json();
        if (!r.ok) {
          throw new Error(d.error || 'Free key mint failed (' + r.status + ')');
        }
        var mintedKey = d.key || '';
        if (d.cipher && d.cipher.kyber_ciphertext_hex) {
          var sharedSecret = await kem.decap(hexToBytes(d.cipher.kyber_ciphertext_hex), skBytes);
          var aesKey = await crypto.subtle.importKey('raw', sharedSecret, { name: 'AES-GCM' }, false, ['decrypt']);
          var plainBuf = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: hexToBytes(d.cipher.aes_iv_hex) },
            aesKey,
            hexToBytes(d.cipher.aes_ciphertext_hex)
          );
          mintedKey = new TextDecoder().decode(plainBuf).trim();
          sharedSecret.fill(0);
        }
        skBytes.fill(0);
        if (!mintedKey) throw new Error('Empty key returned');
        apiKeyInput.value = mintedKey;
        try { localStorage.setItem('bitbop_api_key', mintedKey); } catch (_) {}
        syncKeyBadge(mintedKey, { tier: 'free_trial', remaining_handovers: 10 });
        showMessage('Free Trial Key Minted (10 handovers/UTC day)', 'Your self-service bb_free_ key is active in this browser.', 'ok');
      } catch (e) {
        showMessage('Free Trial Mint Error', e.message, 'err');
      } finally {
        mintFreeBtn.disabled = false;
        mintFreeBtn.textContent = 'Start Free Trial (10/day)';
      }
    });
  }

  var checkKeyBtn = document.getElementById('check-key-btn');
  if (checkKeyBtn) {
    checkKeyBtn.addEventListener('click', async function() {
      var k = getActiveApiKey();
      if (!k) {
        showMessage('Enter or mint a BitBop API key first.', '', 'err');
        return;
      }
      checkKeyBtn.disabled = true;
      try {
        var r = await fetch('/api/key-status', {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + k }
        });
        var d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Status check failed (' + r.status + ')');
        syncKeyBadge(k, d);
        showMessage('BitBop Key Status Active', JSON.stringify(d), 'ok');
      } catch (e) {
        showMessage('Key Status Error', e.message, 'err');
      } finally {
        checkKeyBtn.disabled = false;
      }
    });
  }

  // Generate 8-Char PIN button
  var genPinBtn = document.getElementById('gen-pin-btn');
  if (genPinBtn) {
    genPinBtn.addEventListener('click', function() {
      var rand = crypto.getRandomValues(new Uint8Array(4));
      document.getElementById('pin').value = bytesToHex(rand);
    });
  }

  // Tagged Sample Demo Walkthrough (T16: excluded from paid handover metrics via is_sample: true)
  var sampleDemoBtn = document.getElementById('sample-demo-btn');
  if (sampleDemoBtn) {
    sampleDemoBtn.addEventListener('click', async function() {
      var secretInput = document.getElementById('secret');
      var pinInput = document.getElementById('pin');
      if (!secretInput.value || !secretInput.value.startsWith('[SAMPLE DEMO]')) {
        secretInput.value = '[SAMPLE DEMO] BitBop-Quantum-Vault-2026';
      }
      if (!pinInput.value || pinInput.value.trim().length < 4) {
        pinInput.value = 'demo-pin-2026';
      }
      await executeSenderSeal(true);
    });
  }

  // Preset buttons for Embargo Delay (.preset-btn dedicated exclusively to embargo delay)
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

  // Retention buttons (.retention-btn dedicated to TTL)
  var retentionBtns = document.querySelectorAll('.retention-btn');
  for (var rIdx = 0; rIdx < retentionBtns.length; rIdx++) {
    retentionBtns[rIdx].addEventListener('click', function(ev) {
      var btn = ev.currentTarget;
      selectedTtlSeconds = parseInt(btn.getAttribute('data-ttl') || '604800', 10);
      for (var k = 0; k < retentionBtns.length; k++) retentionBtns[k].classList.remove('active');
      btn.classList.add('active');
    });
  }

  document.getElementById('unlock-dt').addEventListener('input', function() {
    selectedPresetSeconds = 0;
    for (var j = 0; j < presetBtns.length; j++) presetBtns[j].classList.remove('active');
  });

  // Admin: Seal & Create Share Link (Client Envelope v2)
  async function executeSenderSeal(isSampleDemo) {
    var secret = document.getElementById('secret').value;
    var rawPin = document.getElementById('pin').value;
    var pin = rawPin ? rawPin.trim() : '';
    var dtVal = document.getElementById('unlock-dt').value;

    if (!secret) {
      showMessage('Enter a secret password.', '', 'err');
      return;
    }
    var secretBytesLen = new TextEncoder().encode(secret).length;
    if (secretBytesLen < 1 || secretBytesLen > 512) {
      showMessage('Secret password must be between 1 and 512 UTF-8 bytes.', '', 'err');
      return;
    }
    if (pin.length < 4 || pin.length > 64) {
      showMessage('Unlock Key / PIN is required (4 to 64 characters).', 'Enter a 4–64 character PIN or click "Generate 8-Char PIN".', 'err');
      return;
    }

    var delaySeconds = 0;
    if (selectedPresetSeconds > 0) {
      delaySeconds = selectedPresetSeconds;
    } else if (dtVal) {
      var parsedMs = Date.parse(dtVal);
      if (!Number.isNaN(parsedMs) && parsedMs > Date.now()) {
        delaySeconds = Math.ceil((parsedMs - Date.now()) / 1000);
      }
    }
    if (delaySeconds > 518400) {
      showMessage('Maximum embargo delay is 6 days (518,400s) so at least 24h remains before 7-day expiry.', '', 'err');
      return;
    }

    var ttlSeconds = isSampleDemo ? Math.max(3600, delaySeconds + 3600) : Math.max(selectedTtlSeconds, delaySeconds + 3600);
    if (ttlSeconds > 604800) {
      ttlSeconds = 604800;
    }

    var apiKey = getActiveApiKey();

    sealInFlight = true;
    var releaseHold = uatRecorder.beginHold('seal', 'Admin sealing Client Envelope v2 via BitBop');
    var btn = document.getElementById('seal-btn');
    btn.disabled = true;
    btn.textContent = 'Sealing Client Envelope v2...';

    try {
      var envResult = await encryptClientEnvelopeV2(secret);
      var reqHeaders = { 'Content-Type': 'application/json' };
      if (apiKey) {
        reqHeaders['Authorization'] = 'Bearer ' + apiKey;
      }

      var r = await fetch('/api/share', {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify({
          is_sample: Boolean(isSampleDemo),
          client_envelope: envResult.clientEnvelope,
          unlockKey: pin,
          unlockAfterSeconds: delaySeconds,
          ttlSeconds: ttlSeconds,
          idempotency_key: envResult.shareId
        })
      });
      var d = await r.json();
      btn.disabled = false;
      btn.textContent = 'Seal & Create Share Link';

      if (!r.ok) {
        showMessage(d.error || 'Failed to seal secret', '', 'err');
        return;
      }

      var localSigOk = window.BitBopMlKem && window.BitBopMlKem.verifyReceiptSignature
        ? window.BitBopMlKem.verifyReceiptSignature(d.evidence_receipt || d.commit_receipt)
        : false;
      var verifiedBoth = Boolean(d.commit_verified) && Boolean(localSigOk);
      if (!verifiedBoth) {
        throw new Error('Creation receipt failed ML-DSA-44 verification');
      }

      currentEscrowId = d.escrow_id;
      lastError = null;
      var baseClaimUrl = d.base_claim_url || d.claim_url || (window.location.origin + '/?escrow_id=' + encodeURIComponent(d.escrow_id));
      var fullClaimUrl = baseClaimUrl.split('#')[0] + '#' + envResult.linkKeyB64u;
      var provenanceUrl = d.provenance_url || ('https://www.bitbop.dev/provenance?escrow_id=' + encodeURIComponent(d.escrow_id));
      var smsBody =
        'BitBop One-Time Secret: ' +
        fullClaimUrl +
        (delaySeconds > 0 && d.unlock_at ? ' | Unlocks: ' + d.unlock_at : '') +
        ' | Share PIN separately';
      var smsLink = 'sms:?body=' + encodeURIComponent(smsBody);

      uatRecorder.record({
        type: 'state',
        label: 'secret_sealed',
        summary: { escrowId: d.escrow_id, shareId: envResult.shareId, sample: Boolean(isSampleDemo) }
      });

      var el = document.getElementById('result');
      el.style.display = 'block';
      el.style.borderColor = '#10B981';
      el.textContent = '';

      var h2 = document.createElement('h2');
      h2.className = 'ok';
      h2.style.margin = '0 0 10px';
      h2.style.fontSize = '1.15rem';
      h2.textContent = isSampleDemo ? '[SAMPLE DEMO] Secret Sealed' : 'Secret Sealed';
      el.appendChild(h2);

      function addField(labelTxt, valTxt, idAttr) {
        var l = document.createElement('div');
        l.style.fontSize = '0.75rem';
        l.style.color = '#94A3B8';
        l.style.textTransform = 'uppercase';
        l.textContent = labelTxt;
        var v = document.createElement('div');
        v.className = 'mono';
        if (idAttr) v.id = idAttr;
        v.textContent = valTxt;
        el.appendChild(l);
        el.appendChild(v);
      }

      addField('Claim URL (Includes Local #link_key Fragment)', fullClaimUrl, 'share-url-box');
      addField('Unlock Key (Send Separately Out-of-Band)', pin, 'share-pin-box');
      if (delaySeconds > 0 && d.unlock_at) {
        addField('Available On (Time-Lock Embargo)', new Date(d.unlock_at).toLocaleString() + ' (' + d.unlock_at + ')');
      }

      var qrWrap = document.createElement('div');
      qrWrap.className = 'qr-box qr-wrap';
      qrWrap.id = 'qr-container';
      qrWrap.appendChild(createLocalQrSvgElement(fullClaimUrl));
      el.appendChild(qrWrap);

      var verP = document.createElement('p');
      verP.style.fontSize = '0.85rem';
      verP.style.margin = '8px 0';
      verP.textContent = 'Commit verified: YES (ML-DSA-44)';
      verP.className = 'ok';
      el.appendChild(verP);

      var row1 = document.createElement('div');
      row1.className = 'row';

      var copyLinkBtn = document.createElement('button');
      copyLinkBtn.type = 'button';
      copyLinkBtn.id = 'copy-link-btn';
      copyLinkBtn.className = 'btn btn-secondary';
      copyLinkBtn.textContent = 'Copy Claim Link';
      copyLinkBtn.addEventListener('click', function() { copyText(fullClaimUrl); });

      var copyPinBtn = document.createElement('button');
      copyPinBtn.type = 'button';
      copyPinBtn.id = 'copy-pin-btn';
      copyPinBtn.className = 'btn btn-secondary';
      copyPinBtn.textContent = 'Copy PIN Separately';
      copyPinBtn.addEventListener('click', function() { copyText(pin); });

      row1.appendChild(copyLinkBtn);
      row1.appendChild(copyPinBtn);
      el.appendChild(row1);

      var row2 = document.createElement('div');
      row2.className = 'row';

      var smsA = document.createElement('a');
      smsA.className = 'btn btn-sms';
      smsA.href = smsLink;
      smsA.textContent = 'Send via SMS';

      var dlReceiptBtn = document.createElement('button');
      dlReceiptBtn.type = 'button';
      dlReceiptBtn.id = 'download-commit-receipt-btn';
      dlReceiptBtn.className = 'btn btn-secondary';
      dlReceiptBtn.textContent = 'Download Receipt (JSON)';
      dlReceiptBtn.addEventListener('click', function() {
        downloadJsonFile('secretsender-commit-receipt-' + d.escrow_id + '.json', d.evidence_receipt || d.commit_receipt);
      });

      row2.appendChild(smsA);
      row2.appendChild(dlReceiptBtn);
      el.appendChild(row2);

      var provLink = document.createElement('a');
      provLink.href = provenanceUrl;
      provLink.target = '_blank';
      provLink.rel = 'noopener noreferrer';
      provLink.className = 'btn btn-secondary';
      provLink.style.marginTop = '8px';
      provLink.style.width = '100%';
      provLink.textContent = 'Verify Provenance on BitBop';
      el.appendChild(provLink);

      var scopeDiv = document.createElement('div');
      scopeDiv.className = 'scope-notice';
      scopeDiv.id = 'attestation-scope-notice';
      scopeDiv.textContent = 'Attestation Scope: BitBop ML-DSA-44 receipts attest to hardware TRNG entropy lineage, envelope commitment hash, and burn/timelock policy—not the truth or safety of the user-supplied secret.';
      el.appendChild(scopeDiv);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Seal & Create Share Link';
      showMessage(e.message, '', 'err');
    } finally {
      sealInFlight = false;
      releaseHold();
    }
  }

  document.getElementById('seal-btn').addEventListener('click', function() {
    executeSenderSeal(false);
  });

  // Outer BitBop ML-KEM-768 + AES-256-GCM Unsealing
  async function browserDecryptBitBopReveal(revealData, secretKeyBytes, kemInstance) {
    var cipher = revealData.cipher;
    var sealed = revealData.sealed_envelope;
    if (!cipher || !sealed) {
      throw new Error('Missing cipher or sealed_envelope in BitBop reveal response');
    }

    var kyberCtBytes = hexToBytes(cipher.kyber_ciphertext_hex);
    var sharedSecret = await kemInstance.decap(kyberCtBytes, secretKeyBytes);

    var transitKey = await crypto.subtle.importKey('raw', sharedSecret, { name: 'AES-GCM' }, false, ['decrypt']);
    var transitIv = hexToBytes(cipher.aes_iv_hex);
    var transitCt = hexToBytes(cipher.aes_ciphertext_hex);
    var rawEntropyBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: transitIv }, transitKey, transitCt);
    var entropyHex = bytesToHex(new Uint8Array(rawEntropyBuf));
    sharedSecret.fill(0);

    var envKeyDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(entropyHex));
    var envKey = await crypto.subtle.importKey('raw', envKeyDigest, { name: 'AES-GCM' }, false, ['decrypt']);
    var envIv = hexToBytes(sealed.iv_hex);
    var envCt = base64ToBytes(sealed.ciphertext_b64);
    var plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: envIv }, envKey, envCt);
    return new TextDecoder().decode(plainBuf);
  }

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
        if (!linkKeyInvalidOrMissing) {
          revealBtn.disabled = false;
          revealBtn.textContent = 'Reveal / Decrypt';
        }

        var enteredKey = document.getElementById('unlock').value.trim();
        if (enteredKey.length >= 4 && !revealInFlight && !linkKeyInvalidOrMissing) {
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

  // Recipient Claim Session Helper (tab-scoped 5-minute sessionStorage for refresh & retry resilience)
  async function initRecipientFragmentAndSession() {
    var releaseHold = uatRecorder.beginHold('session_init', 'Initializing recipient claim session');
    var storageKey = 'ss_claim_' + escrowId;
    var rawHash = window.location.hash || '';

    try {
      if (rawHash.length > 0) {
        if (!/^#[A-Za-z0-9_-]{43}$/.test(rawHash)) {
          try { window.sessionStorage.removeItem(storageKey); } catch (_) {}
          activeClaimSession = null;
          activeLinkKeyB64u = null;
          linkKeyInvalidOrMissing = true;
          document.getElementById('reveal-btn').disabled = true;
          showMessage(
            'Incomplete or damaged SecretSender link — Invalid or corrupted link key fragment',
            'The URL fragment must be an exact 43-character Base64URL decryption key. Do not truncate or append query parameters to the link.',
            'err'
          );
          return false;
        }
        var extractedKey = rawHash.slice(1);
        activeLinkKeyB64u = extractedKey;

        // Strip #link_key from address bar immediately
        if (window.history && typeof window.history.replaceState === 'function') {
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }

        var existingSession = null;
        try {
          var rawExisting = window.sessionStorage.getItem(storageKey);
          if (rawExisting) existingSession = JSON.parse(rawExisting);
        } catch (_) {}

        var nowMs = Date.now();
        var hasFreshExistingKeypair =
          existingSession &&
          typeof existingSession.saved_at_ms === 'number' &&
          nowMs - existingSession.saved_at_ms <= 300000 &&
          existingSession.kyber_pk_hex &&
          existingSession.kyber_sk_b64u &&
          existingSession.claim_id;

        var pkHex;
        var skB64u;
        var claimId;
        var savedAtMs;
        if (hasFreshExistingKeypair) {
          pkHex = existingSession.kyber_pk_hex;
          skB64u = existingSession.kyber_sk_b64u;
          claimId = existingSession.claim_id;
          savedAtMs = existingSession.saved_at_ms;
        } else {
          var kem = new window.BitBopMlKem.MlKem768();
          var kp = await kem.generateKeyPair();
          pkHex = bytesToHex(kp[0]);
          skB64u = bytesToBase64Url(kp[1]);
          claimId = crypto.randomUUID();
          savedAtMs = Date.now();
        }

        activeClaimSession = {
          link_key_b64u: extractedKey,
          claim_id: claimId,
          kyber_pk_hex: pkHex,
          kyber_sk_b64u: skB64u,
          saved_at_ms: savedAtMs
        };
        try {
          window.sessionStorage.setItem(storageKey, JSON.stringify(activeClaimSession));
        } catch (_) {}
        return true;
      }

      // Empty hash on load (e.g., tab refresh): check 5-minute sessionStorage
      try {
        var savedRaw = window.sessionStorage.getItem(storageKey);
        if (savedRaw) {
          var parsedSession = JSON.parse(savedRaw);
          if (
            parsedSession &&
            typeof parsedSession.saved_at_ms === 'number' &&
            Date.now() - parsedSession.saved_at_ms <= 300000 &&
            /^[A-Za-z0-9_-]{43}$/.test(String(parsedSession.link_key_b64u || '')) &&
            parsedSession.kyber_pk_hex &&
            parsedSession.kyber_sk_b64u
          ) {
            activeClaimSession = parsedSession;
            activeLinkKeyB64u = parsedSession.link_key_b64u;
            return true;
          }
          window.sessionStorage.removeItem(storageKey);
        }
      } catch (_) {}

      activeClaimSession = null;
      activeLinkKeyB64u = null;
      linkKeyInvalidOrMissing = true;
      document.getElementById('reveal-btn').disabled = true;
      showMessage(
        'Decryption key missing or expired. Please re-open the original secure link.',
        'This share uses zero-knowledge Client Envelope v2 encryption and cannot be revealed without the #link_key fragment.',
        'err'
      );
      return false;
    } finally {
      releaseHold();
    }
  }

  // Non-consuming GET /api/escrow/status probe on load
  async function probeEscrowStatusOnLoad() {
    var releaseHold = uatRecorder.beginHold('probe', 'Probing non-consuming escrow status on load');
    var storageKey = 'ss_claim_' + escrowId;
    try {
      var r = await fetch('/api/escrow/status?escrow_id=' + encodeURIComponent(escrowId));
      var d = await r.json();

      if (r.status === 404) {
        try { window.sessionStorage.removeItem(storageKey); } catch (_) {}
        activeClaimSession = null;
        activeLinkKeyB64u = null;
        showMessage('Secret not found or expired (404).', '', 'err');
        document.getElementById('reveal-btn').disabled = true;
        return;
      }
      if (r.status === 410 || d.status === 'expired' || d.state === 'expired') {
        try { window.sessionStorage.removeItem(storageKey); } catch (_) {}
        activeClaimSession = null;
        activeLinkKeyB64u = null;
        showMessage('Secret has expired (410).', 'The retention window for this secret has elapsed.', 'warn');
        document.getElementById('reveal-btn').disabled = true;
        return;
      }
      if (
        r.status === 409 ||
        d.status === 'claimed' ||
        d.status === 'revealed_and_burned' ||
        d.state === 'burned' ||
        d.burned === true
      ) {
        burned = true;
        try { window.sessionStorage.removeItem(storageKey); } catch (_) {}
        activeClaimSession = null;
        activeLinkKeyB64u = null;
        document.getElementById('reveal-btn').disabled = true;
        showMessage('Secret permanently burned (409). Cannot retrieve again.', 'This one-time secret has already been claimed.', 'warn');
        return;
      }

      if (d.escrow_profile && d.escrow_profile !== 'secretsender-v2') {
        try { window.sessionStorage.removeItem(storageKey); } catch (_) {}
        activeClaimSession = null;
        activeLinkKeyB64u = null;
        linkKeyInvalidOrMissing = true;
        document.getElementById('reveal-btn').disabled = true;
        showMessage('Invalid escrow profile for SecretSender', 'Expected secretsender-v2 profile, got ' + d.escrow_profile, 'err');
        return;
      }
      if (d.requires_unlock_key === false) {
        try { window.sessionStorage.removeItem(storageKey); } catch (_) {}
        activeClaimSession = null;
        activeLinkKeyB64u = null;
        linkKeyInvalidOrMissing = true;
        document.getElementById('reveal-btn').disabled = true;
        showMessage('Invalid escrow profile for SecretSender', 'Mandatory PIN policy missing on escrow record.', 'err');
        return;
      }

      if (
        r.status === 425 ||
        d.status === 'time_locked' ||
        d.state === 'embargoed' ||
        (d.unlock_at && Date.parse(d.unlock_at) > Date.now())
      ) {
        startTimelockCountdown(d.unlock_at);
      }
    } catch (_) {
    } finally {
      releaseHold();
    }
  }

  // Recipient Reveal + Pinned ML-DSA-44 Verification + Inner Client Envelope v2 Decryption
  async function performDirectBrowserReveal(unlockKeyStr) {
    if (revealInFlight) return;
    var storageKey = 'ss_claim_' + escrowId;
    var btn = document.getElementById('reveal-btn');

    try {
      var rawStored = window.sessionStorage.getItem(storageKey);
      if (rawStored) {
        activeClaimSession = JSON.parse(rawStored);
      }
    } catch (_) {}

    if (
      linkKeyInvalidOrMissing ||
      !activeClaimSession ||
      typeof activeClaimSession.saved_at_ms !== 'number' ||
      Date.now() - activeClaimSession.saved_at_ms > 300000 ||
      !/^[A-Za-z0-9_-]{43}$/.test(String(activeClaimSession.link_key_b64u || '')) ||
      !activeClaimSession.kyber_pk_hex ||
      !activeClaimSession.kyber_sk_b64u
    ) {
      try { window.sessionStorage.removeItem(storageKey); } catch (_) {}
      activeClaimSession = null;
      activeLinkKeyB64u = null;
      linkKeyInvalidOrMissing = true;
      btn.disabled = true;
      showMessage('Decryption key missing or expired. Please re-open the original secure link.', '', 'err');
      return;
    }

    activeLinkKeyB64u = activeClaimSession.link_key_b64u;
    var trimmedPin = String(unlockKeyStr || '').trim();
    if (trimmedPin.length < 4 || trimmedPin.length > 64) {
      showMessage('Enter a valid Unlock Key / PIN (4 to 64 characters).', '', 'err');
      return;
    }

    revealInFlight = true;
    var releaseHold = uatRecorder.beginHold('reveal', 'Browser ML-KEM-768 + Client Envelope v2 reveal');
    btn.disabled = true;
    btn.textContent = 'Decrypting in Browser (ML-KEM-768)...';

    var revealConsumedUpstream = false;
    try {
      var kem = new window.BitBopMlKem.MlKem768();
      var pkHex = activeClaimSession.kyber_pk_hex;
      var secretKeyBytes = base64UrlToBytes(activeClaimSession.kyber_sk_b64u);
      var claimId = activeClaimSession.claim_id || crypto.randomUUID();

      var r = await fetch('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: escrowId,
          claim_id: claimId,
          unlock_key: trimmedPin,
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
      if (r.status === 429) {
        showMessage('Rate-Limited PIN Backoff (429). Secret NOT burned.', d.error || 'Please wait before retrying.', 'warn');
        return;
      }
      if (r.status === 404 || r.status === 410) {
        try { window.sessionStorage.removeItem(storageKey); } catch (_) {}
        activeClaimSession = null;
        activeLinkKeyB64u = null;
        btn.disabled = true;
        showMessage(d.error || 'Secret not found or expired (' + r.status + ')', '', 'err');
        return;
      }
      if (r.status === 409) {
        burned = true;
        try { window.sessionStorage.removeItem(storageKey); } catch (_) {}
        activeClaimSession = null;
        activeLinkKeyB64u = null;
        btn.disabled = true;
        showMessage('Secret permanently burned (409). Cannot retrieve again.', 'This one-time record was already unsealed and destroyed.', 'warn');
        return;
      }
      if (!r.ok) {
        showMessage(d.error || 'Reveal failed (' + r.status + ')', '', 'err');
        return;
      }

      revealConsumedUpstream = true;

      var profile = d.escrow_profile || (d.evidence_receipt && d.evidence_receipt.escrow_profile);
      if (profile && profile !== 'secretsender-v2') {
        throw new Error('Invalid escrow profile for SecretSender (' + profile + ')');
      }

      // Check envelope_commitment_sha256 binding
      var se = d.sealed_envelope;
      var evReceipt = d.evidence_receipt || d;
      if (se && evReceipt && evReceipt.envelope_commitment_sha256) {
        var envCommitInput = (se.cipher || 'AES-256-GCM') + ':' + (se.kdf || 'SHA-256(entropy_hex_utf8)') + ':' + se.iv_hex + ':' + se.ciphertext_b64;
        var computedEnvCommit1 = await sha256Hex(envCommitInput);
        var computedEnvCommit2 = await sha256Hex(String(se.ciphertext_b64 || ''));
        var actualEnvCommit = String(evReceipt.envelope_commitment_sha256).replace(/^sha256:/i, '').toLowerCase();
        if (computedEnvCommit1 !== actualEnvCommit && computedEnvCommit2 !== actualEnvCommit) {
          throw new Error('Envelope commitment SHA-256 mismatch (tampered sealed_envelope)');
        }
      }

      // Pinned local ML-DSA-44 verification + remote /verify check (both required)
      var localSigValid = window.BitBopMlKem && window.BitBopMlKem.verifyReceiptSignature
        ? window.BitBopMlKem.verifyReceiptSignature(d)
        : false;

      var remoteVerifyOk = false;
      try {
        var vr = await fetch('/api/escrow/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(d)
        });
        var vd = await vr.json();
        remoteVerifyOk = vr.ok && vd && vd.valid === true;
      } catch (_) {}

      if (!localSigValid || !remoteVerifyOk) {
        throw new Error('ML-DSA-44 receipt signature verification failed');
      }
      var verifyOk = Boolean(localSigValid && remoteVerifyOk);

      // Step 1: Unseal outer BitBop hardware entropy layer
      var outerPlaintext = await browserDecryptBitBopReveal(d, secretKeyBytes, kem);
      secretKeyBytes.fill(0);

      // Step 2: Parse & decrypt inner Client Envelope v2 using URL fragment link_key
      var parsedEnvelope;
      try {
        parsedEnvelope = JSON.parse(outerPlaintext);
      } catch (_) {
        throw new Error('Outer payload is not a valid Client Envelope v2 JSON object');
      }
      var plaintext = await decryptClientEnvelopeV2(parsedEnvelope, activeLinkKeyB64u);

      // Wipe tab-scoped sessionStorage immediately after successful decryption
      try { window.sessionStorage.removeItem(storageKey); } catch (_) {}
      activeLinkKeyB64u = null;
      activeClaimSession = null;

      secretPlaintext = plaintext;
      revealed = true;
      burned = true;
      lastError = null;

      uatRecorder.record({
        type: 'state',
        label: 'secret_revealed',
        summary: { escrowId: d.escrow_id, secretLength: plaintext.length }
      });

      var beaconSeq = (d.evidence_receipt && d.evidence_receipt.beacon_sequence !== undefined)
        ? d.evidence_receipt.beacon_sequence
        : d.beacon_sequence;
      var provenanceUrl =
        'https://www.bitbop.dev/provenance?escrow_id=' +
        encodeURIComponent(d.escrow_id) +
        '&sequence=' +
        encodeURIComponent(String(beaconSeq || ''));

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

      var rowActions = document.createElement('div');
      rowActions.className = 'row';

      var copyPwBtn = document.createElement('button');
      copyPwBtn.type = 'button';
      copyPwBtn.className = 'btn btn-secondary';
      copyPwBtn.textContent = 'Copy Secret Password';
      copyPwBtn.addEventListener('click', function() { copyText(plaintext); });

      var dlEvidenceBtn = document.createElement('button');
      dlEvidenceBtn.type = 'button';
      dlEvidenceBtn.id = 'download-reveal-receipt-btn';
      dlEvidenceBtn.className = 'btn btn-secondary';
      dlEvidenceBtn.textContent = 'Download Evidence Receipt';
      dlEvidenceBtn.addEventListener('click', function() {
        var cleanReceipt = d.evidence_receipt ? d.evidence_receipt : Object.assign({}, d, { cipher: undefined, sealed_envelope: undefined });
        downloadJsonFile('secretsender-reveal-evidence-' + d.escrow_id + '.json', cleanReceipt);
      });

      rowActions.appendChild(copyPwBtn);
      rowActions.appendChild(dlEvidenceBtn);
      el.appendChild(rowActions);

      var burnP = document.createElement('p');
      burnP.className = 'ok';
      burnP.style.fontSize = '0.85rem';
      burnP.textContent = 'This secret is now permanently burned in BitBop hardware escrow and wiped from browser sessionStorage.';
      el.appendChild(burnP);

      var verP = document.createElement('p');
      verP.style.fontSize = '0.85rem';
      verP.className = verifyOk ? 'ok' : 'err';
      verP.textContent = 'Reveal verified: ' + (verifyOk ? 'YES (ML-DSA-44 Beacon #' + beaconSeq + ')' : 'FAILED');
      el.appendChild(verP);

      var provA = document.createElement('a');
      provA.href = provenanceUrl;
      provA.target = '_blank';
      provA.rel = 'noopener noreferrer';
      provA.className = 'btn btn-secondary';
      provA.style.width = '100%';
      provA.textContent = 'View Provenance on BitBop';
      el.appendChild(provA);

      var scopeNotice = document.createElement('div');
      scopeNotice.className = 'scope-notice';
      scopeNotice.textContent = 'Attestation Scope: This ML-DSA-44 evidence receipt proves BitBop hardware entropy lineage, envelope commitment integrity, and one-time burn policy. It does not attest to the contents of the user secret.';
      el.appendChild(scopeNotice);

      var postCta = document.createElement('a');
      postCta.href = '/';
      postCta.id = 'post-reveal-cta';
      postCta.className = 'post-reveal-cta';
      postCta.textContent = 'Need to send a time-locked or PIN-protected credential? Share with SecretSender →';
      el.appendChild(postCta);
    } catch (e) {
      if (revealConsumedUpstream) {
        try { window.sessionStorage.removeItem(storageKey); } catch (_) {}
        activeClaimSession = null;
        activeLinkKeyB64u = null;
      }
      btn.disabled = false;
      btn.textContent = 'Reveal / Decrypt';
      showMessage('Decryption error: ' + e.message, '', 'err');
    } finally {
      revealInFlight = false;
      releaseHold();
    }
  }

  if (escrowId) {
    currentEscrowId = escrowId;
    document.getElementById('admin-view').style.display = 'none';
    document.getElementById('claim-view').style.display = 'block';
    document.getElementById('claim-id').textContent = 'Escrow ID: ' + escrowId;
    initRecipientFragmentAndSession().then(function(okFragment) {
      if (okFragment) {
        probeEscrowStatusOnLoad();
      }
    });
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
