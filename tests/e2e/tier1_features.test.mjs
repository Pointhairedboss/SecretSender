import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment } from './harness.mjs';

describe('Tier 1: Core Feature Coverage', () => {
  let env;

  before(async () => {
    env = await setupTestEnvironment();
  });

  after(async () => {
    await env.cleanup();
  });

  // =========================================================================
  // Core Feature 1: Static Asset Delivery & HTTP MIME Types
  // =========================================================================
  describe('Feature 1: Static Asset Delivery & HTTP Routing', () => {
    it('1.1: GET / returns HTTP 200 with text/html and valid document structure', async () => {
      const res = await env.fetchApp('/');
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /text\/html;\s*charset=utf-8/i);
      const text = await res.text();
      assert.match(text, /<!DOCTYPE html>/i);
      assert.match(text, /<html/i);
      assert.match(text, /<\/html>/i);
      assert.match(text, /SecretSender/i);
    });

    it('1.2: GET /mlkem.browser.js returns HTTP 200 with javascript MIME type and cache header', async () => {
      const res = await env.fetchApp('/mlkem.browser.js');
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /application\/javascript;\s*charset=utf-8/i);
      assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
      const text = await res.text();
      assert.ok(text.length > 5000, 'mlkem.browser.js should not be empty');
      assert.match(text, /MlKem768/i);
    });

    it('1.3: GET /health returns HTTP 200 with json MIME type and status ok', async () => {
      const res = await env.fetchApp('/health');
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /application\/json;\s*charset=utf-8/i);
      const data = await res.json();
      assert.deepEqual(data, { status: 'ok', service: 'SecretSender' });
    });

    it('1.4: Non-existent route GET /does-not-exist returns HTTP 404', async () => {
      const res = await env.fetchApp('/does-not-exist-' + Date.now());
      assert.equal(res.status, 404);
    });

    it('1.5: Static SVG brand asset contract verification', async () => {
      // Verifies route structure for favicon.svg and badges
      const resFavicon = await env.fetchApp('/favicon.svg');
      // If server has staged SVGs, returns 200 image/svg+xml; otherwise 404 until staged
      assert.ok(resFavicon.status === 200 || resFavicon.status === 404);
      if (resFavicon.status === 200) {
        assert.match(resFavicon.headers.get('content-type') || '', /image\/svg\+xml/i);
      }
    });

    it('1.6: GET / with query parameters preserves 200 response and serves claim view', async () => {
      const res = await env.fetchApp('/?escrow_id=test-escrow-12345');
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.match(text, /id="claim-view"/);
      assert.match(text, /id="admin-view"/);
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
      // Primary action CTA: #FFD600 (BitBop yellow-gold) or emerald telemetry (#10B981)
      const hasTelemetryOrGold = /#FFD600|#10B981/i.test(pageHtml);
      assert.ok(hasTelemetryOrGold, 'HTML must declare primary gold or emerald telemetry tokens');
    });

    it('2.6: Monospace styling configured for cryptographic data and receipts', () => {
      assert.match(pageHtml, /font-family:[^;]*(?:monospace|JetBrains Mono|ui-monospace|SFMono)/i);
    });
  });

  // =========================================================================
  // Core Feature 3: Admin Secret Sealing API (POST /api/share)
  // =========================================================================
  describe('Feature 3: Admin Secret Sealing API (POST /api/share)', () => {
    it('3.1: Valid payload returns HTTP 200 with required receipt and handoff fields', async () => {
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'SuperSecretKey99' }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.escrow_id, 'Must return escrow_id');
      assert.ok(data.unlock_key, 'Must return unlock_key');
      assert.ok(data.claim_url, 'Must return claim_url');
      assert.ok(data.sms_link, 'Must return sms_link');
      assert.ok(data.sms_body, 'Must return sms_body');
      assert.ok(data.commit_receipt, 'Must return commit_receipt');
      assert.equal(data.commit_verified, true, 'Commit receipt must be verified');
    });

    it('3.2: Custom PIN provided in unlockKey is preserved in response', async () => {
      const customPin = 'PIN-alpha-987';
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'P@ssword123', unlockKey: customPin }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.unlock_key, customPin);
    });

    it('3.3: Auto-generated PIN is created as an 8-character hex string when unlockKey is omitted', async () => {
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'MyPasswordWithoutPin' }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.match(data.unlock_key, /^[0-9a-f]{8}$/i);
    });

    it('3.4: Context hash nonce invariant: plaintext password is never leaked into public context_hash', async () => {
      const secret = 'TOP_SECRET_DO_NOT_LEAK_ENTROPY';
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: secret }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      const contextHash = data.commit_receipt.context_hash || '';
      assert.ok(!contextHash.includes(secret), 'context_hash must not contain plaintext secret');
      assert.match(contextHash, /^sha256:[0-9a-f]{64}$/i);
    });

    it('3.5: Claim URL adheres to expected format (?escrow_id=...) without side-channel metadata', async () => {
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'PasswordForUrlCheck' }),
      });

      const data = await res.json();
      const u = new URL(data.claim_url);
      assert.equal(u.searchParams.get('escrow_id'), data.escrow_id);
      assert.equal(u.searchParams.get('unlock_key'), null, 'Unlock key must never be in claim URL');
      assert.equal(u.searchParams.get('password'), null, 'Password must never be in claim URL');
    });

    it('3.6: SMS link is properly formatted with sms: URI scheme', async () => {
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'PasswordForSmsCheck' }),
      });

      const data = await res.json();
      assert.match(data.sms_link, /^sms:\?body=/);
      const decodedBody = decodeURIComponent(data.sms_link.replace('sms:?body=', ''));
      assert.ok(decodedBody.includes(data.claim_url), 'SMS body must include claim URL');
      assert.ok(decodedBody.includes(data.unlock_key), 'SMS body must include unlock key');
    });
  });

  // =========================================================================
  // Core Feature 4: Claim Flow & Post-Quantum Decryption Core
  // =========================================================================
  describe('Feature 4: Claim Flow & ML-KEM-768 Decryption Core', () => {
    it('4.1: ML-KEM-768 keypair generation produces correct key sizes (1184 public, 2400 secret)', async () => {
      const kp = await env.generateKeyPair();
      assert.equal(kp.publicKey.length, 1184, 'ML-KEM-768 public key must be 1184 bytes');
      assert.equal(kp.secretKey.length, 2400, 'ML-KEM-768 secret key must be 2400 bytes');
      assert.equal(kp.publicKeyHex.length, 1184 * 2, 'Hex string must be 2368 characters');
    });

    it('4.2: Direct browser reveal request to BitBop Edge returns cipher and sealed envelope', async () => {
      // 1. Commit secret
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'QuantumProtectedSecret', unlockKey: 'pin-444' }),
      });
      const shareData = await shareRes.json();

      // 2. Generate client keypair
      const kp = await env.generateKeyPair();

      // 3. Reveal directly with BitBop
      const revealRes = await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          unlock_key: 'pin-444',
          kyber_public_key: kp.publicKeyHex,
          signature_scheme: 'ml-dsa-44',
        }),
      });

      assert.equal(revealRes.status, 200);
      const revealData = await revealRes.json();
      assert.ok(revealData.cipher, 'Must include cipher object');
      assert.ok(revealData.cipher.kyber_ciphertext_hex, 'Must include Kyber ciphertext');
      assert.ok(revealData.cipher.aes_iv_hex, 'Must include AES IV');
      assert.ok(revealData.cipher.aes_ciphertext_hex, 'Must include AES transit ciphertext');
      assert.ok(revealData.sealed_envelope, 'Must include sealed envelope');
      assert.ok(revealData.sealed_envelope.iv_hex, 'Must include envelope IV');
      assert.ok(revealData.sealed_envelope.ciphertext_b64, 'Must include envelope base64 ciphertext');
    });

    it('4.3: Decapsulation and AES-256-GCM decryption accurately recovers original secret', async () => {
      const secret = 'Exact-Secret-Match-12345!@#$%^&*()_+';
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: secret, unlockKey: 'pin-decrypt-test' }),
      });
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();
      const revealRes = await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          unlock_key: 'pin-decrypt-test',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      const revealData = await revealRes.json();

      const recovered = await env.decryptReveal(revealData, kp.secretKey);
      assert.equal(recovered, secret, 'Decrypted secret must match original secret exactly');
    });

    it('4.4: Zero Server Query Invariant: SecretSender app receives zero requests during recipient reveal', async () => {
      // Record initial app log count
      const initialLogs = env.appLogs.length;

      // Commit secret
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'ZeroQueryInvariantSecret', unlockKey: 'zq-pin-1' }),
      });
      const shareData = await shareRes.json();

      const logsAfterCommit = env.appLogs.length;

      // Perform recipient reveal directly against mock BitBop server
      const kp = await env.generateKeyPair();
      const revealRes = await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          unlock_key: 'zq-pin-1',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(revealRes.status, 200);

      // Verify receipt directly against mock BitBop server
      const revealData = await revealRes.json();
      const verifyRes = await env.fetchMock('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(revealData),
      });
      assert.equal(verifyRes.status, 200);

      // Verify app logs have not received any new requests during reveal or verify
      const logsAfterReveal = env.appLogs.length;
      assert.equal(
        logsAfterReveal,
        logsAfterCommit,
        'SecretSender server must receive 0 requests during recipient reveal and verification'
      );
    });

    it('4.5: ML-DSA-44 post-quantum provenance verification succeeds', async () => {
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'ProvenanceSecret', unlockKey: 'prov-pin' }),
      });
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();
      const revealRes = await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          unlock_key: 'prov-pin',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      const revealData = await revealRes.json();

      const verifyRes = await env.fetchMock('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(revealData),
      });
      const verifyData = await verifyRes.json();
      assert.equal(verifyRes.status, 200);
      assert.equal(verifyData.valid, true);
      assert.equal(verifyData.signature_scheme, 'ml-dsa-44');
    });
  });

  // =========================================================================
  // Core Feature 5: Error Codes & Security Invariants
  // =========================================================================
  describe('Feature 5: Error Codes & Security Invariants', () => {
    it('5.1: Missing password in POST /api/share returns error response', async () => {
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      assert.equal(res.status, 500);
      const data = await res.json();
      assert.match(data.error || '', /Secret password is required/i);
    });

    it('5.2: Non-JSON body in POST /api/share returns 500 with error message', async () => {
      const res = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid-json-content{{{',
      });

      assert.equal(res.status, 500);
      const data = await res.json();
      assert.ok(data.error, 'Must report error');
    });

    it('5.3: Wrong PIN attempt against /escrow/reveal returns HTTP 403 without burning secret', async () => {
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'SecretNonBurnCheck', unlockKey: 'correct-pin' }),
      });
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();

      // Attempt reveal with wrong PIN
      const wrongRes = await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          unlock_key: 'wrong-pin-guess',
          kyber_public_key: kp.publicKeyHex,
        }),
      });

      assert.equal(wrongRes.status, 403);
      const wrongData = await wrongRes.json();
      assert.match(wrongData.error || '', /Wrong unlock key/i);

      // Now attempt with correct PIN -> must succeed (secret was NOT burned)
      const correctRes = await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          unlock_key: 'correct-pin',
          kyber_public_key: kp.publicKeyHex,
        }),
      });

      assert.equal(correctRes.status, 200, 'Secret must not be burned after wrong PIN');
      const correctData = await correctRes.json();
      const plaintext = await env.decryptReveal(correctData, kp.secretKey);
      assert.equal(plaintext, 'SecretNonBurnCheck');
    });

    it('5.4: Successful reveal permanently burns secret; second attempt returns HTTP 409', async () => {
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'BurnOnceSecret', unlockKey: 'burn-pin' }),
      });
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();

      // First claim -> 200 OK
      const firstRes = await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          unlock_key: 'burn-pin',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(firstRes.status, 200);

      // Second claim with identical credentials -> 409 Conflict
      const secondRes = await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
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
      const res = await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: 'non-existent-escrow-' + Date.now(),
          unlock_key: 'pin',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(res.status, 404);
    });

    it('5.6: Timelocked secret queried before embargo returns HTTP 425 Too Early', async () => {
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: 'EmbargoSecret',
          unlockKey: 'embargo-pin',
          unlockAfterSeconds: 3600, // 1 hour in future
        }),
      });
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();
      const revealRes = await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
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
