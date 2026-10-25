// worker/index.mjs
// Cloudflare Edge Worker + Static Assets entrypoint for SecretSender (Client Envelope v2).
// Zero-knowledge browser-wrapped secret sharing over BitBop Hardware Quantum Escrow.

import crypto from 'node:crypto';
import { MlKem768 } from 'mlkem';
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';

const DEFAULT_API_BASE = 'https://api.bitbop.dev';

export const SERVICE_PUBLIC_KEY_MLDSA44_B64 =
  'b/PZgJYkdUHwJR0atxQ3Y5T7+rDwduRkNvjWG+rforWt7ZXCneaBl8PMboHL4RXhuRseHUPyK2ojx1ICxsv9e/qTAmDmrgh3r14dEiNURvOwOmnMJ15xfrF1757kCB1yTSFzqFMnWVoIQaiiZ+LgtObgiih2RffwsWgLGGI1RRakvmwPv3WzBjl6pP59JWOlI4HxSxPLhCtrEbhYgjrafPPNHr+BlpjlHa6V0/FXO8O+vsMcQ4bfg8WD4JqLYg6dn8XZnXWCOZwk0MQqd7lZvMJVx6yUdJHbNbekNr2MOahGi5Zi1ooI1HWXX5BBA9LNSC8MLGuPpHlXkJFkm/TLwOtDgUGNBBaPEH6n1xUQ/jhjSqQM39Rh8EuLdRq8Z1SxpRuizgpkvG3DACGZDU3N19Id0O2wS6S506jaHZmGT7IINx2eNm2SGmCp+25XqZ9CX4yk9oHUO/N11J99qYMSlPfjsGZGOmlDXYfwxG2n9FQtQ7FOdtd1pXNUnQkU2NrgRZZYBjRdkwBIWzmY+Tv+oavixSrncN5e6QZOfK+Bth2eAHoKeS8kzQY3ewmW+j4Nsv6Yc97qCCabSqQicGBE9DJl9Chcg0iIoAp4j2KRMqCiTPLUnufcsW28lG3evjDp8ytAKDyOCK5hEg0vPOAEvdCRclPJqmygMLZZYyHJvuNiE5NO16rkbQSICD1Y3ttYro489o2eHTUvX1ecIIxy5Cc0oAnFKl1X/BGZpzp6rifA0zigdV/ZJdpY/xg/N3EykSnrGf6NuLGP/4fvTLregoiKPmcgiS/whBmn3YjxcLsJPUs9xwups31paQdwpl+mOtP4czSuvce9nu4vOqhjZxu9ik9ILTX9Ef2qqW/PDkMjT3jFqRvmm+XHhzYOneaWzeDqSmCsoG17qFyCxAjddjHWc+juy9R/5R7YQ8z0i6Z5BbTiP3BgYZzaEDTD3K6rN9xBMAwSotciQ6a/dvFbUIPcqX6jub8prUoe17wVdAfJ/h8xkdOhwwKvqcyMJ8cOMH4NUOBjZXeb5hHAx0i5We1T/qyrPzipz4qr//mTWaHjcUPTUfHqecm/PNUchIAG6LmOVgYU8HvkH/RvbPZVIEOXWtwHyAV1kAt2XJ6ne6acfXaVrmaeLr+wTxwkKml6Lj5ouTli9ExryZ9PwECw6cH/QOQEHudJtm+SuKUasLk4acLn3pTyX7vqpjyM0vO4hgnTtv8fxpNZ05G13L/iPYw1Dh/GxOhyOWBQRcMGkSYSEEYtD9rfq9myiXaCucNY9CCwIpPO++FE2auu5IkFZUPmzhebfVf5R8F+EY9AvwApb3+i3HItIcMRJ84wcOsNI8Ge1bKSoNl7VWWQmo8gO5jwd04OFIQvbH2zO1RaGJpLAIOLVAYCfdGTGg/ZrFXpX3k6xk//T+vBJlW4DBvXFpMOpXlOt+ain9fYeyYqnxtC1IzLmkj0E1T3g+xNVo++cOSrsidZagfa5DD1QmrZ+c0I90sFc9z0OCznaI/43ijg9hAdj3TzOpS6SnpsgLU2+BMadsuKO1szaPjDd6edHgdcIuheWBHZ++wfBJGfojoGL+Qbsm3KBTPKxW5VqB/MDKctiS4fQRpjPkUjMorVVVuxAfGHk4F2bV723ou2ek3HDFjQrisjzYjYuoO81sUaWQfpBqC6JkDqYcLg1RATvuA2NoYdukbw88mJQbD9Lq7i732xtyBRk2bgXtz3APnSEYWacZneqxT7/Qr8d9dWyQ==';

export const TRUSTED_RELEASE_KEYS = {
  'mldsa44-release-2026-01': SERVICE_PUBLIC_KEY_MLDSA44_B64,
};

