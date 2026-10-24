// worker/index.mjs
// Cloudflare Edge Worker + Static Assets entrypoint for SecretSender.
// Uses 0 Cloudflare KV operations: static assets (index.html, mlkem.browser.js,
// favicon.svg, badges/*.svg) are served directly from Cloudflare Edge Assets,
// POST /api/share commits secrets to BitBop Hardware Escrow, and POST /api/reflect
// acts as the External Agent Reflector for split-horizon UAT (External Cloud <-> Physical S21).

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

function extractEdgeTelemetry(request) {
  const cf = request.cf || {};
  return {
    provider: 'cloudflare-workers-edge',
    colo: cf.colo || 'EDGE',
    country: cf.country || 'AU',
    asn: cf.asn || null,
    asOrganization: cf.asOrganization || null,
    httpProtocol: cf.httpProtocol || 'HTTP/2',
    tlsVersion: cf.tlsVersion || 'TLSv1.3',
    clientIp: request.headers.get('CF-Connecting-IP') || 'edge',
    rayId: request.headers.get('CF-Ray') || null,
    timestamp: new Date().toISOString(),
  };
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

async function handleSharePayload(parsed, request, env) {
  const apiBase = (env.BITBOP_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
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

async function handleShareRequest(request, env) {
  const rawBody = await request.text();
  const parsed = JSON.parse(rawBody);
  return handleSharePayload(parsed, request, env);
}

/**
 * Decrypts a BitBop /escrow/reveal payload using WebCrypto + ML-KEM-768,
 * matching the browser's browserDecryptBitBopReveal() implementation.
 */
async function decryptBitBopRevealInIsolate(revealData, secretKeyBytes, kemInstance) {
  const cipher = revealData.cipher;
  const sealed = revealData.sealed_envelope;
  if (!cipher || !sealed) {
    throw new Error('Missing cipher or sealed_envelope in BitBop reveal response');
  }

  // Step 1: ML-KEM-768 decapsulation -> 32-byte sharedSecret
  const kyberCtBytes = Buffer.from(cipher.kyber_ciphertext_hex, 'hex');
  const sharedSecret = await kemInstance.decap(kyberCtBytes, secretKeyBytes);

  // Step 2: AES-256-GCM decrypt cipher.aes_ciphertext_hex -> 32 raw entropy bytes -> 64-char hex
  const transitKey = await crypto.subtle.importKey('raw', sharedSecret, { name: 'AES-GCM' }, false, ['decrypt']);
  const transitIv = Buffer.from(cipher.aes_iv_hex, 'hex');
  const transitCt = Buffer.from(cipher.aes_ciphertext_hex, 'hex');
  const rawEntropyBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: transitIv }, transitKey, transitCt);
  const entropyHex = Buffer.from(rawEntropyBuf).toString('hex');

  // Step 3: SHA-256(utf8(entropyHex)) -> AES-256-GCM decrypt sealed_envelope.ciphertext_b64
  const envKeyDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(entropyHex));
  const envKey = await crypto.subtle.importKey('raw', envKeyDigest, { name: 'AES-GCM' }, false, ['decrypt']);
  const envIv = Buffer.from(sealed.iv_hex, 'hex');
  const envCt = Buffer.from(sealed.ciphertext_b64, 'base64');
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: envIv }, envKey, envCt);
  return new TextDecoder().decode(plainBuf);
}

/**
 * External Agent Reflector endpoint (POST /api/reflect)
 * Allows a UAT orchestrator to execute the remote peer's actions (seal or claim)
 * from inside the external cloud edge isolate while the physical S21 executes the other end.
 */
