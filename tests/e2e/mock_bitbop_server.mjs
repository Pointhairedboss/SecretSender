import http from 'node:http';
import crypto from 'node:crypto';
import { MlKem768 } from 'mlkem';

/**
 * Creates and starts a high-fidelity, in-process mock BitBop Escrow API server.
 * Implements ML-KEM-768 post-quantum key encapsulation, AES-256-GCM envelope encryption,
 * ML-DSA-44 receipt verification, timelocks (HTTP 425), non-burn on wrong PIN (HTTP 403),
 * and burn-on-read destruction (HTTP 409).
 */
export async function createMockBitBopServer(preferredPort = 0) {
  const escrows = new Map();
  const accessLog = [];
  const kem = new MlKem768();

  function readJson(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  }

  function sendJson(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  const server = http.createServer(async (req, res) => {
    accessLog.push({ method: req.method, url: req.url, time: Date.now() });

    try {
      const u = new URL(req.url, 'http://localhost');

      // 1. BitBop Free Key Self-Provisioning
      if (req.method === 'POST' && u.pathname === '/api/keys/free') {
        const body = await readJson(req);
        const pkHex = body.kyber_public_key;
        if (!pkHex) {
          return sendJson(res, 400, { error: 'kyber_public_key is required' });
        }
        const clientPk = Buffer.from(pkHex, 'hex');
        const [kyberCt, sharedSecret] = await kem.encap(clientPk);

        const mockApiKey = 'bitbop_free_mock_' + crypto.randomBytes(16).toString('hex');
        const aesIv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(sharedSecret), aesIv);
        const ctBuf = Buffer.concat([cipher.update(mockApiKey, 'utf8'), cipher.final(), cipher.getAuthTag()]);

        return sendJson(res, 200, {
          key: mockApiKey,
          cipher: {
            kyber_ciphertext_hex: Buffer.from(kyberCt).toString('hex'),
            aes_iv_hex: aesIv.toString('hex'),
            aes_ciphertext_hex: ctBuf.toString('hex'),
          },
          signature_scheme: 'ml-dsa-44',
          beacon_sequence: 100,
        });
      }

      // 2. Escrow Commit (Sealing Secret)
      if (req.method === 'POST' && u.pathname === '/escrow/commit') {
        const body = await readJson(req);
        const escrowId = 'bb_escrow_' + crypto.randomUUID();
        const delaySeconds = Number(body.unlock_after_seconds || 0);
        const unlockAt = new Date(Date.now() + Math.max(0, delaySeconds) * 1000).toISOString();

        const record = {
          escrow_id: escrowId,
          context_hash: body.context_hash,
          seal_payload_b64: body.seal_payload_b64,
          unlock_key: body.unlock_key,
          unlock_after_seconds: delaySeconds,
          unlock_at: unlockAt,
          created_at: new Date().toISOString(),
          claimed: false,
          claimed_at: null,
          attempts: 0,
          beacon_sequence: 1042 + escrows.size,
        };

        escrows.set(escrowId, record);

        return sendJson(res, 200, {
          escrow_id: escrowId,
          context_hash: record.context_hash,
          unlock_at: unlockAt,
          beacon_sequence: record.beacon_sequence,
          signature: 'mock-ml-dsa-44-sig-' + crypto.randomBytes(16).toString('hex'),
          valid: true,
        });
      }

      // 3. Escrow Reveal (Direct Browser Claim)
      if (req.method === 'POST' && u.pathname === '/escrow/reveal') {
        const body = await readJson(req);
        const { escrow_id, unlock_key, kyber_public_key } = body;

        const record = escrows.get(escrow_id);
        if (!record) {
          return sendJson(res, 404, { error: 'Escrow not found' });
        }

        // If secret was already claimed/burned -> HTTP 409
        if (record.claimed) {
          return sendJson(res, 409, {
            error: 'Secret permanently burned (409). Cannot retrieve again.',
            burned: true,
            claimed_at: record.claimed_at,
          });
        }

        // Check timelock embargo -> HTTP 425
        const unlockMs = Date.parse(record.unlock_at);
        if (Date.now() < unlockMs) {
          return sendJson(res, 425, {
            error: 'Time-Locked (425 Too Early)',
            unlock_at: record.unlock_at,
            seconds_remaining: Math.ceil((unlockMs - Date.now()) / 1000),
          });
        }

        // If probe without unlock_key (e.g. initial status check on page load)
        if (!unlock_key) {
          return sendJson(res, 400, {
            error: 'unlock_key is required for reveal',
            unlock_at: record.unlock_at,
          });
        }

        record.attempts += 1;

        // Check PIN / unlock key -> HTTP 403 (Non-burn)
        if (String(unlock_key).trim() !== String(record.unlock_key).trim()) {
          return sendJson(res, 403, {
            error: 'Wrong unlock key (403). Secret NOT burned.',
            remaining_attempts: Math.max(0, 5 - record.attempts),
          });
        }

        // Valid reveal -> burn-on-read!
        record.claimed = true;
        record.claimed_at = new Date().toISOString();

        // Decode stored plaintext payload
        const rawPayload = Buffer.from(record.seal_payload_b64, 'base64').toString('utf8');

        // Cryptographic packaging matching BitBop spec:
        // 1. Generate 32 bytes raw entropy
        const rawEntropy = crypto.randomBytes(32);
        const entropyHex = rawEntropy.toString('hex');

        // 2. Derive envelope key = SHA-256(utf8(entropyHex))
        const envKey = crypto.createHash('sha256').update(entropyHex, 'utf8').digest();
        const envIv = crypto.randomBytes(12);
        const envCipher = crypto.createCipheriv('aes-256-gcm', envKey, envIv);
        const envCt = Buffer.concat([envCipher.update(rawPayload, 'utf8'), envCipher.final(), envCipher.getAuthTag()]);

        // 3. Encapsulate raw entropy with client's ML-KEM-768 public key
        if (!kyber_public_key) {
          return sendJson(res, 400, { error: 'kyber_public_key required' });
        }
        const clientPkBytes = Buffer.from(kyber_public_key, 'hex');
        const [kyberCt, sharedSecret] = await kem.encap(clientPkBytes);

        // 4. Encrypt rawEntropy with AES-256-GCM using raw sharedSecret
        const transitIv = crypto.randomBytes(12);
        const transitCipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(sharedSecret), transitIv);
        const transitCt = Buffer.concat([transitCipher.update(rawEntropy), transitCipher.final(), transitCipher.getAuthTag()]);

        return sendJson(res, 200, {
          cipher: {
            kyber_ciphertext_hex: Buffer.from(kyberCt).toString('hex'),
            aes_iv_hex: transitIv.toString('hex'),
            aes_ciphertext_hex: transitCt.toString('hex'),
          },
          sealed_envelope: {
            iv_hex: envIv.toString('hex'),
            ciphertext_b64: envCt.toString('base64'),
          },
          beacon_sequence: record.beacon_sequence + 1,
          signature: 'mock-ml-dsa-44-sig-' + crypto.randomBytes(16).toString('hex'),
          unlock_at: record.unlock_at,
        });
      }

      // 4. ML-DSA-44 Receipt Verification
      if (req.method === 'POST' && u.pathname === '/verify') {
        const body = await readJson(req);
        return sendJson(res, 200, {
          valid: true,
          beacon_sequence: body.beacon_sequence || 1042,
          signature_scheme: 'ml-dsa-44',
          timestamp: new Date().toISOString(),
        });
      }

      // 5. Test inspection / control endpoints
      if (req.method === 'GET' && u.pathname.startsWith('/test/escrow/')) {
        const id = u.pathname.replace('/test/escrow/', '');
        const record = escrows.get(id);
        if (!record) return sendJson(res, 404, { error: 'not found' });
        return sendJson(res, 200, record);
      }

      if (req.method === 'POST' && u.pathname === '/test/reset') {
        escrows.clear();
        accessLog.length = 0;
        return sendJson(res, 200, { ok: true });
      }

      sendJson(res, 404, { error: 'Mock route not found' });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
  });

  await new Promise((resolve) => server.listen(preferredPort, '127.0.0.1', resolve));
  const address = server.address();
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    server,
    port,
    baseUrl,
    escrows,
    accessLog,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
