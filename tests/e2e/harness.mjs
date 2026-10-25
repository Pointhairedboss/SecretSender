import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MlKem768 } from 'mlkem';
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';
import worker, {
  encryptSyntheticEnvelopeV2InIsolate,
  decryptSyntheticEnvelopeV2InIsolate,
  validateAndCanonicalizeEnvelopeV2,
} from '../../worker/index.mjs';
import { buildHtml } from '../../scripts/client_template.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

/**
 * Finds an available TCP port on 127.0.0.1.
 */
export function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

function canonicalSignPayload(obj) {
  const excluded = new Set([
    'signature_b64',
    'sig_alg',
    'signature_scheme',
    'sealed_envelope',
    'cipher',
    'VerifyURL',
    'verify_url',
  ]);
  const out = {};
  for (const k of Object.keys(obj).sort()) {
    if (!excluded.has(k) && obj[k] !== undefined) {
      out[k] = obj[k];
    }
  }
  return JSON.stringify(out);
}

/**
 * Creates an in-process cryptographic BitBop v2 service instance using real ML-DSA-44 and ML-KEM-768.
 */
async function createRealCryptoBitBopUpstream() {
  const port = await getFreePort();
  const kem = new MlKem768();
  const dsaKeys = ml_dsa44.keygen();
  const publicKeyB64 = Buffer.from(dsaKeys.publicKey).toString('base64');
  const releaseKeyId = 'mldsa44-release-2026-01';

  const escrows = new Map();
  const idempotencyMap = new Map();
  const apiKeys = new Map([
    [
      'bb_free_test_sender_key',
      {
        tier: 'free',
        valid: true,
        daily_limit: 5,
        used_today: 0,
        remaining_today: 5,
        max_embargo_seconds: 86400,
        max_ttl_seconds: 86400,
      },
    ],
    [
      'bb_live_test_builder_key',
      {
        tier: 'builder',
        valid: true,
        daily_limit: 500,
        used_today: 0,
        remaining_today: 500,
        max_embargo_seconds: 518400,
        max_ttl_seconds: 604800,
      },
    ],
  ]);

  let beaconSeq = 900000;

  function signReceipt(payload) {
    const receipt = {
      ...payload,
      release_key_id: releaseKeyId,
      sig_alg: 'ML-DSA-44',
      signature_scheme: 'ml-dsa-44',
    };
    const msgBytes = new Uint8Array(Buffer.from(canonicalSignPayload(receipt), 'utf8'));
    const sigBytes = ml_dsa44.sign(msgBytes, dsaKeys.secretKey);
    receipt.signature_b64 = Buffer.from(sigBytes).toString('base64');
    return receipt;
  }

  function verifyReceipt(receipt) {
    if (!receipt || typeof receipt !== 'object' || typeof receipt.signature_b64 !== 'string') {
      return { valid: false, error: 'Missing signature_b64' };
    }
    try {
      const msgBytes = new Uint8Array(Buffer.from(canonicalSignPayload(receipt), 'utf8'));
      const sigBytes = new Uint8Array(Buffer.from(receipt.signature_b64, 'base64'));
      const ok = ml_dsa44.verify(sigBytes, msgBytes, dsaKeys.publicKey);
      return {
        valid: Boolean(ok),
        signature_scheme: 'ml-dsa-44',
        release_key_id: receipt.release_key_id || releaseKeyId,
      };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  async function handleRequest(method, urlObj, headers, rawBody) {
    const pathname = urlObj.pathname;

    if (method === 'POST' && pathname === '/api/keys/free') {
      const body = rawBody ? JSON.parse(rawBody) : {};
      const pkBytes = Buffer.from(String(body.kyber_public_key || ''), 'hex');
      if (pkBytes.length !== 1184) {
        return { status: 400, data: { error: 'Invalid kyber_public_key' } };
      }
      const mintedKey = `bb_free_${crypto.randomBytes(8).toString('hex')}`;
      apiKeys.set(mintedKey, {
        tier: 'free',
        valid: true,
        daily_limit: 5,
        used_today: 0,
        remaining_today: 5,
        max_embargo_seconds: 86400,
        max_ttl_seconds: 86400,
      });

      const [ct, sharedSecret] = await kem.encap(pkBytes);
      const aesKey = await crypto.webcrypto.subtle.importKey(
        'raw',
        sharedSecret,
        { name: 'AES-GCM' },
        false,
        ['encrypt'],
      );
      const iv = crypto.randomBytes(12);
      const encBuf = await crypto.webcrypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        new TextEncoder().encode(mintedKey),
      );
      return {
        status: 200,
        data: {
          tier: 'free',
          daily_limit: 5,
          cipher: {
            kyber_ciphertext_hex: Buffer.from(ct).toString('hex'),
            aes_iv_hex: iv.toString('hex'),
            aes_ciphertext_hex: Buffer.from(encBuf).toString('hex'),
          },
        },
      };
    }

    if (method === 'GET' && pathname === '/api/keys/status') {
      const auth = String(headers['authorization'] || headers['Authorization'] || '');
      const m = auth.match(/^Bearer\s+(.+)$/i);
      const token = m ? m[1].trim() : '';
      const info = apiKeys.get(token);
      if (!info) {
        return { status: 401, data: { valid: false, error: 'Invalid API key' } };
      }
      return { status: 200, data: info };
    }

    if (method === 'POST' && pathname === '/escrow/commit') {
      const auth = String(headers['authorization'] || headers['Authorization'] || '');
      if (!auth.startsWith('Bearer ')) {
        return { status: 401, data: { error: 'Unauthorized' } };
      }
      const body = rawBody ? JSON.parse(rawBody) : {};
      const escrowProfile = body.escrow_profile || 'default';
      if (escrowProfile === 'secretsender-v2') {
        const pin = String(body.unlock_key || '').trim();
        if (pin.length < 4 || pin.length > 64) {
          return { status: 400, data: { error: 'secretsender-v2 requires unlock_key of 4..64 chars' } };
        }
      }

      if (body.idempotency_key && idempotencyMap.has(body.idempotency_key)) {
        const existing = idempotencyMap.get(body.idempotency_key);
        if (existing.context_hash === body.context_hash) {
          return { status: 200, data: existing.receipt };
        }
        return { status: 409, data: { error: 'Idempotency key conflict' } };
      }

      const escrowId = `esc_${crypto.randomUUID()}`;
      const seq = ++beaconSeq;
      const nowMs = Date.now();
      const delaySec = Math.max(0, Number(body.unlock_after_seconds || 0));
      const ttlSec = Math.max(60, Number(body.ttl_seconds || 86400));
      const unlockAtIso = new Date(nowMs + delaySec * 1000).toISOString();
      const expiresAtIso = new Date(nowMs + ttlSec * 1000).toISOString();

      // Hardware entropy sealing of body.seal_payload_b64
      const entropyBytes = crypto.randomBytes(32);
      const entropyHex = entropyBytes.toString('hex');
      const envKeyDigest = await crypto.webcrypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(entropyHex),
      );
      const envKey = await crypto.webcrypto.subtle.importKey(
        'raw',
        envKeyDigest,
        { name: 'AES-GCM' },
        false,
        ['encrypt'],
      );
      const envIv = crypto.randomBytes(12);
      const plainBytes = Buffer.from(String(body.seal_payload_b64 || ''), 'base64');
      const envCtBuf = await crypto.webcrypto.subtle.encrypt(
        { name: 'AES-GCM', iv: envIv },
        envKey,
        plainBytes,
      );
      const ciphertextB64 = Buffer.from(envCtBuf).toString('base64');
      const envelopeCommitment =
        'sha256:' + crypto.createHash('sha256').update(ciphertextB64, 'utf8').digest('hex');

      const commitReceipt = signReceipt({
        receipt_type: 'escrow_commit',
        escrow_id: escrowId,
        escrow_profile: escrowProfile,
        context_hash: body.context_hash,
        envelope_commitment_sha256: envelopeCommitment,
        beacon_sequence: seq,
        unlock_at: unlockAtIso,
        ttl_seconds: ttlSec,
        expires_at: expiresAtIso,
        committed_at: new Date(nowMs).toISOString(),
      });

      escrows.set(escrowId, {
        escrow_id: escrowId,
        escrow_profile: escrowProfile,
        context_hash: body.context_hash,
        unlock_key: body.unlock_key ? String(body.unlock_key) : null,
        requires_unlock_key: Boolean(body.unlock_key),
        unlock_at_ms: nowMs + delaySec * 1000,
        unlock_at: unlockAtIso,
        expires_at_ms: nowMs + ttlSec * 1000,
        expires_at: expiresAtIso,
        ttl_seconds: ttlSec,
        entropy_bytes: entropyBytes,
        sealed_envelope: {
          iv_hex: envIv.toString('hex'),
          ciphertext_b64: ciphertextB64,
        },
        envelope_commitment_sha256: envelopeCommitment,
        beacon_sequence: seq,
        claimed: false,
        claimed_at: null,
        claim_cache: null,
        remaining_attempts: 5,
      });

      if (body.idempotency_key) {
        idempotencyMap.set(body.idempotency_key, {
          context_hash: body.context_hash,
          receipt: commitReceipt,
        });
      }

      return { status: 200, data: commitReceipt };
    }

    if (method === 'GET' && pathname === '/escrow/status') {
      const escrowId = urlObj.searchParams.get('escrow_id') || '';
      const rec = escrows.get(escrowId);
      if (!rec) {
        return { status: 404, data: { error: 'Escrow not found' } };
      }
      const nowMs = Date.now();
      if (nowMs >= rec.expires_at_ms) {
        return {
          status: 410,
          data: {
            escrow_id: escrowId,
            state: 'expired',
            escrow_profile: rec.escrow_profile,
            requires_unlock_key: rec.requires_unlock_key,
            expires_at: rec.expires_at,
          },
        };
      }
      if (rec.claimed) {
        return {
          status: 200,
          data: {
            escrow_id: escrowId,
            state: 'burned',
            burned: true,
            escrow_profile: rec.escrow_profile,
            requires_unlock_key: rec.requires_unlock_key,
            unlock_at: rec.unlock_at,
            expires_at: rec.expires_at,
          },
        };
      }
      const embargoed = nowMs < rec.unlock_at_ms;
      return {
        status: 200,
        data: {
          escrow_id: escrowId,
          state: embargoed ? 'embargoed' : 'ready',
          burned: false,
          escrow_profile: rec.escrow_profile,
          requires_unlock_key: rec.requires_unlock_key,
          unlock_at: rec.unlock_at,
          expires_at: rec.expires_at,
        },
      };
    }

    if (method === 'POST' && pathname === '/escrow/reveal') {
      const body = rawBody ? JSON.parse(rawBody) : {};
      const escrowId = String(body.escrow_id || '');
      const rec = escrows.get(escrowId);
      if (!rec) {
        return { status: 404, data: { error: 'Escrow not found' } };
      }

      const nowMs = Date.now();
      if (nowMs >= rec.expires_at_ms) {
        return { status: 410, data: { error: 'Secret expired (410 Gone)' } };
      }

      if (nowMs < rec.unlock_at_ms) {
        return {
          status: 425,
          data: {
            error: 'Time-Locked: embargo window active',
            unlock_at: rec.unlock_at,
          },
        };
      }

      // Check 5-minute claim_id retry idempotency cache before 409 burn check
      if (
        rec.claimed &&
        body.claim_id &&
        rec.claim_cache &&
        rec.claim_cache.claim_id === body.claim_id &&
        rec.claim_cache.kyber_public_key === body.kyber_public_key &&
        nowMs - rec.claim_cache.cached_at_ms <= 300000
      ) {
        return { status: 200, data: rec.claim_cache.response };
      }

      if (rec.claimed) {
        return { status: 409, data: { error: 'Secret already claimed and permanently burned' } };
      }

      if (rec.requires_unlock_key) {
        const providedPin = body.unlock_key !== undefined ? String(body.unlock_key).trim() : '';
        if (!providedPin || providedPin !== rec.unlock_key) {
          rec.remaining_attempts = Math.max(0, rec.remaining_attempts - 1);
          return {
            status: 403,
            data: {
              error: 'Wrong unlock key',
              remaining_attempts: rec.remaining_attempts,
            },
          };
        }
      }

      const pkBytes = Buffer.from(String(body.kyber_public_key || ''), 'hex');
      if (pkBytes.length !== 1184) {
        return { status: 400, data: { error: 'Invalid kyber_public_key (expected 1184 bytes)' } };
      }

      const [kyberCt, sharedSecret] = await kem.encap(pkBytes);
      const transitKey = await crypto.webcrypto.subtle.importKey(
        'raw',
        sharedSecret,
        { name: 'AES-GCM' },
        false,
        ['encrypt'],
      );
      const transitIv = crypto.randomBytes(12);
      const transitCtBuf = await crypto.webcrypto.subtle.encrypt(
        { name: 'AES-GCM', iv: transitIv },
        transitKey,
        rec.entropy_bytes,
      );

      rec.claimed = true;
      rec.claimed_at = new Date(nowMs).toISOString();
      const seq = ++beaconSeq;

      const signedReveal = signReceipt({
        receipt_type: 'escrow_reveal',
        escrow_id: escrowId,
        escrow_profile: rec.escrow_profile,
        context_hash: rec.context_hash,
        envelope_commitment_sha256: rec.envelope_commitment_sha256,
        beacon_sequence: seq,
        revealed_at: rec.claimed_at,
      });

      const fullRevealResponse = {
        ...signedReveal,
        cipher: {
          kyber_ciphertext_hex: Buffer.from(kyberCt).toString('hex'),
          aes_iv_hex: transitIv.toString('hex'),
          aes_ciphertext_hex: Buffer.from(transitCtBuf).toString('hex'),
        },
        sealed_envelope: rec.sealed_envelope,
      };

      if (body.claim_id) {
        rec.claim_cache = {
          claim_id: body.claim_id,
          kyber_public_key: body.kyber_public_key,
          cached_at_ms: nowMs,
          response: fullRevealResponse,
        };
      }

      return { status: 200, data: fullRevealResponse };
    }

    if (method === 'POST' && pathname === '/verify') {
      const receipt = rawBody ? JSON.parse(rawBody) : {};
      const res = verifyReceipt(receipt);
      return { status: res.valid ? 200 : 400, data: res };
    }

    if (method === 'GET' && pathname.startsWith('/test/escrow/')) {
      const id = decodeURIComponent(pathname.replace('/test/escrow/', ''));
      const rec = escrows.get(id);
      if (!rec) return { status: 404, data: { error: 'Not found' } };
      return {
        status: 200,
        data: {
          escrow_id: rec.escrow_id,
          claimed: rec.claimed,
          claimed_at: rec.claimed_at,
          escrow_profile: rec.escrow_profile,
          requires_unlock_key: rec.requires_unlock_key,
        },
      };
    }

    return { status: 404, data: { error: 'Not found' } };
  }

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const urlObj = new URL(req.url, `http://127.0.0.1:${port}`);
        const { status, data } = await handleRequest(req.method, urlObj, req.headers, rawBody);
        const bodyStr = JSON.stringify(data);
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(bodyStr);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    publicKeyB64,
    escrows,
    async fetch(request) {
      const urlObj = new URL(request.url);
      const rawBody = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
      const headersObj = {};
      request.headers.forEach((v, k) => {
        headersObj[k] = v;
      });
      const { status, data } = await handleRequest(request.method, urlObj, headersObj, rawBody);
      return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Ensures public/index.html and public/mlkem.browser.js are built from scripts/client_template.mjs
 * and serves them via an in-memory Cloudflare Static Assets binding.
 */
function createStaticAssetsBinding(testPublicKeyB64 = null) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.writeFileSync(path.join(PUBLIC_DIR, 'index.html'), buildHtml(), 'utf8');
  fs.copyFileSync(path.join(ROOT_DIR, 'mlkem.browser.js'), path.join(PUBLIC_DIR, 'mlkem.browser.js'));

  const MIME_MAP = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
  };

  return {
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
        return new Response('Not found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
      let relPath = url.pathname === '/' ? '/index.html' : url.pathname;
      const safeRel = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
      const fullPath = path.join(PUBLIC_DIR, safeRel);
      if (!fullPath.startsWith(PUBLIC_DIR) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
        return new Response('Not found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
      const ext = path.extname(fullPath).toLowerCase();
      const contentType = MIME_MAP[ext] || 'application/octet-stream';
      const headers = { 'Content-Type': contentType };
      if (ext === '.js') {
        headers['Cache-Control'] = 'public, max-age=3600';
      } else if (ext === '.svg') {
        headers['Cache-Control'] = 'public, max-age=86400';
      }
      let buf = fs.readFileSync(fullPath);
      if (url.pathname === '/mlkem.browser.js' && testPublicKeyB64) {
        const override = `\nif (typeof window !== 'undefined' && window.BitBopMlKem && window.BitBopMlKem.TRUSTED_RELEASE_KEYS) { window.BitBopMlKem.TRUSTED_RELEASE_KEYS['mldsa44-release-2026-01'] = ${JSON.stringify(testPublicKeyB64)}; }\n`;
        buf = Buffer.concat([buf, Buffer.from(override, 'utf8')]);
      }
      headers['Content-Length'] = String(buf.length);
      return new Response(request.method === 'HEAD' ? null : buf, {
        status: 200,
        headers,
      });
    },
  };
}

/**
 * Manages the full Worker-only test environment lifecycle:
 * - Real cryptographic BitBop upstream service (ML-DSA-44 + ML-KEM-768)
 * - Cloudflare Worker (`worker/index.mjs`) HTTP server + Static Assets binding
 * - Client Envelope v2 cryptographic helpers
 */
export async function setupTestEnvironment(customEnv = {}) {
  const bitbopUpstream = await createRealCryptoBitBopUpstream();
  const appPort = await getFreePort();
  const assetsBinding = createStaticAssetsBinding(bitbopUpstream.publicKeyB64);

  const workerEnv = {
    BITBOP_API_BASE: customEnv.BITBOP_API_BASE || bitbopUpstream.baseUrl,
    BITBOP_API_KEY: 'bb_free_test_sender_key',
    BITBOP_SAMPLE_API_KEY: 'bb_free_test_sender_key',
    SERVICE_PUBLIC_KEY_MLDSA44_B64: bitbopUpstream.publicKeyB64,
    ASSETS: assetsBinding,
    BITBOP_API: bitbopUpstream,
    ...customEnv,
  };

  const appLogs = [];
  const linkKeyRegistry = new Map(); // share_id -> linkKeyB64u

  const workerServer = http.createServer(async (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
        const rawReqUrl = String(req.url || '');
        if (rawReqUrl.startsWith('\\') || rawReqUrl.includes('\x00')) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Forbidden');
          return;
        }
        const host = req.headers.host || `127.0.0.1:${appPort}`;
        const proto = req.headers['x-forwarded-proto'] || 'http';
        const fullUrl = `${proto}://${host}${rawReqUrl}`;
        appLogs.push({ method: req.method, url: rawReqUrl, timestamp: Date.now() });

        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (Array.isArray(v)) headers.set(k, v.join(', '));
          else if (v !== undefined) headers.set(k, String(v));
        }

        const bodyBuf = Buffer.concat(chunks);
        let fetchReq;
        const needsRawRequestProxy =
          req.method === 'TRACE' ||
          rawReqUrl.includes('..') ||
          rawReqUrl.toLowerCase().includes('%2e') ||
          rawReqUrl.toLowerCase().includes('%2f') ||
          rawReqUrl.includes('\\') ||
          rawReqUrl.toLowerCase().includes('%5c') ||
          rawReqUrl.toLowerCase().includes('%00') ||
          rawReqUrl.toLowerCase().includes('::$data');
        if (needsRawRequestProxy) {
          fetchReq = {
            url: fullUrl,
            method: req.method,
            headers,
            text: async () => bodyBuf.toString('utf8'),
          };
        } else {
          fetchReq = new Request(fullUrl, {
            method: req.method,
            headers,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : bodyBuf,
          });
        }

        const workerResp = await worker.fetch(fetchReq, workerEnv);
        const respHeaders = {};
        workerResp.headers.forEach((v, k) => {
          respHeaders[k] = v;
        });
        const respBuf = Buffer.from(await workerResp.arrayBuffer());
        res.writeHead(workerResp.status, respHeaders);
        res.end(respBuf);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });

  await new Promise((resolve) => workerServer.listen(appPort, '127.0.0.1', resolve));
  const appUrl = `http://127.0.0.1:${appPort}`;
  const kem = new MlKem768();

  return {
    appPort,
    appUrl,
    upstreamServer: bitbopUpstream,
    upstreamUrl: bitbopUpstream.baseUrl,
    appLogs,
    kem,
    senderApiKey: 'bb_free_test_sender_key',
    builderApiKey: 'bb_live_test_builder_key',

    async generateKeyPair() {
      const kp = await kem.generateKeyPair();
      return {
        publicKey: kp[0],
        secretKey: kp[1],
        publicKeyHex: Buffer.from(kp[0]).toString('hex'),
      };
    },

    async createClientEnvelope(secretPlaintext) {
      const { linkKeyB64u, client_envelope } = await encryptSyntheticEnvelopeV2InIsolate(secretPlaintext);
      linkKeyRegistry.set(client_envelope.share_id, linkKeyB64u);
      return { linkKeyB64u, client_envelope };
    },

    async buildShareRequest(secretPlaintext, opts = {}) {
      const { linkKeyB64u, client_envelope } = await this.createClientEnvelope(secretPlaintext);
      const body = {
        client_envelope,
        unlockKey: opts.unlockKey !== undefined ? opts.unlockKey : 'pin-1234',
      };
      if (opts.unlockAfterSeconds !== undefined) body.unlockAfterSeconds = opts.unlockAfterSeconds;
      if (opts.unlockAtIso !== undefined) body.unlockAtIso = opts.unlockAtIso;
      if (opts.ttlSeconds !== undefined) body.ttlSeconds = opts.ttlSeconds;
      if (opts.is_sample !== undefined) body.is_sample = opts.is_sample;
      return { linkKeyB64u, client_envelope, body };
    },

    async decryptReveal(revealData, secretKeyBytes, explicitLinkKeyB64u = null) {
      const kyberCt = Buffer.from(revealData.cipher.kyber_ciphertext_hex, 'hex');
      const sharedSecret = await kem.decap(kyberCt, secretKeyBytes);

      const transitKey = await crypto.webcrypto.subtle.importKey(
        'raw',
        sharedSecret,
        { name: 'AES-GCM' },
        false,
        ['decrypt'],
      );
      const transitIv = Buffer.from(revealData.cipher.aes_iv_hex, 'hex');
      const transitCt = Buffer.from(revealData.cipher.aes_ciphertext_hex, 'hex');
      const rawEntropyBuf = await crypto.webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: transitIv },
        transitKey,
        transitCt,
      );
      const entropyHex = Buffer.from(rawEntropyBuf).toString('hex');

      const envKeyDigest = await crypto.webcrypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(entropyHex),
      );
      const envKey = await crypto.webcrypto.subtle.importKey(
        'raw',
        envKeyDigest,
        { name: 'AES-GCM' },
        false,
        ['decrypt'],
      );
      const envIv = Buffer.from(revealData.sealed_envelope.iv_hex, 'hex');
      const envCt = Buffer.from(revealData.sealed_envelope.ciphertext_b64, 'base64');
      const plainBuf = await crypto.webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: envIv },
        envKey,
        envCt,
      );
      const outerJsonStr = new TextDecoder().decode(plainBuf);

      let parsedEnv = null;
      try {
        parsedEnv = JSON.parse(outerJsonStr);
      } catch (_) {
        return outerJsonStr;
      }
      if (parsedEnv && parsedEnv.v === 2 && parsedEnv.share_id) {
        const lk = explicitLinkKeyB64u || linkKeyRegistry.get(parsedEnv.share_id);
        if (lk) {
          return await decryptSyntheticEnvelopeV2InIsolate(parsedEnv, lk);
        }
      }
      return outerJsonStr;
    },

    fetchApp(pathname, init = {}) {
      const headers = new Headers(init.headers || {});
      if (
        pathname === '/api/share' &&
        !headers.has('Authorization') &&
        init.omitAuth !== true
      ) {
        headers.set('Authorization', `Bearer ${this.senderApiKey}`);
      }
      return fetch(`${appUrl}${pathname}`, { ...init, headers });
    },

    fetchUpstream(pathname, init = {}) {
      return fetch(`${bitbopUpstream.baseUrl}${pathname}`, init);
    },

    async cleanup() {
      await new Promise((resolve) => workerServer.close(resolve));
      await bitbopUpstream.close();
    },
  };
}