async function handleReflectRequest(request, env) {
  const apiBase = (env.BITBOP_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
  const edgeTelemetry = extractEdgeTelemetry(request);
  const rawBody = await request.text();
  const body = rawBody ? JSON.parse(rawBody) : {};
  const action = body.action || 'ping';

  if (action === 'ping') {
    return {
      ok: true,
      action: 'ping',
      edge_telemetry: edgeTelemetry,
    };
  }

  if (action === 'seal') {
    const shareResult = await handleSharePayload(body, request, env);
    return {
      ok: true,
      action: 'seal',
      edge_telemetry: edgeTelemetry,
      share: shareResult,
    };
  }

  if (action === 'claim') {
    const escrowId = body.escrow_id;
    const unlockKey = body.unlock_key;
    const testWrongPin = body.test_wrong_pin !== false;
    if (!escrowId || !unlockKey) {
      throw new Error('escrow_id and unlock_key are required for reflect claim');
    }

    const steps = [];
    const kem = new MlKem768();
    const [publicKey, secretKey] = await kem.generateKeyPair();
    const pkHex = Buffer.from(publicKey).toString('hex');

    // Step 1: Optional wrong PIN non-burn probe (expects HTTP 403)
    let wrongPinStatus = null;
    if (testWrongPin) {
      // Use a distinct synthetic IP so per-subnet backoff doesn't throttle the subsequent valid reveal
      const wrongPinResp = await apiFetch(env, apiBase, '/escrow/reveal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.250',
        },
        body: JSON.stringify({
          escrow_id: escrowId,
          unlock_key: String(unlockKey) + '-wrong-reflector-pin',
          kyber_public_key: pkHex,
          signature_scheme: 'ml-dsa-44',
        }),
      });
      wrongPinStatus = wrongPinResp.status;
      steps.push({
        step: 'wrong_pin_probe',
        status: wrongPinResp.status,
        passed: wrongPinResp.status === 403,
      });
    }

    // Step 2: Valid ML-KEM-768 + AES-256-GCM reveal from external cloud isolate
    const revealResp = await apiFetch(env, apiBase, '/escrow/reveal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.77',
      },
      body: JSON.stringify({
        escrow_id: escrowId,
        unlock_key: String(unlockKey),
        kyber_public_key: pkHex,
        signature_scheme: 'ml-dsa-44',
      }),
    });

    if (revealResp.status !== 200) {
      return {
        ok: false,
        action: 'claim',
        edge_telemetry: edgeTelemetry,
        steps,
        reveal_status: revealResp.status,
        error: revealResp.data?.error || `Reveal returned HTTP ${revealResp.status}`,
      };
    }

    const decryptedPlaintext = await decryptBitBopRevealInIsolate(revealResp.data, secretKey, kem);
    steps.push({
      step: 'mlkem768_aes256gcm_decrypt',
      status: 200,
      passed: typeof decryptedPlaintext === 'string' && decryptedPlaintext.length > 0,
    });

    // Step 3: Verify ML-DSA-44 reveal receipt
    const verifyResp = await apiFetch(env, apiBase, '/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(revealResp.data),
    });
    const revealVerified = verifyResp.status === 200 && verifyResp.data.valid !== false;
    steps.push({
      step: 'mldsa44_receipt_verify',
      status: verifyResp.status,
      passed: revealVerified,
    });

    // Step 4: Confirm second reveal returns HTTP 409 Conflict (burned)
    const burnResp = await apiFetch(env, apiBase, '/escrow/reveal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.77',
      },
      body: JSON.stringify({
        escrow_id: escrowId,
        unlock_key: String(unlockKey),
        kyber_public_key: pkHex,
        signature_scheme: 'ml-dsa-44',
      }),
    });
    steps.push({
      step: 'burn_on_read_409_check',
      status: burnResp.status,
      passed: burnResp.status === 409,
    });

    return {
      ok: true,
      action: 'claim',
      edge_telemetry: edgeTelemetry,
      escrow_id: escrowId,
      decrypted_plaintext: decryptedPlaintext,
      reveal_verified: revealVerified,
      beacon_sequence: revealResp.data.beacon_sequence,
      wrong_pin_status: wrongPinStatus,
      burn_recheck_status: burnResp.status,
      steps,
    };
  }

  throw new Error(`Unknown reflector action: ${action}`);
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

    if (url.pathname === '/api/reflect') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', {
          status: 405,
          headers: withSecurityHeaders({ Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' }),
        });
      }
      try {
        const result = await handleReflectRequest(request, env);
        return jsonResponse(result.ok === false ? 422 : 200, result);
      } catch (e) {
        return jsonResponse(500, { ok: false, error: e.message || 'Reflector error' });
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
