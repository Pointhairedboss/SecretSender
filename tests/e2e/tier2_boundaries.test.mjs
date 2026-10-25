import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupTestEnvironment } from './harness.mjs';

describe('Tier 2: Boundary Value Analysis & Edge Cases (Client Envelope v2)', () => {
  let env;

  before(async () => {
    env = await setupTestEnvironment();
  });

  after(async () => {
    await env.cleanup();
  });

  // =========================================================================
  // 1. Client Envelope v2 & Secret Payload Boundaries
  // =========================================================================
  describe('Client Envelope v2 & Secret Payload Boundaries', () => {
    it('B1.1: Plaintext secret field or missing client_envelope is rejected with HTTP 400', async () => {
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '' }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error || '', /Plaintext secrets are not accepted/i);
    });

    it('B1.2: Single-character secret ("x") wrapped in Client Envelope v2 is accepted and decrypted accurately', async () => {
      const singleChar = 'x';
      const { body, linkKeyB64u } = await env.buildShareRequest(singleChar, { unlockKey: 'pin-1111' });
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(shareRes.status, 200);
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();
      const revealRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: crypto.randomUUID(),
          unlock_key: 'pin-1111',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(revealRes.status, 200);
      const revealData = await revealRes.json();
      const recovered = await env.decryptReveal(revealData, kp.secretKey, linkKeyB64u);
      assert.equal(recovered, singleChar);
    });

    it('B1.3: 512-byte secret payload wrapped in Client Envelope v2 is accepted and recovered bit-for-bit', async () => {
      const payload512 = 'A'.repeat(512);
      const { body, linkKeyB64u } = await env.buildShareRequest(payload512, { unlockKey: 'pin-512b' });
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(shareRes.status, 200);
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();
      const revealRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: crypto.randomUUID(),
          unlock_key: 'pin-512b',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(revealRes.status, 200);
      const revealData = await revealRes.json();
      const recovered = await env.decryptReveal(revealData, kp.secretKey, linkKeyB64u);
      assert.equal(recovered, payload512);
    });

    it('B1.4: Oversized ciphertext_b64u (>700 decoded bytes) in client_envelope is rejected with HTTP 400', async () => {
      const { client_envelope } = await env.createClientEnvelope('ValidStart');
      const oversizedCt = Buffer.alloc(750, 0x42)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_envelope: { ...client_envelope, ciphertext_b64u: oversizedCt },
          unlockKey: 'pin-oversize',
        }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error || '', /ciphertext_b64u/i);
    });

    it('B1.5: Malformed client_envelope version or KDF/ALG is rejected with HTTP 400', async () => {
      const { client_envelope } = await env.createClientEnvelope('VersionCheck');
      const res1 = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_envelope: { ...client_envelope, v: 1 },
          unlockKey: 'pin-v1',
        }),
      });
      assert.equal(res1.status, 400);

      const res2 = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_envelope: { ...client_envelope, alg: 'AES-128-CBC' },
          unlockKey: 'pin-alg',
        }),
      });
      assert.equal(res2.status, 400);
    });
  });

  // =========================================================================
  // 2. Embargo & Retention TTL Boundaries
  // =========================================================================
  describe('Embargo & Retention TTL Boundaries', () => {
    it('B2.1: unlockAfterSeconds: 0 yields delaySeconds 0 and immediate reveal', async () => {
      const { body } = await env.buildShareRequest('ImmediateSecret', {
        unlockKey: 'pin-imm',
        unlockAfterSeconds: 0,
      });
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.unlock_after_seconds, 0);
    });

    it('B2.2: Negative unlockAfterSeconds (-50) is rejected with HTTP 400', async () => {
      const { body } = await env.buildShareRequest('NegativeEmbargoSecret', {
        unlockKey: 'pin-neg',
        unlockAfterSeconds: -50,
      });
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 400);
    });

    it('B2.3: Max allowed embargo (6 days = 518400s) is accepted with 7-day retention (604800s)', async () => {
      const { body } = await env.buildShareRequest('MaxEmbargoSecret', {
        unlockKey: 'pin-6days',
        unlockAfterSeconds: 518400,
        ttlSeconds: 604800,
      });
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.unlock_after_seconds, 518400);
      assert.equal(data.ttl_seconds, 604800);
    });

    it('B2.4: Embargo exceeding 6 days (> 518400s) is rejected with HTTP 400', async () => {
      const { body } = await env.buildShareRequest('TooLongEmbargoSecret', {
        unlockKey: 'pin-toolong',
        unlockAfterSeconds: 518401,
      });
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 400);
    });

    it('B2.5: unlockAtIso in the past normalized to 0 delay seconds', async () => {
      const pastIso = new Date(Date.now() - 3600000).toISOString();
      const { body } = await env.buildShareRequest('PastDateSecret', {
        unlockKey: 'pin-past',
        unlockAtIso: pastIso,
      });
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.unlock_after_seconds, 0);
    });

    it('B2.6: Malformed unlockAtIso string is rejected with HTTP 400', async () => {
      const { body } = await env.buildShareRequest('MalformedDateSecret', {
        unlockKey: 'pin-bad-date',
        unlockAtIso: 'INVALID-DATE-STRING-999',
      });
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 400);
    });
  });

  // =========================================================================
  // 3. PIN & Unlock Key Boundaries (Mandatory 4..64 chars)
  // =========================================================================
  describe('PIN & Unlock Key Boundaries', () => {
    it('B3.1: Whitespace-padded unlockKey ("   trim-me   ") is trimmed on server and matches trimmed PIN', async () => {
      const { body, linkKeyB64u } = await env.buildShareRequest('TrimTestSecret', {
        unlockKey: '   trim-me   ',
      });
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 200);
      const shareData = await res.json();

      const kp = await env.generateKeyPair();
      const revealRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: crypto.randomUUID(),
          unlock_key: 'trim-me',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(revealRes.status, 200);
      const revealData = await revealRes.json();
      assert.equal(await env.decryptReveal(revealData, kp.secretKey, linkKeyB64u), 'TrimTestSecret');
    });

    it('B3.2: Special characters in unlockKey (4..64 chars) preserved and matched', async () => {
      const specialPin = '!@#$%^&*()_+~`|}{[]:;?><,./-=';
      const { body, linkKeyB64u } = await env.buildShareRequest('SpecialPinSecret', {
        unlockKey: specialPin,
      });
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(shareRes.status, 200);
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();
      const revealRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: crypto.randomUUID(),
          unlock_key: specialPin,
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(revealRes.status, 200);
      const revealData = await revealRes.json();
      const recovered = await env.decryptReveal(revealData, kp.secretKey, linkKeyB64u);
      assert.equal(recovered, 'SpecialPinSecret');
    });

    it('B3.3: Unicode international characters in unlockKey preserved and verified', async () => {
      const unicodePin = '鍵_パスワード_2026_🔥';
      const { body } = await env.buildShareRequest('UnicodePinSecret', { unlockKey: unicodePin });
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(shareRes.status, 200);
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();
      const revealRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: crypto.randomUUID(),
          unlock_key: unicodePin,
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(revealRes.status, 200);
    });

    it('B3.4: unlockKey exceeding 64 characters is rejected with HTTP 400', async () => {
      const longPin = 'P'.repeat(65);
      const { body } = await env.buildShareRequest('LongPinSecret', { unlockKey: longPin });
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(shareRes.status, 400);
    });
  });

  // =========================================================================
  // 4. Concurrency, Idempotency & Race Condition Boundaries
  // =========================================================================
  describe('Concurrency, Idempotency & Race Condition Boundaries', () => {
    it('B4.1: Concurrent reveal requests with distinct claim_id: exactly one succeeds (200) and one fails (409)', async () => {
      const { body } = await env.buildShareRequest('ConcurrentRaceSecret', { unlockKey: 'race-pin' });
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const shareData = await shareRes.json();

      const kp1 = await env.generateKeyPair();
      const kp2 = await env.generateKeyPair();

      const req1 = env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: crypto.randomUUID(),
          unlock_key: 'race-pin',
          kyber_public_key: kp1.publicKeyHex,
        }),
      });

      const req2 = env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: crypto.randomUUID(),
          unlock_key: 'race-pin',
          kyber_public_key: kp2.publicKeyHex,
        }),
      });

      const [res1, res2] = await Promise.all([req1, req2]);
      const statuses = [res1.status, res2.status].sort();
      assert.deepEqual(statuses, [200, 409], 'Exactly one reveal must succeed with 200 and one must be 409 burned');
    });

    it('B4.2: Commit idempotency_key (share_id) returns identical receipt on retry and 409 on mismatched envelope', async () => {
      const { body, client_envelope } = await env.buildShareRequest('IdempotentCommitSecret', {
        unlockKey: 'idem-pin',
      });
      const res1 = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(res1.status, 200);
      const data1 = await res1.json();

      // Exact retry with same client_envelope
      const res2 = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(res2.status, 200);
      const data2 = await res2.json();
      assert.equal(data2.escrow_id, data1.escrow_id);

      // Mismatched envelope with same share_id -> 409 Conflict
      const { client_envelope: otherEnv } = await env.createClientEnvelope('DifferentPayload');
      const conflictRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_envelope: { ...otherEnv, share_id: client_envelope.share_id },
          unlockKey: 'idem-pin',
        }),
      });
      assert.equal(conflictRes.status, 409);
    });
  });

  // =========================================================================
  // 5. Host, Path Traversal & HTTP Method Guards
  // =========================================================================
  describe('Host, Path Traversal & HTTP Method Guards', () => {
    it('B5.1: 127.0.0.1 host header normalized to localhost in base_claim_url for W3C Secure Context compatibility', async () => {
      const { body } = await env.buildShareRequest('SecureContextSecret', { unlockKey: 'pin-host' });
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: `127.0.0.1:${env.appPort}`,
        },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(
        data.base_claim_url.includes('localhost'),
        `base_claim_url (${data.base_claim_url}) should use localhost to ensure W3C Secure Context`,
      );
    });

    it('B5.2: Path traversal attempts (%2e%2e, .., %5c) are rejected with HTTP 403 Forbidden', async () => {
      const r1 = await env.fetchApp('/%2e%2e/package.json');
      assert.equal(r1.status, 403);
      const r2 = await env.fetchApp('/assets/%5c../worker/index.mjs');
      assert.equal(r2.status, 403);
    });

    it('B5.3: Unsupported HTTP methods on static and API routes return HTTP 405 Method Not Allowed', async () => {
      const r1 = await env.fetchApp('/', { method: 'DELETE' });
      assert.equal(r1.status, 405);
      const r2 = await env.fetchApp('/api/share', { method: 'GET' });
      assert.equal(r2.status, 405);
    });
  });
});
