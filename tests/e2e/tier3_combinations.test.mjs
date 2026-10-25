import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupTestEnvironment } from './harness.mjs';

describe('Tier 3: Cross-Feature Pairwise Combinations (Client Envelope v2)', () => {
  let env;

  before(async () => {
    env = await setupTestEnvironment();
  });

  after(async () => {
    await env.cleanup();
  });

  // =========================================================================
  // 1. Pairwise: Timelock Embargo + Wrong PIN Interaction
  // =========================================================================
  describe('Pairwise: Timelock Embargo + Wrong PIN', () => {
    it('C1.1: Premature claim attempt with wrong PIN triggers HTTP 425 Too Early before PIN check', async () => {
      const { body } = await env.buildShareRequest('SecretUnderEmbargo1', {
        unlockKey: 'correct-embargo-pin',
        unlockAfterSeconds: 3600,
      });
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(shareRes.status, 200);
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();

      const prematureRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: crypto.randomUUID(),
          unlock_key: 'attacker-wrong-guess',
          kyber_public_key: kp.publicKeyHex,
        }),
      });

      assert.equal(prematureRes.status, 425);
      const data = await prematureRes.json();
      assert.ok(data.unlock_at);
      assert.match(data.error || '', /Time-Locked/i);
    });

    it('C1.2: Premature wrong PIN attempt does not burn or corrupt secret state', async () => {
      const { body } = await env.buildShareRequest('PreservedStateSecret', {
        unlockKey: 'my-pin-state',
        unlockAfterSeconds: 60,
      });
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();
      await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: crypto.randomUUID(),
          unlock_key: 'wrong-guess',
          kyber_public_key: kp.publicKeyHex,
        }),
      });

      const inspectRes = await env.fetchUpstream(`/test/escrow/${shareData.escrow_id}`);
      assert.equal(inspectRes.status, 200);
      const escrowRecord = await inspectRes.json();
      assert.equal(escrowRecord.claimed, false);
      assert.equal(escrowRecord.claimed_at, null);
      assert.equal(escrowRecord.escrow_profile, 'secretsender-v2');
      assert.equal(escrowRecord.requires_unlock_key, true);
    });
  });

  // =========================================================================
  // 2. Pairwise: Timelock Embargo + Valid Claim Lifecycle
  // =========================================================================
  describe('Pairwise: Timelock Embargo + Valid Claim Lifecycle', () => {
    it('C2.1: Secret with short embargo transitions from 425 to 200 reveal upon expiry', async () => {
      const secretContent = 'Time-Released-Quantum-Payload-2026';
      const { body, linkKeyB64u } = await env.buildShareRequest(secretContent, {
        unlockKey: 'valid-pin-999',
        unlockAfterSeconds: 1,
      });
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(shareRes.status, 200);
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();

      const earlyRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: crypto.randomUUID(),
          unlock_key: 'valid-pin-999',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(earlyRes.status, 425);

      await new Promise((r) => setTimeout(r, 1200));

      const expiredRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: crypto.randomUUID(),
          unlock_key: 'valid-pin-999',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(expiredRes.status, 200);
      const revealData = await expiredRes.json();

      const decrypted = await env.decryptReveal(revealData, kp.secretKey, linkKeyB64u);
      assert.equal(decrypted, secretContent);

      const burnedRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: crypto.randomUUID(),
          unlock_key: 'valid-pin-999',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(burnedRes.status, 409);
    });
  });

  // =========================================================================
  // 3. Pairwise: Free Key Minting + Key Status + Mobile Viewport Constraints
  // =========================================================================
  describe('Pairwise: Free Key Minting + Key Status + Mobile Viewport Constraints', () => {
    it('C3.1: POST /api/keys/free mints encrypted free key and GET /api/key-status returns tier limits', async () => {
      const kp = await env.generateKeyPair();
      const mintRes = await env.fetchApp('/api/keys/free', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kyber_public_key: kp.publicKeyHex,
          signature_scheme: 'ml-dsa-44',
        }),
      });
      assert.equal(mintRes.status, 200);
      const mintData = await mintRes.json();
      assert.equal(mintData.tier, 'free');
      assert.ok(mintData.cipher?.kyber_ciphertext_hex);

      // Decrypt minted key
      const sharedSecret = await env.kem.decap(
        Buffer.from(mintData.cipher.kyber_ciphertext_hex, 'hex'),
        kp.secretKey,
      );
      const aesKey = await crypto.webcrypto.subtle.importKey(
        'raw',
        sharedSecret,
        { name: 'AES-GCM' },
        false,
        ['decrypt'],
      );
      const plainBuf = await crypto.webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: Buffer.from(mintData.cipher.aes_iv_hex, 'hex') },
        aesKey,
        Buffer.from(mintData.cipher.aes_ciphertext_hex, 'hex'),
      );
      const mintedKey = new TextDecoder().decode(plainBuf).trim();
      assert.match(mintedKey, /^bb_free_/);

      // Query /api/key-status with the newly minted key
      const statusRes = await env.fetchApp('/api/key-status', {
        method: 'GET',
        headers: { Authorization: `Bearer ${mintedKey}` },
      });
      assert.equal(statusRes.status, 200);
      const statusData = await statusRes.json();
      assert.equal(statusData.valid, true);
      assert.equal(statusData.tier, 'free');
    });

    it('C3.2: HTML styles contain CSS wrapping directives and QR max-width to prevent mobile overflow', async () => {
      const res = await env.fetchApp('/');
      const html = await res.text();
      const hasWordBreak = /word-break:\s*break-all|overflow-wrap:\s*anywhere|overflow-wrap:\s*break-word/i.test(html);
      assert.ok(hasWordBreak, 'HTML/CSS must define word-break or overflow-wrap');
      assert.match(html, /\.qr-wrap\s+svg\s*\{[^}]*max-width:\s*100%/i);
    });

    it('C3.3: Claim view has hidden style by default when no escrow_id is present in query', async () => {
      const res = await env.fetchApp('/');
      const html = await res.text();
      assert.match(html, /id="claim-view"[^>]*style="[^"]*display:\s*none/i);
    });
  });

  // =========================================================================
  // 4. Pairwise: Custom PIN + Max Embargo + Unicode Secret Payload
  // =========================================================================
  describe('Pairwise: Custom PIN + Max Embargo + Multi-byte International Payload', () => {
    it('C4.1: Multi-language UTF-8 secret sealed with 5-day embargo and international PIN', async () => {
      const internationalSecret = '🔒 秘密の暗号 2026: مرحبا بالعالم — Привет мир — 100% Post-Quantum';
      const internationalPin = 'PIN-日本-888';
      const futureIso = new Date(Date.now() + 86400 * 5 * 1000).toISOString(); // 5 days

      const { body, linkKeyB64u } = await env.buildShareRequest(internationalSecret, {
        unlockKey: internationalPin,
        unlockAtIso: futureIso,
        ttlSeconds: 604800,
      });

      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      assert.equal(shareRes.status, 200);
      const shareData = await shareRes.json();
      assert.ok(shareData.unlock_after_seconds > 86400 * 4);
      assert.equal(shareData.commit_verified, true);
      assert.equal(linkKeyB64u.length, 43);
    });
  });

  // =========================================================================
  // 5. Pairwise: Flight Recorder Seam & Redaction Invariants (T10)
  // =========================================================================
  describe('Pairwise: Flight Recorder Seam & Redaction Invariants (T10)', () => {
    it('C5.1: HTML includes UAT flight recorder hooks with strict secret/PIN/fragment redaction', async () => {
      const res = await env.fetchApp('/?uat=1');
      assert.equal(res.status, 200);
      const html = await res.text();

      assert.ok(html.includes('__uatRecorder'), 'Must include __uatRecorder');
      assert.ok(html.includes('redactUrlString'), 'Must redact #link_key fragments in UAT logs');
      assert.ok(html.includes('REDACTED_IDS'), 'Must redact #secret, #pin, #unlock, #pw-display, #api-key-input');
      assert.ok(html.includes('attestation-scope-notice'), 'Must include truthful attestation scope notice (T14)');
      assert.ok(html.includes('post-reveal-cta'), 'Must include restrained post-reveal CTA (T17)');
    });
  });
});
