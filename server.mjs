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
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SecretSender — Quantum-Sealed One-Time Secrets</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 16px;
    background: #0B0C0E;
    color: #F1F5F9;
    max-width: 500px;
    margin-left: auto;
    margin-right: auto;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .shell {
    background: #14161B;
    border: 1px solid #262932;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.45);
  }
  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #10B981;
    background: #062419;
    border: 1px solid rgba(16,185,129,0.35);
    padding: 4px 8px;
    border-radius: 4px;
    margin-bottom: 10px;
  }
  h1 {
    font-size: 1.45rem;
    font-weight: 800;
    margin: 0 0 6px;
    letter-spacing: -0.02em;
    color: #F8FAFC;
  }
  .sub {
    color: #94A3B8;
    font-size: 0.88rem;
    margin: 0 0 16px;
    line-height: 1.45;
  }
  label {
    display: block;
    margin: 14px 0 6px;
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #94A3B8;
  }
  input[type="text"], input[type="datetime-local"] {
    width: 100%;
    padding: 12px;
    font-size: 15px;
    border: 1px solid #262932;
    border-radius: 8px;
    background: #0B0C0E;
    color: #F8FAFC;
    outline: none;
  }
  input[type="text"]:focus, input[type="datetime-local"]:focus {
    border-color: #10B981;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .preset-btn {
    width: auto;
    margin-top: 0;
    padding: 6px 10px;
    font-size: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    background: #1E222B;
    color: #CBD5E1;
    border: 1px solid #2E3440;
    border-radius: 6px;
    cursor: pointer;
  }
  .preset-btn.active {
    background: #062419;
    color: #10B981;
    border-color: #10B981;
    font-weight: 700;
  }
  button.primary, .btn {
    display: inline-block;
    margin-top: 16px;
    padding: 13px 16px;
    font-size: 15px;
    font-weight: 700;
    border: none;
    border-radius: 8px;
    background: #10B981;
    color: #052E16;
    cursor: pointer;
    width: 100%;
    text-align: center;
    text-decoration: none;
    transition: filter 0.15s;
  }
  button.primary:hover, .btn:hover { filter: brightness(1.08); }
  button.primary:disabled {
    background: #334155;
    color: #94A3B8;
    cursor: not-allowed;
  }
  .btn-secondary {
    background: #1E293B;
    color: #E2E8F0;
    border: 1px solid #334155;
  }
  .card {
    background: #0B0C0E;
    border-radius: 10px;
    padding: 16px;
    margin: 16px 0 0;
    border: 1px solid #262932;
  }
  .timelock-card {
    background: #0F172A;
    border: 1px solid #38BDF8;
    border-radius: 10px;
    padding: 16px;
    margin: 12px 0;
    text-align: center;
  }
  .timelock-title {
    font-size: 0.78rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #38BDF8;
    margin-bottom: 6px;
  }
  .timelock-date {
    font-size: 1.02rem;
    font-weight: 700;
    color: #F8FAFC;
    margin-bottom: 8px;
  }
  .countdown-clock {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 2.1rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: #4ADE80;
    background: #062419;
    border: 1px solid rgba(16,185,129,0.4);
    border-radius: 8px;
    padding: 10px 14px;
    display: inline-block;
    margin: 6px 0;
  }
  .countdown-sub {
    font-size: 0.78rem;
    color: #94A3B8;
    margin-top: 6px;
  }
  .ok { color: #4ADE80; }
  .err { color: #F87171; }
  .warn { color: #FBBF24; }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    word-break: break-all;
    font-size: 0.82rem;
    background: #14161B;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid #262932;
    margin: 4px 0 10px;
  }
  .row {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  .row button, .row .btn {
    flex: 1;
    margin-top: 0;
  }
  #pw-display {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 1.25rem;
    font-weight: 800;
    color: #4ADE80;
    padding: 14px;
    background: #062419;
    border: 1px solid #10B981;
    border-radius: 8px;
    margin: 12px 0;
    word-break: break-all;
  }
  .brand-footer {
    margin-top: 20px;
    padding-top: 14px;
    border-top: 1px solid #1E222B;
    text-align: center;
    font-size: 0.8rem;
    color: #64748B;
  }
  .brand-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #94A3B8;
    text-decoration: none;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.78rem;
    padding: 6px 12px;
    border-radius: 999px;
    background: #14161B;
    border: 1px solid #262932;
    transition: border-color 0.15s, color 0.15s;
  }
  .brand-link:hover {
    border-color: #10B981;
    color: #F8FAFC;
  }
  .brand-logotext {
    font-weight: 900;
    letter-spacing: -0.03em;
    color: #10B981;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 0.88rem;
  }
</style>
<script src="/mlkem.browser.js"></script>
</head>
<body>
<div class="shell">
  <div class="eyebrow">● NIST FIPS 203 ML-KEM-768 · Burn-on-Read</div>

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
    <a href="https://www.bitbop.dev" target="_blank" rel="noopener noreferrer" class="brand-link">
      <span>powered by</span>
      <span class="brand-logotext">BitBop</span>
    </a>
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
    var el = document.getElementById('result');
    el.style.display = 'block';
    el.style.borderColor = tone === 'err' ? '#EF4444' : tone === 'warn' ? '#FBBF24' : '#10B981';
    el.textContent = '';

    var h = document.createElement('div');
    h.className = tone === 'err' ? 'err' : tone === 'warn' ? 'warn' : 'ok';
    h.style.fontWeight = '700';
    h.style.marginBottom = detail ? '6px' : '0';
    h.textContent = title;
    el.appendChild(h);

    if (detail) {
      var p = document.createElement('div');
      p.style.color = '#CBD5E1';
      p.style.fontSize = '0.88rem';
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
        smsA.className = 'btn';
        smsA.href = d.sms_link;
        smsA.textContent = 'Send via SMS';

        var copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'primary btn-secondary';
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
      if (remSec <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
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
        revealInFlight = false;
        if (d.unlock_at) startTimelockCountdown(d.unlock_at);
        showMessage('Time-Locked (425 Too Early)', 'Secret becomes available on ' + new Date(d.unlock_at).toLocaleString(), 'warn');
        return;
      }

      btn.disabled = false;
      btn.textContent = 'Reveal / Decrypt';
      revealInFlight = false;

      if (r.status === 403) {
        showMessage('Wrong unlock key (403). Secret NOT burned.', 'Remaining attempts before backoff: ' + (d.remaining_attempts !== undefined ? d.remaining_attempts : 'retry'), 'err');
        return;
      }
      if (r.status === 409) {
        showMessage('Secret permanently burned (409). Cannot retrieve again.', 'This one-time record was already unsealed and destroyed.', 'warn');
        return;
      }
      if (!r.ok) {
        showMessage(d.error || 'Reveal failed (' + r.status + ')', '', 'err');
        return;
      }

      // Decrypt ML-KEM-768 + AES-256-GCM directly in browser WebCrypto
      var plaintext = await browserDecryptBitBopReveal(d, secretKeyBytes, kem);

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
      copyPwBtn.className = 'primary btn-secondary';
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
      revealInFlight = false;
      showMessage('Decryption error: ' + e.message, '', 'err');
    }
  }

  // Probe BitBop directly on Claim Page load (without side-channel URL params or burning the secret)
  async function probeEscrowStatusOnLoad() {
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
        showMessage('Secret permanently burned (409). Cannot retrieve again.', 'This one-time secret has already been claimed.', 'warn');
      }
    } catch (_) {}
  }

  if (escrowId) {
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
    const u = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && u.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildHtml());
      return;
    }
    if (req.method === 'GET' && u.pathname === '/mlkem.browser.js') {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      });
      res.end(MLKEM_BROWSER_BUNDLE);
      return;
    }
    if (req.method === 'GET' && u.pathname === '/health') {
      return json(res, 200, { status: 'ok', service: 'SecretSender' });
    }
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
    res.writeHead(404);
    res.end('Not found');
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SecretSender listening on http://${HOST}:${PORT}`);
});