const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.bitbop.dev https://www.bitbop.dev; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function withSecurityHeaders(headersInit = {}, extraHeaders = {}) {
  const h = new Headers(headersInit);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!h.has(k)) h.set(k, v);
  }
  for (const [k, v] of Object.entries(extraHeaders)) {
    h.set(k, v);
  }
  return h;
}

function jsonResponse(status, data, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: withSecurityHeaders(
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
      extraHeaders,
    ),
  });
}

function toBase64Url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(b64u) {
  if (typeof b64u !== 'string' || !/^[A-Za-z0-9_-]+$/.test(b64u)) {
    throw new HttpError(400, 'Invalid Base64URL encoding');
  }
  const padLen = (4 - (b64u.length % 4)) % 4;
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  return Buffer.from(b64, 'base64');
}

export function verifyReceiptSignatureInWorker(receipt, env = {}) {
  if (!receipt || typeof receipt !== 'object') {
    return { valid: false, error: 'Missing receipt object' };
  }
  const ev = receipt.evidence_receipt || (receipt.receipt_version === 2 ? receipt : null);
  const keyId =
    (ev && ev.key_id) ||
    receipt.release_key_id ||
    receipt.key_id ||
    'mldsa44-release-2026-01';
  const trustedMap = { ...TRUSTED_RELEASE_KEYS };
  if (env && env.SERVICE_PUBLIC_KEY_MLDSA44_B64) {
    trustedMap['mldsa44-release-2026-01'] = String(env.SERVICE_PUBLIC_KEY_MLDSA44_B64).trim();
  }
  const pkB64 = trustedMap[keyId];
  if (!pkB64) {
    return { valid: false, error: `Untrusted release_key_id: ${keyId}` };
  }

  const pkBytes = new Uint8Array(Buffer.from(pkB64, 'base64'));
  const verifyHexSig = (payloadStr, sigHexStr) => {
    const cleanHex = String(sigHexStr || '').replace(/^mldsa44:/i, '').trim();
    if (!cleanHex || cleanHex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(cleanHex)) return false;
    const sigBytes = new Uint8Array(Buffer.from(cleanHex, 'hex'));
    const msgBytes = new Uint8Array(Buffer.from(payloadStr, 'utf8'));
    return Boolean(ml_dsa44.verify(sigBytes, msgBytes, pkBytes));
  };

  try {
    // 1. Verify v2 evidence_receipt signature (and optional v2 delivery_signature / outer signature)
    if (ev && typeof ev.signature === 'string') {
      if (ev.signature_scheme && ev.signature_scheme !== 'ml-dsa-44') {
        return { valid: false, error: 'Unsupported evidence_receipt signature_scheme' };
      }
      const evCopy = { ...ev };
      delete evCopy.signature;
      const evCanonicalJson = JSON.stringify(evCopy);
      if (!verifyHexSig(evCanonicalJson, ev.signature)) {
        return { valid: false, error: 'Invalid ML-DSA-44 evidence_receipt signature' };
      }
      if (receipt.delivery_version === 2 && typeof receipt.delivery_signature === 'string') {
        if (receipt.delivery_signature_scheme && receipt.delivery_signature_scheme !== 'ml-dsa-44') {
          return { valid: false, error: 'Unsupported delivery_signature_scheme' };
        }
        const delPayload = JSON.stringify({
          delivery_version: receipt.delivery_version,
          escrow_id: receipt.escrow_id,
          escrow_profile: receipt.escrow_profile,
          claim_id: receipt.claim_id,
          cipher: receipt.cipher,
          sealed_envelope: receipt.sealed_envelope || null,
          evidence_receipt_signature: ev.signature,
        });
        if (!verifyHexSig(delPayload, receipt.delivery_signature)) {
          return { valid: false, error: 'Invalid ML-DSA-44 delivery_signature' };
        }
      }
      if (receipt !== ev && typeof receipt.signature === 'string') {
        const outerCopy = { ...receipt };
        delete outerCopy.signature;
        delete outerCopy.disclosed_entropy_hex;
        if (!verifyHexSig(JSON.stringify(outerCopy), receipt.signature)) {
          return { valid: false, error: 'Invalid outer ML-DSA-44 receipt signature' };
        }
      }
      return { valid: true, key_id: keyId, canonical_json: evCanonicalJson };
    }

    // 2. Verify standard BitBop hex / mldsa44:<hex> signature
    if (typeof receipt.signature === 'string') {
      const scheme = receipt.signature_scheme || 'ml-dsa-44';
      if (scheme !== 'ml-dsa-44') {
        return { valid: false, error: 'Unsupported signature_scheme' };
      }
      const copy = { ...receipt };
      delete copy.signature;
      delete copy.disclosed_entropy_hex;
      const canonicalJson = JSON.stringify(copy);
      const valid = verifyHexSig(canonicalJson, receipt.signature);
      return { valid, key_id: keyId, canonical_json: canonicalJson };
    }

    // 3. Verify base64 signature_b64
    const sigB64 = receipt.signature_b64;
    if (!sigB64 || typeof sigB64 !== 'string') {
      return { valid: false, error: 'Missing signature or signature_b64 in receipt' };
    }
    const excluded = new Set([
      'signature_b64',
      'sig_alg',
      'signature_scheme',
      'sealed_envelope',
      'cipher',
      'VerifyURL',
      'verify_url',
    ]);
    const canonicalObj = {};
    for (const k of Object.keys(receipt).sort()) {
      if (!excluded.has(k) && receipt[k] !== undefined) {
        canonicalObj[k] = receipt[k];
      }
    }
    const canonicalJson = JSON.stringify(canonicalObj);
    const sigBytes = new Uint8Array(Buffer.from(sigB64, 'base64'));
    const msgBytes = new Uint8Array(Buffer.from(canonicalJson, 'utf8'));
    const valid = ml_dsa44.verify(sigBytes, msgBytes, pkBytes);
    return { valid: Boolean(valid), key_id: keyId, canonical_json: canonicalJson };
  } catch (err) {
    return { valid: false, error: err.message || 'ML-DSA-44 verification error' };
  }
}

