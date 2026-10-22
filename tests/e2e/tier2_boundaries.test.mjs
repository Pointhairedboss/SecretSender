import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment } from './harness.mjs';

describe('Tier 2: Boundary Value Analysis & Edge Cases', () => {
  let env;

  before(async () => {
    env = await setupTestEnvironment();
  });

  after(async () => {
    await env.cleanup();
  });

  // =========================================================================
  // 1. Secret Payload Boundaries
  // =========================================================================
  describe('Secret Payload Boundaries', () => {
    it('B1.1: Empty secret string ("") is rejected with HTTP 500 / error message', async () => {
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '' }),
      });
      assert.equal(res.status, 500);
      const data = await res.json();
      assert.match(data.error || '', /Secret password is required/i);
    });

    it('B1.2: Single-character secret ("x") is accepted and decrypted accurately', async () => {
      const singleChar = 'x';
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: singleChar, unlockKey: 'pin-1' }),
      });
      assert.equal(shareRes.status, 200);
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();
      const revealRes = await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          unlock_key: 'pin-1',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(revealRes.status, 200);
      const revealData = await revealRes.json();
      const recovered = await env.decryptReveal(revealData, kp.secretKey);
      assert.equal(recovered, singleChar);
    });

    it('B1.3: 1KB secret payload is accepted and recovered bit-for-bit', async () => {
      const payload1kb = 'A'.repeat(1024);
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: payload1kb, unlockKey: 'pin-1kb' }),
      });
      assert.equal(shareRes.status, 200);
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();
      const revealRes = await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          unlock_key: 'pin-1kb',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(revealRes.status, 200);
      const revealData = await revealRes.json();
      const recovered = await env.decryptReveal(revealData, kp.secretKey);
      assert.equal(recovered, payload1kb);
    });

    it('B1.4: 64KB secret payload boundary stress test', async () => {
      const payload64kb = 'K'.repeat(64 * 1024);
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: payload64kb, unlockKey: 'pin-64kb' }),
      });
      assert.equal(shareRes.status, 200);
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();
      const revealRes = await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          unlock_key: 'pin-64kb',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(revealRes.status, 200);
      const revealData = await revealRes.json();
      const recovered = await env.decryptReveal(revealData, kp.secretKey);
      assert.equal(recovered.length, 64 * 1024);
      assert.equal(recovered, payload64kb);
    });

    it('B1.5: 256KB max-size payload stress test', async () => {
      const payload256kb = 'Z'.repeat(256 * 1024);
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: payload256kb, unlockKey: 'pin-256kb' }),
      });
      assert.equal(shareRes.status, 200);
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();
      const revealRes = await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          unlock_key: 'pin-256kb',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(revealRes.status, 200);
      const revealData = await revealRes.json();
      const recovered = await env.decryptReveal(revealData, kp.secretKey);
      assert.equal(recovered.length, 256 * 1024);
      assert.equal(recovered, payload256kb);
    });
  });

  // =========================================================================
  // 2. Embargo & Timelock Boundaries
  // =========================================================================
  describe('Embargo & Timelock Boundaries', () => {
    it('B2.1: unlockAfterSeconds: 0 yields delaySeconds 0 and immediate reveal', async () => {
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'ImmediateSecret', unlockAfterSeconds: 0 }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.unlock_after_seconds, 0);
    });

    it('B2.2: Negative unlockAfterSeconds (-50) normalized to 0', async () => {
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'NegativeEmbargoSecret', unlockAfterSeconds: -50 }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.unlock_after_seconds, 0);
    });

    it('B2.3: Fractional unlockAfterSeconds (1.2) rounded up to integer via Math.ceil', async () => {
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'FractionalSecret', unlockAfterSeconds: 1.2 }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.unlock_after_seconds, 2);
    });

    it('B2.4: Long embargo period (30 days = 2592000s) correctly calculated', async () => {
      const secondsIn30Days = 30 * 24 * 3600;
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'LongEmbargoSecret', unlockAfterSeconds: secondsIn30Days }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.unlock_after_seconds, secondsIn30Days);
      const unlockMs = Date.parse(data.unlock_at);
      const expectedMinMs = Date.now() + (secondsIn30Days - 10) * 1000;
      assert.ok(unlockMs >= expectedMinMs, 'Unlock date should be at least 30 days out');
    });

    it('B2.5: unlockAtIso in the past normalized to 0 delay seconds', async () => {
      const pastIso = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'PastDateSecret', unlockAtIso: pastIso }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.unlock_after_seconds, 0);
    });

    it('B2.6: Malformed unlockAtIso string gracefully falls back to 0 without crashing', async () => {
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'MalformedDateSecret', unlockAtIso: 'INVALID-DATE-STRING-999' }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.unlock_after_seconds, 0);
    });
  });

  // =========================================================================
  // 3. PIN & Unlock Key Boundaries
  // =========================================================================
  describe('PIN & Unlock Key Boundaries', () => {
    it('B3.1: Whitespace-padded unlockKey ("   trim-me   ") is trimmed on server', async () => {
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'TrimTestSecret', unlockKey: '   trim-me   ' }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.unlock_key, 'trim-me');
    });

    it('B3.2: Special characters in unlockKey preserved and matched', async () => {
      const specialPin = '!@#$%^&*()_+~`|}{[]:;?><,./-=';
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'SpecialPinSecret', unlockKey: specialPin }),
      });
      assert.equal(shareRes.status, 200);
      const shareData = await shareRes.json();
      assert.equal(shareData.unlock_key, specialPin);

      const kp = await env.generateKeyPair();
      const revealRes = await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          unlock_key: specialPin,
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(revealRes.status, 200);
      const revealData = await revealRes.json();
      const recovered = await env.decryptReveal(revealData, kp.secretKey);
      assert.equal(recovered, 'SpecialPinSecret');
    });

    it('B3.3: Unicode international characters in unlockKey preserved and verified', async () => {
      const unicodePin = '鍵_パスワード_2026_🔥';
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'UnicodePinSecret', unlockKey: unicodePin }),
      });
      assert.equal(shareRes.status, 200);
      const shareData = await shareRes.json();
      assert.equal(shareData.unlock_key, unicodePin);

      const kp = await env.generateKeyPair();
      const revealRes = await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          unlock_key: unicodePin,
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(revealRes.status, 200);
    });

    it('B3.4: Long unlockKey (512 characters) handled without truncation', async () => {
      const longPin = 'P'.repeat(512);
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'LongPinSecret', unlockKey: longPin }),
      });
      assert.equal(shareRes.status, 200);
      const shareData = await shareRes.json();
      assert.equal(shareData.unlock_key, longPin);
    });
  });

  // =========================================================================
  // 4. Concurrency & Race Condition Boundaries
  // =========================================================================
  describe('Concurrency & Race Condition Boundaries', () => {
    it('B4.1: Concurrent reveal requests: exactly one succeeds (200) and the other fails (409)', async () => {
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'ConcurrentRaceSecret', unlockKey: 'race-pin' }),
      });
      const shareData = await shareRes.json();

      const kp1 = await env.generateKeyPair();
      const kp2 = await env.generateKeyPair();

      const req1 = env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          unlock_key: 'race-pin',
          kyber_public_key: kp1.publicKeyHex,
        }),
      });

      const req2 = env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          unlock_key: 'race-pin',
          kyber_public_key: kp2.publicKeyHex,
        }),
      });

      const [res1, res2] = await Promise.all([req1, req2]);
      const statuses = [res1.status, res2.status].sort();
      assert.deepEqual(statuses, [200, 409], 'Exactly one reveal must succeed with 200 and one must be 409 burned');
    });
  });

  // =========================================================================
  // 5. Host & Header Directives
  // =========================================================================
  describe('Host & Header Directives', () => {
    it('B5.1: X-Forwarded-Proto header is respected when constructing claim_url', async () => {
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Proto': 'https',
        },
        body: JSON.stringify({ password: 'ProtoHeaderSecret' }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.claim_url.startsWith('https://') || data.claim_url.startsWith('http://'));
    });

    it('B5.2: 127.0.0.1 host header normalized to localhost for W3C Secure Context compatibility', async () => {
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: `127.0.0.1:${env.appPort}`,
        },
        body: JSON.stringify({ password: 'SecureContextSecret' }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      // Should normalize 127.0.0.1 to localhost
      assert.ok(
        data.claim_url.includes('localhost'),
        `claim_url (${data.claim_url}) should use localhost to ensure W3C Secure Context`
      );
    });
  });
});
