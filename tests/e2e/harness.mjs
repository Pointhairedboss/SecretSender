import { spawn } from 'node:child_process';
import net from 'node:net';
import crypto from 'node:crypto';
import { MlKem768 } from 'mlkem';
import { createMockBitBopServer } from './mock_bitbop_server.mjs';

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

/**
 * Manages the full test environment lifecycle:
 * - Mock BitBop API server
 * - SecretSender application server process
 * - Client cryptographic helpers
 */
export async function setupTestEnvironment(customEnv = {}) {
  const mockServer = await createMockBitBopServer();
  const appPort = await getFreePort();

  const env = {
    ...process.env,
    PORT: String(appPort),
    HOST: '127.0.0.1',
    BITBOP_API_BASE: customEnv.BITBOP_API_BASE || mockServer.baseUrl,
    BITBOP_API_KEY: 'test-e2e-api-key',
    PUBLIC_ORIGIN: `http://localhost:${appPort}`,
    ...customEnv,
  };

  const appLogs = [];
  const appProcess = spawn(process.execPath, ['server.mjs'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  appProcess.stdout.on('data', (d) => appLogs.push({ type: 'stdout', text: d.toString() }));
  appProcess.stderr.on('data', (d) => appLogs.push({ type: 'stderr', text: d.toString() }));

  const appUrl = `http://127.0.0.1:${appPort}`;

  // Wait for health endpoint
  const startTime = Date.now();
  let healthy = false;
  while (Date.now() - startTime < 8000) {
    try {
      const res = await fetch(`${appUrl}/health`);
      if (res.ok) {
        healthy = true;
        break;
      }
    } catch (_) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  if (!healthy) {
    appProcess.kill();
    await mockServer.close();
    throw new Error(`SecretSender server failed to start within 8000ms. Logs: ${JSON.stringify(appLogs)}`);
  }

  const kem = new MlKem768();

  return {
    appPort,
    appUrl,
    mockServer,
    mockUrl: mockServer.baseUrl,
    appProcess,
    appLogs,
    kem,

    // Helper: generate ML-KEM-768 keypair
    async generateKeyPair() {
      const kp = await kem.generateKeyPair();
      return {
        publicKey: kp[0],
        secretKey: kp[1],
        publicKeyHex: Buffer.from(kp[0]).toString('hex'),
      };
    },

    // Helper: client-side ML-KEM-768 + WebCrypto AES-GCM decryption
    async decryptReveal(revealData, secretKeyBytes) {
      const kyberCt = Buffer.from(revealData.cipher.kyber_ciphertext_hex, 'hex');
      const sharedSecret = await kem.decap(kyberCt, secretKeyBytes);

      const transitKey = await crypto.webcrypto.subtle.importKey(
        'raw',
        sharedSecret,
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );
      const transitIv = Buffer.from(revealData.cipher.aes_iv_hex, 'hex');
      const transitCt = Buffer.from(revealData.cipher.aes_ciphertext_hex, 'hex');
      const rawEntropyBuf = await crypto.webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: transitIv },
        transitKey,
        transitCt
      );
      const entropyHex = Buffer.from(rawEntropyBuf).toString('hex');

      const envKeyDigest = await crypto.webcrypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(entropyHex)
      );
      const envKey = await crypto.webcrypto.subtle.importKey(
        'raw',
        envKeyDigest,
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );
      const envIv = Buffer.from(revealData.sealed_envelope.iv_hex, 'hex');
      const envCt = Buffer.from(revealData.sealed_envelope.ciphertext_b64, 'base64');
      const plainBuf = await crypto.webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: envIv },
        envKey,
        envCt
      );
      return new TextDecoder().decode(plainBuf);
    },

    // Helper: fetch app route
    fetchApp(path, init = {}) {
      return fetch(`${appUrl}${path}`, init);
    },

    // Helper: fetch mock BitBop route
    fetchMock(path, init = {}) {
      return fetch(`${mockServer.baseUrl}${path}`, init);
    },

    // Teardown
    async cleanup() {
      try {
        appProcess.kill();
      } catch (_) {}
      await mockServer.close();
    },
  };
}