export function validateAndCanonicalizeEnvelopeV2(envObj) {
  if (!envObj || typeof envObj !== 'object' || Array.isArray(envObj)) {
    throw new HttpError(400, 'client_envelope must be a JSON object');
  }
  if (envObj.v !== 2) {
    throw new HttpError(400, 'Unsupported client_envelope version (expected v: 2)');
  }
  const shareId = String(envObj.share_id || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(shareId)) {
    throw new HttpError(400, 'client_envelope.share_id must be a valid UUID v4');
  }
  if (envObj.alg !== 'AES-256-GCM') {
    throw new HttpError(400, 'client_envelope.alg must be AES-256-GCM');
  }
  if (envObj.kdf !== 'HKDF-SHA256') {
    throw new HttpError(400, 'client_envelope.kdf must be HKDF-SHA256');
  }
  const saltB64u = String(envObj.salt_b64u || '');
  if (!/^[A-Za-z0-9_-]{22}$/.test(saltB64u) || fromBase64Url(saltB64u).length !== 16) {
    throw new HttpError(400, 'client_envelope.salt_b64u must be 16 bytes (22 Base64URL chars)');
  }
  const nonceB64u = String(envObj.nonce_b64u || '');
  if (!/^[A-Za-z0-9_-]{16}$/.test(nonceB64u) || fromBase64Url(nonceB64u).length !== 12) {
    throw new HttpError(400, 'client_envelope.nonce_b64u must be 12 bytes (16 Base64URL chars)');
  }
  const ctB64u = String(envObj.ciphertext_b64u || '');
  if (!/^[A-Za-z0-9_-]{22,1024}$/.test(ctB64u)) {
    throw new HttpError(400, 'client_envelope.ciphertext_b64u is invalid or out of bounds');
  }
  const ctBytes = fromBase64Url(ctB64u);
  if (ctBytes.length < 17 || ctBytes.length > 700) {
    throw new HttpError(400, 'client_envelope.ciphertext_b64u decoded size must be between 17 and 700 bytes');
  }

  const canonical = {
    v: 2,
    share_id: shareId,
    alg: 'AES-256-GCM',
    kdf: 'HKDF-SHA256',
    salt_b64u: saltB64u,
    nonce_b64u: nonceB64u,
    ciphertext_b64u: ctB64u,
  };
  const serialized = JSON.stringify(canonical);
  if (Buffer.byteLength(serialized, 'utf8') > 1536) {
    throw new HttpError(400, 'Serialized client_envelope exceeds 1536 bytes');
  }
  return { canonical, serialized };
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

function normalizeOrigin(originStr) {
  try {
    const u = new URL(originStr);
    if (u.hostname === '127.0.0.1') {
      u.hostname = 'localhost';
    }
    return u.origin;
  } catch {
    return String(originStr).replace(/\/+$/, '');
  }
}

function extractBearerToken(request) {
  const auth = request.headers.get('Authorization') || request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+([^\s]+)$/i);
  return m ? m[1].trim() : '';
}

