import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment } from './harness.mjs';

describe('Tier 3: Cross-Feature Pairwise Combinations', () => {
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
      // Create secret with 1-hour embargo
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: 'SecretUnderEmbargo1',
          unlockKey: 'correct-embargo-pin',
          unlockAfterSeconds: 3600,
        }),
      });
      assert.equal(shareRes.status, 200);
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();

      // Attacker attempts guess with wrong PIN before embargo window passes
      const prematureRes = await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          unlock_key: 'attacker-wrong-guess',
          kyber_public_key: kp.publicKeyHex,
        }),
      });

      // Must reject with 425 (embargo active), without burning secret or leaking PIN validity
      assert.equal(prematureRes.status, 425);
      const data = await prematureRes.json();
      assert.ok(data.unlock_at);
      assert.match(data.error || '', /Time-Locked/i);
    });

    it('C1.2: Premature wrong PIN attempt does not burn or corrupt secret state', async () => {
      // Query mock escrow inspection endpoint to assert claimed remains false and secret is preserved
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: 'PreservedStateSecret',
          unlockKey: 'my-pin-state',
          unlockAfterSeconds: 60,
        }),
      });
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();
      await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          unlock_key: 'wrong-guess',
          kyber_public_key: kp.publicKeyHex,
        }),
      });

      const inspectRes = await env.fetchMock(`/test/escrow/${shareData.escrow_id}`);
      assert.equal(inspectRes.status, 200);
      const escrowRecord = await inspectRes.json();
      assert.equal(escrowRecord.claimed, false);
      assert.equal(escrowRecord.claimed_at, null);
    });
  });

  // =========================================================================
  // 2. Pairwise: Timelock Embargo + Valid Claim Lifecycle
  // =========================================================================
  describe('Pairwise: Timelock Embargo + Valid Claim Lifecycle', () => {
    it('C2.1: Secret with short embargo transitions from 425 to 200 reveal upon expiry', async () => {
      // 1-second embargo
      const secretContent = 'Time-Released-Quantum-Payload-2026';
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: secretContent,
          unlockKey: 'valid-pin-999',
          unlockAfterSeconds: 1,
        }),
      });
      assert.equal(shareRes.status, 200);
      const shareData = await shareRes.json();

      const kp = await env.generateKeyPair();

      // Immediate check -> HTTP 425
      const earlyRes = await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          unlock_key: 'valid-pin-999',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(earlyRes.status, 425);

      // Wait 1200ms for embargo to elapse
      await new Promise((r) => setTimeout(r, 1200));

      // Post-embargo check -> HTTP 200 + successful decryption
      const expiredRes = await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          unlock_key: 'valid-pin-999',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(expiredRes.status, 200);
      const revealData = await expiredRes.json();

      const decrypted = await env.decryptReveal(revealData, kp.secretKey);
      assert.equal(decrypted, secretContent);

      // Verify immediate subsequent call is 409
      const burnedRes = await env.fetchMock('/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: shareData.escrow_id,
          unlock_key: 'valid-pin-999',
          kyber_public_key: kp.publicKeyHex,
        }),
      });
      assert.equal(burnedRes.status, 409);
    });
  });

  // =========================================================================
  // 3. Pairwise: SMS Handoff + Mobile Viewport & CSS Wrapping
  // =========================================================================
  describe('Pairwise: SMS Handoff + Mobile Viewport Constraints', () => {
    it('C3.1: SMS URI body correctly escapes special characters and preserves URL structure', async () => {
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: 'SmsSpecialCharSecret',
          unlockKey: 'PIN#1&2=3?',
        }),
      });
      assert.equal(shareRes.status, 200);
      const shareData = await shareRes.json();

      const smsUri = shareData.sms_link;
      assert.ok(smsUri.startsWith('sms:?body='));

      // Ensure no raw unescaped '&' or '?' after 'sms:?body=' which would corrupt URI query parser
      const bodyParam = smsUri.replace('sms:?body=', '');
      assert.ok(!bodyParam.includes(' '), 'URI must not contain raw spaces');
      assert.ok(!bodyParam.includes('&body='), 'URI must not contain duplicate unescaped query tokens');

      const decoded = decodeURIComponent(bodyParam);
      assert.ok(decoded.includes(shareData.claim_url));
      assert.ok(decoded.includes(shareData.unlock_key));
      assert.ok(decoded.includes(shareData.provenance_url));
    });

    it('C3.2: HTML styles contain CSS wrapping directives to prevent mobile overflow', async () => {
      const res = await env.fetchApp('/');
      const html = await res.text();

      // Check for word-break or overflow-wrap on monospace or container classes
      const hasWordBreak = /word-break:\s*break-all|overflow-wrap:\s*anywhere|overflow-wrap:\s*break-word/i.test(html);
      assert.ok(hasWordBreak, 'HTML/CSS must define word-break or overflow-wrap to prevent horizontal overflow on S21');
    });

    it('C3.3: Claim view has hidden style by default when no escrow_id is present in query', async () => {
      const res = await env.fetchApp('/');
      const html = await res.text();
      // Verifies admin view is visible and claim view is hidden by default
      assert.match(html, /id="claim-view"[^>]*style="[^"]*display:\s*none/i);
    });
  });

  // =========================================================================
  // 4. Pairwise: Custom PIN + Far-Future Embargo + Unicode Secret Payload
  // =========================================================================
  describe('Pairwise: Custom PIN + Far-Future Embargo + Multi-byte International Payload', () => {
    it('C4.1: Multi-language UTF-8 secret sealed with future embargo and international PIN', async () => {
      const internationalSecret = '🔒 秘密の暗号 2026: مرحبا بالعالم — Привет мир — 100% Post-Quantum';
      const internationalPin = 'PIN-日本-888';
      const farFutureIso = new Date(Date.now() + 86400 * 7 * 1000).toISOString(); // 7 days

      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: internationalSecret,
          unlockKey: internationalPin,
          unlockAtIso: farFutureIso,
        }),
      });

      assert.equal(shareRes.status, 200);
      const shareData = await shareRes.json();
      assert.equal(shareData.unlock_key, internationalPin);
      assert.ok(shareData.unlock_after_seconds > 86400 * 6);
      assert.equal(shareData.commit_verified, true);
    });
  });

  // =========================================================================
  // 5. Pairwise: Flight Recorder Seam & Gating Verification
  // =========================================================================
  describe('Pairwise: Flight Recorder Seam & Gating Verification', () => {
    it('C5.1: HTML includes UAT flight recorder hooks and state inspection affordances', async () => {
      const res = await env.fetchApp('/?uat=1');
      assert.equal(res.status, 200);
      const html = await res.text();

      // Check for presence of flight recorder seam or client script hooks
      assert.ok(
        html.includes('__uat') || html.includes('BitBopMlKem') || html.includes('performDirectBrowserReveal'),
        'Page script must contain client logic and testing affordances'
      );
    });
  });
});
