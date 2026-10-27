import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupTestEnvironment } from './harness.mjs';

describe('Tier 1: Core Feature Coverage (Client Envelope v2 & Worker Runtime)', () => {
  let env;

  before(async () => {
    env = await setupTestEnvironment();
  });

  after(async () => {
    await env.cleanup();
  });

  // =========================================================================
  // Core Feature 1: Static Asset Delivery, Security Headers & HTTP Routing
  // =========================================================================
  describe('Feature 1: Static Asset Delivery, Security Headers & HTTP Routing', () => {
    it('1.1: GET / returns HTTP 200 with text/html, CSP, nosniff, no-referrer, and no-store', async () => {
      const res = await env.fetchApp('/');
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /text\/html;\s*charset=utf-8/i);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.match(res.headers.get('content-security-policy') || '', /default-src 'self'/i);
      const text = await res.text();
      assert.match(text, /<!DOCTYPE html>/i);
      assert.match(text, /SecretSender/i);
    });

    it('1.2: GET /mlkem.browser.js returns HTTP 200 with MlKem768 and ML-DSA-44 verification bundle', async () => {
      const res = await env.fetchApp('/mlkem.browser.js');
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /application\/javascript;\s*charset=utf-8/i);
      assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
      const text = await res.text();
      assert.ok(text.length > 5000, 'mlkem.browser.js should not be empty');
      assert.match(text, /MlKem768/i);
      assert.match(text, /verifyReceiptSignature/i);
      assert.match(text, /mldsa44-release-2026-01/i);
    });

    it('1.3: GET /health returns HTTP 200 with json MIME type and secretsender-v2 profile', async () => {
      const res = await env.fetchApp('/health');
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /application\/json;\s*charset=utf-8/i);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.equal(data.service, 'SecretSender');
      assert.equal(data.profile, 'secretsender-v2');
    });

    it('1.4: Non-existent route GET /does-not-exist returns HTTP 404', async () => {
      const res = await env.fetchApp('/does-not-exist-' + Date.now());
      assert.equal(res.status, 404);
    });

    it('1.5: Static SVG brand asset contract verification', async () => {
      const resFavicon = await env.fetchApp('/favicon.svg');
      assert.ok(resFavicon.status === 200 || resFavicon.status === 404);
      if (resFavicon.status === 200) {
        assert.match(resFavicon.headers.get('content-type') || '', /image\/svg\+xml/i);
      }
    });

    it('1.6: GET / with query parameters preserves 200 response and serves claim view + membership panel', async () => {
      const res = await env.fetchApp('/?escrow_id=test-escrow-12345');
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.match(text, /id="claim-view"/);
      assert.match(text, /id="admin-view"/);
      assert.match(text, /id="membership-panel"/);
    });
  });

  // =========================================================================
  // Core Feature 2: Brand Styles, Livery Tokens & Viewport Meta
  // =========================================================================
  describe('Feature 2: Brand Styles, Livery Tokens & Responsive Viewport', () => {
    let pageHtml;

    before(async () => {
      const res = await env.fetchApp('/');
      pageHtml = await res.text();
    });

    it('2.1: Viewport meta tag is present with standard mobile scaling directives', () => {
      assert.match(pageHtml, /<meta\s+name=["']viewport["']\s+content=["'][^"']*width=device-width[^"']*initial-scale=1/i);
    });

    it('2.2: Universal box-sizing border-box declared to prevent viewport overflow', () => {
      assert.match(pageHtml, /\*\s*\{\s*box-sizing:\s*border-box;?\s*\}/i);
    });

    it('2.3: Mobile container width constraints present (max-width <= 500px)', () => {
      assert.match(pageHtml, /max-width:\s*(?:480|500)px/i);
    });

    it('2.4: Dark surface palette tokens present (#0F1012, #0B0C0E, #14161B, #16181D, #262932)', () => {
      const hasBaseDark = /#0[bB]0[cC]0[eE]|#0[fF]1012/i.test(pageHtml);
      const hasContainerDark = /#14161[bB]|#16181[dD]|#1[bB]1[eE]24/i.test(pageHtml);
      const hasBorderDark = /#262932|#1[eE]2028/i.test(pageHtml);
      assert.ok(hasBaseDark, 'HTML must contain dark base surface color');
      assert.ok(hasContainerDark, 'HTML must contain container surface color');
      assert.ok(hasBorderDark, 'HTML must contain border outline color');
    });

    it('2.5: Action and telemetry color tokens present in styling', () => {
      const hasTelemetryOrGold = /#FFD600|#10B981/i.test(pageHtml);
      assert.ok(hasTelemetryOrGold, 'HTML must declare primary gold or emerald telemetry tokens');
    });

    it('2.6: Separate selector classes for embargo presets (.preset-btn) and retention TTL (.retention-btn)', () => {
      assert.match(pageHtml, /class="preset-btn/);
      assert.match(pageHtml, /class="retention-btn/);
    });
  });

  // =========================================================================
  // Core Feature 3: Client Envelope v2 Sealing API (POST /api/share)
  // =========================================================================
  describe('Feature 3: Client Envelope v2 Sealing API (POST /api/share)', () => {
    it('3.1: Valid Client Envelope v2 + mandatory PIN returns HTTP 200 with verified ML-DSA-44 receipt', async () => {
      const { body } = await env.buildShareRequest('SuperSecretKey99', { unlockKey: 'pin-9988' });
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.escrow_id, 'Must return escrow_id');
      assert.equal(data.share_id, body.client_envelope.share_id);
      assert.ok(data.base_claim_url, 'Must return base_claim_url');
      assert.equal(data.unlock_key, undefined, 'Worker must not echo unlock_key');
      assert.ok(data.commit_receipt, 'Must return commit_receipt');
      assert.equal(data.commit_verified, true, 'Commit receipt must be verified');
      assert.equal(data.commit_verification.local_mldsa44_valid, true);
    });

    it('3.2: Plaintext password/secret field in POST /api/share is strictly rejected with HTTP 400', async () => {
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'PlaintextMustBeRejected', unlockKey: 'pin-1234' }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error || '', /Plaintext secrets are not accepted/i);
    });

    it('3.3: Omitted or short (<4 char) unlockKey is rejected with HTTP 400 (mandatory PIN)', async () => {
      const { client_envelope } = await env.createClientEnvelope('SecretWithoutPin');
      const res1 = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_envelope }),
      });
      assert.equal(res1.status, 400);

      const res2 = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_envelope, unlockKey: '123' }),
      });
      assert.equal(res2.status, 400);
    });

    it('3.4: Unauthenticated POST /api/share (missing Authorization Bearer token) returns HTTP 401', async () => {
      const { body } = await env.buildShareRequest('NeedsAuthSecret', { unlockKey: 'pin-4455' });
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        omitAuth: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.match(data.error || '', /Sender API key required/i);
    });

    it('3.5: Context hash binds to canonical Client Envelope v2 SHA-256 and never leaks plaintext', async () => {
      const secret = 'TOP_SECRET_DO_NOT_LEAK_ENTROPY';
      const { body } = await env.buildShareRequest(secret, { unlockKey: 'pin-ctx-1' });
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      const contextHash = data.commit_receipt.context_hash || '';
      assert.ok(!contextHash.includes(secret), 'context_hash must not contain plaintext secret');
      assert.match(contextHash, /^sha256:[0-9a-f]{64}$/i);
    });

    it('3.6: base_claim_url carries only ?escrow_id=... without link_key or unlock_key', async () => {
      const { body, linkKeyB64u } = await env.buildShareRequest('UrlCheckSecret', { unlockKey: 'pin-url-1' });
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      const u = new URL(data.base_claim_url);
      assert.equal(u.searchParams.get('escrow_id'), data.escrow_id);
      assert.equal(u.searchParams.get('unlock_key'), null);
      assert.equal(u.hash, '', 'Server base_claim_url must not contain #link_key fragment');
      assert.ok(!JSON.stringify(data).includes(linkKeyB64u), 'Server response must never contain linkKeyB64u');
    });
  });

  // =========================================================================
  // Core Feature 4: Claim Flow, Status Precheck & Two-Layer Decryption
  // =========================================================================
  describe('Feature 4: Claim Flow, Status Precheck & Two-Layer Decryption', () => {
    it('4.1: ML-KEM-768 keypair generation produces correct key sizes (1184 public, 2400 secret)', async () => {
      const kp = await env.generateKeyPair();
      assert.equal(kp.publicKey.length, 1184);
      assert.equal(kp.secretKey.length, 2400);
      assert.equal(kp.publicKeyHex.length, 2368);
    });

    it('4.2: Non-consuming GET /api/escrow/status returns secretsender-v2 profile and requires_unlock_key', async () => {
      const { body } = await env.buildShareRequest('StatusProbeSecret', { unlockKey: 'pin-status' });
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const shareData = await shareRes.json();

      const statusRes = await env.fetchApp(`/api/escrow/status?escrow_id=${encodeURIComponent(shareData.escrow_id)}`);
      assert.equal(statusRes.status, 200);
      const statusData = await statusRes.json();
      assert.equal(statusData.escrow_profile, 'secretsender-v2');
      assert.equal(statusData.requires_unlock_key, true);
      assert.equal(statusData.state, 'ready');
      assert.equal(statusData.burned, false);
    });

    it('4.3: Two-layer decryption (ML-KEM-768 outer + HKDF/AES-256-GCM inner) recovers original secret', async () => {
      const secret = 'Exact-Secret-Match-12345!@#$%^&*()_+';
      const { body, linkKeyB64u } = await env.buildShareRequest(secret, { unlockKey: 'pin-decrypt-test' });
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();
      const revealRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: crypto.randomUUID(),
          unlock_key: 'pin-decrypt-test',
          kyber_public_key: kp.publicKeyHex,
          signature_scheme: 'ml-dsa-44',
        }),
      });
      assert.equal(revealRes.status, 200);
      const revealData = await revealRes.json();

      const recovered = await env.decryptReveal(revealData, kp.secretKey, linkKeyB64u);
      assert.equal(recovered, secret, 'Two-layer decrypted secret must match original secret exactly');
    });

    it('4.4: 5-minute claim_id retry idempotency returns cached ciphertext for identical (claim_id, kyber_public_key)', async () => {
      const secret = 'IdempotentRetrySecret';
      const { body, linkKeyB64u } = await env.buildShareRequest(secret, { unlockKey: 'retry-pin' });
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();
      const claimId = crypto.randomUUID();

      const firstRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: claimId,
          unlock_key: 'retry-pin',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(firstRes.status, 200);
      const firstData = await firstRes.json();

      // Retry with same claim_id and kyber_public_key -> 200 cached response
      const retryRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: claimId,
          unlock_key: 'retry-pin',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(retryRes.status, 200);
      const retryData = await retryRes.json();
      assert.equal(retryData.cipher.kyber_ciphertext_hex, firstData.cipher.kyber_ciphertext_hex);
      const recovered = await env.decryptReveal(retryData, kp.secretKey, linkKeyB64u);
      assert.equal(recovered, secret);
    });

    it('4.5: ML-DSA-44 post-quantum provenance verification succeeds and detects tampering', async () => {
      const { body } = await env.buildShareRequest('ProvenanceSecret', { unlockKey: 'prov-pin' });
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();
      const revealRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: crypto.randomUUID(),
          unlock_key: 'prov-pin',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      const revealData = await revealRes.json();

      const verifyRes = await env.fetchApp('/api/escrow/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(revealData),
      });
      const verifyData = await verifyRes.json();
      assert.equal(verifyRes.status, 200);
      assert.equal(verifyData.valid, true);
      assert.equal(verifyData.local_mldsa44_valid, true);

      // Tamper with beacon_sequence -> verification must fail
      const tampered = { ...revealData, beacon_sequence: 123456 };
      const tamperedRes = await env.fetchApp('/api/escrow/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tampered),
      });
      const tamperedData = await tamperedRes.json();
      assert.equal(tamperedData.valid, false);
    });
  });

  // =========================================================================
  // Core Feature 5: Error Codes & Security Invariants
  // =========================================================================
  describe('Feature 5: Error Codes & Security Invariants', () => {
    it('5.1: Missing client_envelope in POST /api/share returns HTTP 400', async () => {
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error || '', /client_envelope/i);
    });

    it('5.2: Malformed JSON body in POST /api/share returns HTTP 400', async () => {
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid-json-content{{{',
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error, 'Must report error');
    });

    it('5.3: Wrong PIN attempt against /escrow/reveal returns HTTP 403 without burning secret', async () => {
      const { body, linkKeyB64u } = await env.buildShareRequest('SecretNonBurnCheck', { unlockKey: 'correct-pin' });
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();

      const wrongRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: crypto.randomUUID(),
          unlock_key: 'wrong-pin-guess',
          kyber_public_key: kp.publicKeyHex,
        }),
      });

      assert.equal(wrongRes.status, 403);
      const wrongData = await wrongRes.json();
      assert.match(wrongData.error || '', /Wrong unlock key/i);

      const correctRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: crypto.randomUUID(),
          unlock_key: 'correct-pin',
          kyber_public_key: kp.publicKeyHex,
        }),
      });

      assert.equal(correctRes.status, 200, 'Secret must not be burned after wrong PIN');
      const correctData = await correctRes.json();
      const plaintext = await env.decryptReveal(correctData, kp.secretKey, linkKeyB64u);
      assert.equal(plaintext, 'SecretNonBurnCheck');
    });

    it('5.4: Successful reveal permanently burns secret; second distinct claim_id returns HTTP 409', async () => {
      const { body } = await env.buildShareRequest('BurnOnceSecret', { unlockKey: 'burn-pin' });
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();

      const firstRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: crypto.randomUUID(),
          unlock_key: 'burn-pin',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(firstRes.status, 200);

      const secondRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: crypto.randomUUID(),
          unlock_key: 'burn-pin',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(secondRes.status, 409);
      const secondData = await secondRes.json();
      assert.match(secondData.error || '', /burned/i);
    });

    it('5.5: Non-existent escrow ID against /escrow/reveal returns HTTP 404', async () => {
      const kp = await env.generateKeyPair();
      const res = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: 'non-existent-escrow-' + Date.now(),
          claim_id: crypto.randomUUID(),
          unlock_key: 'pin-1234',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(res.status, 404);
    });

    it('5.6: Timelocked secret queried before embargo returns HTTP 425 Too Early', async () => {
      const { body } = await env.buildShareRequest('EmbargoSecret', {
        unlockKey: 'embargo-pin',
        unlockAfterSeconds: 3600,
      });
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();
      const revealRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          claim_id: crypto.randomUUID(),
          unlock_key: 'embargo-pin',
          kyber_public_key: kp.publicKeyHex,
        }),
      });

      assert.equal(revealRes.status, 425);
      const data = await revealRes.json();
      assert.match(data.error || '', /Time-Locked/i);
      assert.ok(data.unlock_at, 'Must return unlock_at date');
    });
  });
});