async function handleSharePayload(parsed, request, env) {
  if (!parsed || typeof parsed !== 'object') {
    throw new HttpError(400, 'Invalid JSON body');
  }

  // Strictly forbid plaintext secret submission
  if (
    parsed.password !== undefined ||
    parsed.secret !== undefined ||
    parsed.plaintext !== undefined
  ) {
    throw new HttpError(
      400,
      'Plaintext secrets are not accepted; submit Client Envelope v2 (client_envelope)',
    );
  }

  const { canonical: canonicalEnvelope, serialized: serializedEnvelope } =
    validateAndCanonicalizeEnvelopeV2(parsed.client_envelope);

  const rawPin = parsed.unlockKey !== undefined ? parsed.unlockKey : parsed.unlock_key;
  if (typeof rawPin !== 'string') {
    throw new HttpError(400, 'Mandatory unlockKey (PIN of 4..64 characters) is required');
  }
  const pin = rawPin.trim();
  if (pin.length < 4 || pin.length > 64) {
    throw new HttpError(400, 'unlockKey (PIN) must be between 4 and 64 characters');
  }

  let delaySeconds = 0;
  if (parsed.unlockAfterSeconds !== undefined && parsed.unlockAfterSeconds !== null) {
    const n = Number(parsed.unlockAfterSeconds);
    if (!Number.isFinite(n) || n < 0 || n > 518400) {
      throw new HttpError(400, 'unlockAfterSeconds must be between 0 and 518400 seconds');
    }
    delaySeconds = Math.floor(n);
  } else if (parsed.unlockAtIso) {
    const isoStr = String(parsed.unlockAtIso).trim();
    const targetMs = Date.parse(isoStr);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(isoStr) || Number.isNaN(targetMs)) {
      throw new HttpError(400, 'Invalid unlockAtIso timestamp');
    }
    delaySeconds = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
    if (delaySeconds > 518400) {
      throw new HttpError(400, 'Embargo delay cannot exceed 518400 seconds (6 days)');
    }
  }

  const isSample = parsed.is_sample === true;
  let ttlSeconds = isSample ? Math.max(3600, delaySeconds + 3600) : 86400;
  if (parsed.ttlSeconds !== undefined && parsed.ttlSeconds !== null) {
    const t = Number(parsed.ttlSeconds);
    if (!Number.isFinite(t) || t < 60 || t > 604800) {
      throw new HttpError(400, 'ttlSeconds must be between 60 and 604800 seconds');
    }
    ttlSeconds = Math.floor(t);
  }
  if (ttlSeconds < delaySeconds + 3600) {
    ttlSeconds = Math.min(604800, delaySeconds + 3600);
  }

  let apiKey = extractBearerToken(request);
  if (!apiKey && isSample) {
    apiKey = String(env.BITBOP_SAMPLE_API_KEY || env.BITBOP_API_KEY || '').trim();
  }
  if (!apiKey) {
    throw new HttpError(
      401,
      'Sender API key required (Authorization: Bearer <key>). Mint a Free Key or run the Sample Demo.',
    );
  }

  const apiBase = (env.BITBOP_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
  const envelopeHashHex = crypto.createHash('sha256').update(serializedEnvelope, 'utf8').digest('hex');
  const contextHash = 'sha256:' + envelopeHashHex;
  const sealPayloadB64 = Buffer.from(serializedEnvelope, 'utf8').toString('base64');

  const clientIp =
    request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
  const commitHeaders = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + apiKey,
    'X-BitBop-Service-Profile': 'secretsender-v2',
  };
  if (isSample) {
    commitHeaders['X-BitBop-Sample-Demo'] = '1';
  }
  if (clientIp) {
    commitHeaders['X-Forwarded-For'] = clientIp;
  }

  const { status, data } = await apiFetch(env, apiBase, '/escrow/commit', {
    method: 'POST',
    headers: commitHeaders,
    body: JSON.stringify({
      context_hash: contextHash,
      seal_payload_b64: sealPayloadB64,
      store_sealed_envelope: true,
      reveal_policy: 'once',
      escrow_profile: 'secretsender-v2',
      idempotency_key: canonicalEnvelope.share_id,
      unlock_after_seconds: delaySeconds,
      ttl_seconds: ttlSeconds,
      unlock_key: pin,
      signature_scheme: 'ml-dsa-44',
    }),
  });

  if (status !== 200) {
    throw new HttpError(status, data?.error || data?.message || `BitBop commit failed (${status})`);
  }

  // Verify receipt both via local ML-DSA-44 public key and BitBop /verify endpoint
  const localSig = verifyReceiptSignatureInWorker(data, env);
  const verifyResp = await apiFetch(env, apiBase, '/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const remoteValid = verifyResp.status === 200 && verifyResp.data?.valid === true;
  const verifyOk = Boolean(localSig.valid && remoteValid);
  if (!verifyOk) {
    throw new HttpError(
      502,
      `Commit receipt verification failed (local_mldsa44=${localSig.valid}, remote_verify=${remoteValid})`,
    );
  }

  const reqUrl = new URL(request.url);
  const rawOrigin = env.PUBLIC_ORIGIN ? String(env.PUBLIC_ORIGIN).replace(/\/+$/, '') : reqUrl.origin;
  const publicOrigin = normalizeOrigin(rawOrigin);
  const escrowId = data.escrow_id;
  const baseClaimUrl = `${publicOrigin}/?escrow_id=${encodeURIComponent(escrowId)}`;
  const provenanceUrl =
    'https://www.bitbop.dev/provenance?escrow_id=' +
    encodeURIComponent(escrowId) +
    '&sequence=' +
    encodeURIComponent(String(data.beacon_sequence || ''));

  return {
    escrow_id: escrowId,
    share_id: canonicalEnvelope.share_id,
    base_claim_url: baseClaimUrl,
    unlock_at: data.unlock_at,
    unlock_after_seconds: delaySeconds,
    ttl_seconds: data.ttl_seconds || ttlSeconds,
    expires_at: data.expires_at || new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    provenance_url: provenanceUrl,
    commit_receipt: data,
    evidence_receipt: data.evidence_receipt || data,
    commit_verified: verifyOk,
    commit_verification: {
      ...(verifyResp.data || {}),
      valid: verifyOk,
      local_mldsa44_valid: localSig.valid,
      key_id: localSig.key_id,
    },
  };
}

