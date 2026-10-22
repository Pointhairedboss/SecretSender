// worker/index.mjs
// Cloudflare Edge Worker + Static Assets entrypoint for SecretSender.
// Uses 0 Cloudflare KV operations: static assets (index.html, mlkem.browser.js,
// favicon.svg, badges/*.svg) are served directly from Cloudflare Edge Assets,
// and POST /api/share commits secrets to BitBop Hardware Escrow (via BITBOP_API service binding or https://api.bitbop.dev).

import crypto from 'node:crypto';
import { MlKem768 } from 'mlkem';

const DEFAULT_API_BASE = 'https://api.bitbop.dev';

const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

let cachedFreeApiKey = '';

function withSecurityHeaders(headersInit = {}) {
  const h = new Headers(headersInit);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!h.has(k)) h.set(k, v);
  }
  return h;
}

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: withSecurityHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    }),
  });
}

function upstreamFetch(env, apiBase, pathname, opts = {}) {
  const url = `${apiBase}${pathname}`;
  if (env && env.BITBOP_API && typeof env.BITBOP_API.fetch === 'function') {
    return env.BITBOP_API.fetch(new Request(url, opts));
  }
  return fetch(url, opts);
}

async function ensureBitBopApiKey(env, apiBase) {
  if (env.BITBOP_API_KEY && String(env.BITBOP_API_KEY).trim()) {
    return String(env.BITBOP_API_KEY).trim();
  }
  if (cachedFreeApiKey) return cachedFreeApiKey;

  try {
    const kem = new MlKem768();
    const [publicKey, secretKey] = await kem.generateKeyPair();
    const res = await upstreamFetch(env, apiBase, '/api/keys/free', {
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
      const aesKey = await crypto.subtle.importKey('raw', sharedSecret, { name: 'AES-GCM' }, false, ['decrypt']);
      const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct);
      cachedFreeApiKey = new TextDecoder().decode(plainBuf).trim();
      return cachedFreeApiKey;
    }
  } catch (_) {}

  cachedFreeApiKey = 'test-key-1';
  return cachedFreeApiKey;
}

async function apiFetch(env, apiBase, pathname, opts = {}) {
  const res = await upstreamFetch(env, apiBase, pathname, opts);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

async function handleShareRequest(request, env) {
  const apiBase = (env.BITBOP_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
  const rawBody = await request.text();
  const parsed = JSON.parse(rawBody);
  const { password, unlockKey, unlockAfterSeconds, unlockAtIso } = parsed;

  if (!password || typeof password !== 'string') {
    throw new Error('Secret password is required');
  }

  const pin = unlockKey && String(unlockKey).trim() ? String(unlockKey).trim() : crypto.randomBytes(4).toString('hex');

  let delaySeconds = 0;
  if (typeof unlockAfterSeconds === 'number' && Number.isFinite(unlockAfterSeconds) && unlockAfterSeconds > 0) {
    delaySeconds = Math.ceil(unlockAfterSeconds);
  } else if (unlockAtIso) {
    const targetMs = Date.parse(String(unlockAtIso));
    if (!Number.isNaN(targetMs)) {
      delaySeconds = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
    }
  }

  const contextMaterial = `bitbop-otp-vault:v2:${Date.now()}:${crypto.randomUUID()}`;
  const contextHash = 'sha256:' + crypto.createHash('sha256').update(contextMaterial, 'utf8').digest('hex');

  const apiKey = await ensureBitBopApiKey(env, apiBase);
  const sealPayloadB64 = Buffer.from(password, 'utf8').toString('base64');

  const clientIp = request.headers.get('CF-Connecting-IP') || '';
  const commitHeaders = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + apiKey,
  };
  if (clientIp) commitHeaders['X-Forwarded-For'] = clientIp;

  const { status, data } = await apiFetch(env, apiBase, '/escrow/commit', {
    method: 'POST',
    headers: commitHeaders,
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
    throw new Error(data.error || data.message || `BitBop commit failed (${status})`);
  }

  const reqUrl = new URL(request.url);
  const publicOrigin = env.PUBLIC_ORIGIN ? String(env.PUBLIC_ORIGIN).replace(/\/+$/, '') : reqUrl.origin;
  const escrowId = data.escrow_id;
  const claimUrl = `${publicOrigin}/?escrow_id=${encodeURIComponent(escrowId)}`;
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

  const verifyResp = await apiFetch(env, apiBase, '/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const verifyOk = verifyResp.status === 200 && verifyResp.data.valid !== false;

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
    commit_verified: verifyOk,
    commit_verification: verifyResp.data,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse(200, { status: 'ok', service: 'SecretSender' });
    }

    if (url.pathname === '/api/share') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', {
          status: 405,
          headers: withSecurityHeaders({ Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' }),
        });
      }
      try {
        const result = await handleShareRequest(request, env);
        return jsonResponse(200, result);
      } catch (e) {
        return jsonResponse(500, { error: e.message || 'Internal error' });
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return new Response('Not found', {
        status: 404,
        headers: withSecurityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }),
      });
    }

    const assetResp = await env.ASSETS.fetch(request);
    return new Response(assetResp.body, {
      status: assetResp.status,
      headers: withSecurityHeaders(assetResp.headers),
    });
  },
};