async function handleShareRequest(request, env) {
  let parsed;
  try {
    const rawBody = await request.text();
    parsed = JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, 'Malformed JSON request body');
  }
  return handleSharePayload(parsed, request, env);
}

export const REFLECTOR_SYNTHETIC_LINK_KEY_B64U = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const REFLECTOR_SYNTHETIC_PLAINTEXT = 'SYNTHETIC-REFLECTOR-PROBE-V2';

/**
 * Encrypts a synthetic plaintext into a Client Envelope v2 inside the isolate
 * (used exclusively by POST /api/reflect synthetic UAT diagnostics and unit tests).
 */
export async function encryptSyntheticEnvelopeV2InIsolate(
  plaintext = REFLECTOR_SYNTHETIC_PLAINTEXT,
  fixedLinkKeyB64u = null,
) {
  const linkKeyBytes = fixedLinkKeyB64u ? fromBase64Url(fixedLinkKeyB64u) : crypto.randomBytes(32);
  if (linkKeyBytes.length !== 32) {
    throw new Error('Invalid synthetic link_key length');
  }
  const linkKeyB64u = toBase64Url(linkKeyBytes);
  const saltBytes = crypto.randomBytes(16);
  const saltB64u = toBase64Url(saltBytes);
  const nonceBytes = crypto.randomBytes(12);
  const nonceB64u = toBase64Url(nonceBytes);
  const shareId = crypto.randomUUID();

  const ikmKey = await crypto.subtle.importKey('raw', linkKeyBytes, 'HKDF', false, ['deriveKey']);
  const infoBytes = new TextEncoder().encode('secretsender:envelope:v2:aes256gcm');
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: infoBytes },
    ikmKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  const aadStr = `secretsender:envelope:v2:${shareId}:${saltB64u}:${nonceB64u}`;
  const aadBytes = new TextEncoder().encode(aadStr);
  const ptBytes = new TextEncoder().encode(String(plaintext));
  const ctBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonceBytes, additionalData: aadBytes },
    aesKey,
    ptBytes,
  );

  return {
    linkKeyB64u,
    client_envelope: {
      v: 2,
      share_id: shareId,
      alg: 'AES-256-GCM',
      kdf: 'HKDF-SHA256',
      salt_b64u: saltB64u,
      nonce_b64u: nonceB64u,
      ciphertext_b64u: toBase64Url(new Uint8Array(ctBuf)),
    },
  };
}

/**
 * Decrypts a Client Envelope v2 JSON string using linkKeyB64u.
 */
export async function decryptSyntheticEnvelopeV2InIsolate(envelopeJsonStr, linkKeyB64u) {
  const envObj = typeof envelopeJsonStr === 'string' ? JSON.parse(envelopeJsonStr) : envelopeJsonStr;
  const { canonical } = validateAndCanonicalizeEnvelopeV2(envObj);
  const linkKeyBytes = fromBase64Url(linkKeyB64u);
  if (linkKeyBytes.length !== 32) {
    throw new Error('Invalid synthetic link_key length');
  }
  const saltBytes = fromBase64Url(canonical.salt_b64u);
  const nonceBytes = fromBase64Url(canonical.nonce_b64u);
  const ctBytes = fromBase64Url(canonical.ciphertext_b64u);

  const ikmKey = await crypto.subtle.importKey('raw', linkKeyBytes, 'HKDF', false, ['deriveKey']);
  const infoBytes = new TextEncoder().encode('secretsender:envelope:v2:aes256gcm');
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: infoBytes },
    ikmKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const aadStr = `secretsender:envelope:v2:${canonical.share_id}:${canonical.salt_b64u}:${canonical.nonce_b64u}`;
  const aadBytes = new TextEncoder().encode(aadStr);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonceBytes, additionalData: aadBytes },
    aesKey,
    ctBytes,
  );
  return new TextDecoder().decode(plainBuf);
}

/**
 * Decrypts outer BitBop /escrow/reveal payload using WebCrypto + ML-KEM-768.
 */
async function decryptBitBopRevealInIsolate(revealData, secretKeyBytes, kemInstance) {
  const cipher = revealData.cipher;
  const sealed = revealData.sealed_envelope;
  if (!cipher || !sealed) {
    throw new Error('Missing cipher or sealed_envelope in BitBop reveal response');
  }

  if (revealData.envelope_commitment_sha256) {
    const envCommitInput = `${sealed.cipher || 'AES-256-GCM'}:${sealed.kdf || 'SHA-256(entropy_hex)'}:${sealed.iv_hex}:${sealed.ciphertext_b64}`;
    const computed1 = crypto.createHash('sha256').update(envCommitInput, 'utf8').digest('hex');
    const computed2 = crypto
      .createHash('sha256')
      .update(String(sealed.ciphertext_b64 || ''), 'utf8')
      .digest('hex');
    const actual = String(revealData.envelope_commitment_sha256)
      .replace(/^sha256:/i, '')
      .toLowerCase();
    if (computed1 !== actual && computed2 !== actual) {
      throw new Error('Sealed envelope commitment mismatch');
    }
  }

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

/**
 * Synthetic External Agent Reflector endpoint (POST /api/reflect)
 * Strictly restricted to fixed internal synthetic Client Envelope v2 UAT flows.
 */
async function handleReflectRequest(request, env) {
  const apiBase = (env.BITBOP_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
  const edgeTelemetry = extractEdgeTelemetry(request);
  let body;
  try {
    const rawBody = await request.text();
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw new HttpError(400, 'Malformed JSON request body');
  }
  if (!body || typeof body !== 'object') {
    throw new HttpError(400, 'Invalid JSON body');
  }

  const FORBIDDEN_REFLECT_KEYS = [
    'password',
    'secret',
    'plaintext',
    'synthetic_secret',
    'link_key',
    'link_key_b64u',
  ];
  for (const forbiddenKey of FORBIDDEN_REFLECT_KEYS) {
    if (body[forbiddenKey] !== undefined) {
      throw new HttpError(
        400,
        `Reflector rejects caller-supplied '${forbiddenKey}'; uses fixed internal synthetic payload and link_key only`,
      );
    }
  }
  if (typeof body.claim_url === 'string' && body.claim_url.includes('#')) {
    throw new HttpError(
      400,
      'Reflector rejects claim_url containing # fragment; uses fixed internal synthetic link_key only',
    );
  }

  const action = body.action || 'ping';

  if (action === 'ping') {
    return {
      ok: true,
      action: 'ping',
      edge_telemetry: edgeTelemetry,
    };
  }

  if (action === 'seal') {
    const rawPin =
      body.pin !== undefined
        ? body.pin
        : body.unlockKey !== undefined
          ? body.unlockKey
          : body.unlock_key;
    const pin =
      rawPin && String(rawPin).trim().length >= 4
        ? String(rawPin).trim()
        : crypto.randomBytes(4).toString('hex');
    const { client_envelope } = await encryptSyntheticEnvelopeV2InIsolate(
      REFLECTOR_SYNTHETIC_PLAINTEXT,
      REFLECTOR_SYNTHETIC_LINK_KEY_B64U,
    );

    let shareRequest = request;
    if (!extractBearerToken(request) && env.BITBOP_API_KEY) {
      const headers = new Headers(request.headers);
      headers.set('Authorization', `Bearer ${String(env.BITBOP_API_KEY).trim()}`);
      shareRequest = new Request(request.url, { method: request.method, headers });
    }

    const shareResult = await handleSharePayload(
      {
        client_envelope,
        unlockKey: pin,
        unlockAfterSeconds: body.unlockAfterSeconds,
        unlockAtIso: body.unlockAtIso,
        ttlSeconds: body.ttlSeconds,
        is_sample: false,
      },
      shareRequest,
      env,
    );

    return {
      ok: true,
      action: 'seal',
      edge_telemetry: edgeTelemetry,
      share: {
        ...shareResult,
        pin,
        unlock_key: pin,
        claim_url: shareResult.base_claim_url,
      },
    };
  }

  if (action === 'claim') {
    let escrowId = body.escrow_id;
    if (!escrowId && typeof body.claim_url === 'string') {
      try {
        escrowId = new URL(body.claim_url).searchParams.get('escrow_id') || '';
      } catch {
        throw new HttpError(400, 'Invalid claim_url in reflect claim');
      }
    }
    const unlockKey =
      body.pin !== undefined
        ? body.pin
        : body.unlock_key !== undefined
          ? body.unlock_key
          : body.unlockKey;
    if (!escrowId || !unlockKey) {
      throw new HttpError(400, 'escrow_id and pin (or unlock_key) are required for reflect claim');
    }

    const steps = [];
    const kem = new MlKem768();
    const [publicKey, secretKey] = await kem.generateKeyPair();
    const pkHex = Buffer.from(publicKey).toString('hex');

    // Step 0: Non-consuming status check (must pass before reveal)
    const statusResp = await apiFetch(
      env,
      apiBase,
      `/escrow/status?escrow_id=${encodeURIComponent(escrowId)}`,
      { method: 'GET' },
    );
    const statusState = statusResp.data?.status || statusResp.data?.state || 'available';
    const statusPassed =
      statusResp.status === 200 &&
      (statusState === 'available' || statusState === 'ready') &&
      statusResp.data?.burned !== true &&
      statusResp.data?.escrow_profile === 'secretsender-v2' &&
      statusResp.data?.requires_unlock_key === true;
    steps.push({
      step: 'status_precheck',
      status: statusResp.status,
      passed: statusPassed,
    });
    if (!statusPassed) {
      return {
        ok: false,
        action: 'claim',
        edge_telemetry: edgeTelemetry,
        escrow_id: escrowId,
        steps,
        error: 'Escrow status precheck failed before reveal',
      };
    }

    // Step 1: Mandatory wrong PIN non-burn probe (must return HTTP 403)
    const wrongPinResp = await apiFetch(env, apiBase, '/escrow/reveal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '198.51.100.250',
      },
      body: JSON.stringify({
        escrow_id: escrowId,
        claim_id: crypto.randomUUID(),
        unlock_key: String(unlockKey) + '-wrong-reflector-pin',
        kyber_public_key: pkHex,
        signature_scheme: 'ml-dsa-44',
      }),
    });
    const wrongPinStatus = wrongPinResp.status;
    const wrongPinPassed = wrongPinResp.status === 403;
    steps.push({
      step: 'wrong_pin_probe',
      status: wrongPinResp.status,
      passed: wrongPinPassed,
    });
    if (!wrongPinPassed) {
      return {
        ok: false,
        action: 'claim',
        edge_telemetry: edgeTelemetry,
        escrow_id: escrowId,
        wrong_pin_status: wrongPinStatus,
        steps,
        error: `Mandatory wrong-PIN probe expected HTTP 403, got ${wrongPinResp.status}`,
      };
    }

    // Step 2: Valid ML-KEM-768 + AES-256-GCM reveal
    const claimId = crypto.randomUUID();
    const revealResp = await apiFetch(env, apiBase, '/escrow/reveal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.77',
      },
      body: JSON.stringify({
        escrow_id: escrowId,
        claim_id: claimId,
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

    const outerPlaintext = await decryptBitBopRevealInIsolate(revealResp.data, secretKey, kem);
    const decryptedPlaintext = await decryptSyntheticEnvelopeV2InIsolate(
      outerPlaintext,
      REFLECTOR_SYNTHETIC_LINK_KEY_B64U,
    );
    const decryptPassed = decryptedPlaintext === REFLECTOR_SYNTHETIC_PLAINTEXT;
    steps.push({
      step: 'mlkem768_aes256gcm_decrypt',
      status: 200,
      passed: decryptPassed,
    });

    // Step 3: Verify ML-DSA-44 reveal receipt (both locally and via /verify)
    const localSig = verifyReceiptSignatureInWorker(revealResp.data, env);
    const verifyResp = await apiFetch(env, apiBase, '/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(revealResp.data),
    });
    const revealVerified = Boolean(
      localSig.valid && verifyResp.status === 200 && verifyResp.data?.valid === true,
    );
    steps.push({
      step: 'mldsa44_receipt_verify',
      status: verifyResp.status,
      passed: revealVerified,
    });

    // Step 4: Confirm second reveal with a distinct claim_id returns HTTP 409 Conflict (burned)
    const burnResp = await apiFetch(env, apiBase, '/escrow/reveal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.77',
      },
      body: JSON.stringify({
        escrow_id: escrowId,
        claim_id: crypto.randomUUID(),
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

    const allStepsPassed = steps.length > 0 && steps.every((s) => s.passed === true);
    return {
      ok: Boolean(revealVerified && allStepsPassed),
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

  throw new HttpError(400, `Unknown reflector action: ${action}`);
}

export default {
  async fetch(request, env = {}) {
    const rawUrl = String(request.url || '');
    // Reject path traversal sequences before URL normalization collapses dot-segments
    const rawPathAndQuery = rawUrl.replace(/^[a-zA-Z]+:\/\/[^/]+/, '').split('#')[0];
    const rawPathPart = rawPathAndQuery.split('?')[0];
    const lowerPathAndQuery = rawPathAndQuery.toLowerCase();
    if (
      rawPathAndQuery.includes('..') ||
      lowerPathAndQuery.includes('%2e') ||
      rawPathPart.toLowerCase().includes('%2f') ||
      rawPathAndQuery.includes('\\') ||
      lowerPathAndQuery.includes('%5c') ||
      lowerPathAndQuery.includes('%00') ||
      rawPathAndQuery.includes('\x00') ||
      lowerPathAndQuery.includes('::$data')
    ) {
      return new Response('Forbidden', {
        status: 403,
        headers: withSecurityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }),
      });
    }

    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return new Response('Bad Request', {
        status: 400,
        headers: withSecurityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }),
      });
    }
    if (
      url.pathname === '/package.json' ||
      url.pathname === '/wrangler.jsonc' ||
      url.pathname.startsWith('/worker/') ||
      url.pathname.startsWith('/scripts/')
    ) {
      return new Response('Forbidden', {
        status: 403,
        headers: withSecurityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }),
      });
    }
    const apiBase = (env.BITBOP_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');

    if (url.pathname === '/health') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', {
          status: 405,
          headers: withSecurityHeaders({ Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }),
        });
      }
      return jsonResponse(200, { status: 'ok', service: 'SecretSender', profile: 'secretsender-v2' });
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
        const status = e instanceof HttpError && e.status ? e.status : 500;
        return jsonResponse(status, { error: e.message || 'Internal error' });
      }
    }

    if (url.pathname === '/api/keys/free') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', {
          status: 405,
          headers: withSecurityHeaders({ Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' }),
        });
      }
      const bodyText = await request.text();
      const headers = { 'Content-Type': 'application/json' };
      const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For');
      if (clientIp) headers['X-Forwarded-For'] = clientIp;
      const { status, data } = await apiFetch(env, apiBase, '/api/keys/free', {
        method: 'POST',
        headers,
        body: bodyText,
      });
      return jsonResponse(status, data);
    }

    if (url.pathname === '/api/key-status') {
      if (request.method !== 'GET') {
        return new Response('Method not allowed', {
          status: 405,
          headers: withSecurityHeaders({ Allow: 'GET', 'Content-Type': 'text/plain; charset=utf-8' }),
        });
      }
      const auth = request.headers.get('Authorization') || '';
      const { status, data } = await apiFetch(env, apiBase, '/api/keys/status', {
        method: 'GET',
        headers: auth ? { Authorization: auth } : {},
      });
      return jsonResponse(status, data);
    }

    if (url.pathname === '/api/escrow/status') {
      if (request.method !== 'GET') {
        return new Response('Method not allowed', {
          status: 405,
          headers: withSecurityHeaders({ Allow: 'GET', 'Content-Type': 'text/plain; charset=utf-8' }),
        });
      }
      const escrowId = url.searchParams.get('escrow_id') || '';
      const { status, data } = await apiFetch(
        env,
        apiBase,
        `/escrow/status?escrow_id=${encodeURIComponent(escrowId)}`,
        { method: 'GET' },
      );
      return jsonResponse(status, data);
    }

    if (url.pathname === '/api/escrow/reveal') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', {
          status: 405,
          headers: withSecurityHeaders({ Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' }),
        });
      }
      const bodyText = await request.text();
      const headers = { 'Content-Type': 'application/json' };
      const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For');
      if (clientIp) headers['X-Forwarded-For'] = clientIp;
      const { status, data } = await apiFetch(env, apiBase, '/escrow/reveal', {
        method: 'POST',
        headers,
        body: bodyText,
      });
      return jsonResponse(status, data);
    }

    if (url.pathname === '/api/escrow/verify') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', {
          status: 405,
          headers: withSecurityHeaders({ Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' }),
        });
      }
      const bodyText = await request.text();
      let parsedReceipt = null;
      try {
        parsedReceipt = JSON.parse(bodyText);
      } catch {
        return jsonResponse(400, { valid: false, error: 'Invalid JSON receipt' });
      }
      const localSig = verifyReceiptSignatureInWorker(parsedReceipt, env);
      const { status, data } = await apiFetch(env, apiBase, '/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyText,
      });
      const combinedValid = Boolean(status === 200 && data?.valid === true && localSig.valid);
      return jsonResponse(status === 200 ? 200 : status, {
        ...(data || {}),
        valid: combinedValid,
        local_mldsa44_valid: localSig.valid,
        key_id: localSig.key_id,
      });
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
        const status = e instanceof HttpError && e.status ? e.status : 500;
        return jsonResponse(status, { ok: false, error: e.message || 'Reflector error' });
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return new Response('Not found', {
        status: 404,
        headers: withSecurityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }),
      });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', {
        status: 405,
        headers: withSecurityHeaders({ Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }),
      });
    }

    const assetResp = await env.ASSETS.fetch(request);
    const extra = {};
    if (url.pathname === '/' || url.pathname === '/index.html') {
      extra['Cache-Control'] = 'no-store';
    }
    return new Response(assetResp.body, {
      status: assetResp.status,
      headers: withSecurityHeaders(assetResp.headers, extra),
    });
  },
};
