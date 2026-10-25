import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { setupTestEnvironment } from './harness.mjs';

describe('Tier 4: Real-World Application Scenarios (Client Envelope v2 & Browser E2E)', () => {
  let env;

  before(async () => {
    env = await setupTestEnvironment();
  });

  after(async () => {
    await env.cleanup();
  });

  // =========================================================================
  // Scenario 1: End-to-End Zero-Knowledge Secret Transfer Simulation
  // =========================================================================
  describe('Scenario 1: End-to-End Zero-Knowledge Secret Transfer Simulation', () => {
    it('S1: Full lifecycle: Alice wraps Client Envelope v2 -> seals -> Bob checks status -> reveals -> verifies ML-DSA-44 -> decrypts two layers -> burns', async () => {
      const aliceSecret = 'postgres://admin:qkd_quantum_pass_2026@db.corp.internal:5432/secrets';
      const { body, linkKeyB64u } = await env.buildShareRequest(aliceSecret, {
        unlockKey: 'alice-pin-2026',
      });

      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      assert.equal(shareRes.status, 200, 'Share creation must succeed');
      const shareData = await shareRes.json();
      assert.ok(shareData.escrow_id);
      assert.ok(shareData.base_claim_url);
      assert.equal(shareData.commit_verified, true);

      // Alice constructs full claim URL locally with #link_key fragment
      const fullClaimUrl = `${shareData.base_claim_url}#${linkKeyB64u}`;
      const parsedClaimUrl = new URL(fullClaimUrl);
      const bobEscrowId = parsedClaimUrl.searchParams.get('escrow_id');
      const bobLinkKey = parsedClaimUrl.hash.slice(1);
      assert.equal(bobEscrowId, shareData.escrow_id);
      assert.equal(bobLinkKey.length, 43);

      // Bob probes non-consuming /api/escrow/status
      const statusRes = await env.fetchApp(`/api/escrow/status?escrow_id=${encodeURIComponent(bobEscrowId)}`);
      assert.equal(statusRes.status, 200);
      const statusData = await statusRes.json();
      assert.equal(statusData.escrow_profile, 'secretsender-v2');
      assert.equal(statusData.requires_unlock_key, true);

      const bobKem = await env.generateKeyPair();
      const revealRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: bobEscrowId,
          claim_id: crypto.randomUUID(),
          unlock_key: 'alice-pin-2026',
          kyber_public_key: bobKem.publicKeyHex,
          signature_scheme: 'ml-dsa-44',
        }),
      });

      assert.equal(revealRes.status, 200, 'Reveal must succeed');
      const revealData = await revealRes.json();

      // Verify ML-DSA-44 provenance receipt
      const verifyRes = await env.fetchApp('/api/escrow/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(revealData),
      });
      assert.equal(verifyRes.status, 200);
      const verifyData = await verifyRes.json();
      assert.equal(verifyData.valid, true);
      assert.equal(verifyData.local_mldsa44_valid, true);

      // Decrypt both layers
      const recoveredSecret = await env.decryptReveal(revealData, bobKem.secretKey, bobLinkKey);
      assert.equal(recoveredSecret, aliceSecret, 'Decrypted secret must match Alice original secret bit-for-bit');

      // Subsequent claim attempt with new claim_id is permanently blocked with HTTP 409
      const replayRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: bobEscrowId,
          claim_id: crypto.randomUUID(),
          unlock_key: 'alice-pin-2026',
          kyber_public_key: bobKem.publicKeyHex,
        }),
      });
      assert.equal(replayRes.status, 409, 'Replay or secondary access must be 409 burned');
    });
  });

  // =========================================================================
  // Scenario 2: Multi-Recipient Adversary Attack & Wrong Link Key Simulation
  // =========================================================================
  describe('Scenario 2: Multi-Recipient Adversary Attack Simulation', () => {
    it('S2: Adversary brute-force PINs fail (403); wrong link_key fails AES-GCM auth; legitimate recipient succeeds; replay fails (409)', async () => {
      const vaultSecret = 'PRODUCTION_API_KEY_SECRET_777';
      const { body, linkKeyB64u } = await env.buildShareRequest(vaultSecret, {
        unlockKey: 'vault-key-777',
      });
      const shareRes = await env.fetchApp('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const shareData = await shareRes.json();
      const escrowId = shareData.escrow_id;

      const adversaryKem = await env.generateKeyPair();
      const candidatePins = ['0000', '1234', 'password', 'admin', 'test'];

      for (const pin of candidatePins) {
        const advRes = await env.fetchApp('/api/escrow/reveal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            escrow_id: escrowId,
            claim_id: crypto.randomUUID(),
            unlock_key: pin,
            kyber_public_key: adversaryKem.publicKeyHex,
          }),
        });
        assert.equal(advRes.status, 403, `Adversary attempt with pin '${pin}' must be 403`);
      }

      // Legitimate recipient arrives and inputs authentic PIN
      const legitKem = await env.generateKeyPair();
      const legitRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: escrowId,
          claim_id: crypto.randomUUID(),
          unlock_key: 'vault-key-777',
          kyber_public_key: legitKem.publicKeyHex,
        }),
      });
      assert.equal(legitRes.status, 200);
      const legitData = await legitRes.json();

      // Wrong link_key fails inner AES-256-GCM decryption
      const wrongLinkKey = Buffer.alloc(32, 0x99)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
      await assert.rejects(
        () => env.decryptReveal(legitData, legitKem.secretKey, wrongLinkKey),
        'Wrong link_key must fail inner AES-256-GCM authentication',
      );

      // Authentic link_key decrypts cleanly
      const plaintext = await env.decryptReveal(legitData, legitKem.secretKey, linkKeyB64u);
      assert.equal(plaintext, vaultSecret);

      // Subsequent attempt returns 409 burned
      const lateAdvRes = await env.fetchApp('/api/escrow/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: escrowId,
          claim_id: crypto.randomUUID(),
          unlock_key: 'vault-key-777',
          kyber_public_key: adversaryKem.publicKeyHex,
        }),
      });
      assert.equal(lateAdvRes.status, 409);
    });
  });

  // =========================================================================
  // Scenario 3: Synthetic Reflector & Timelock Embargo Simulation
  // =========================================================================
  describe('Scenario 3: Synthetic Reflector & Timelock Embargo Simulation', () => {
    it('S3: Synthetic POST /api/reflect rejects caller secrets/link_keys, seals fixed synthetic envelope, and verifies ML-DSA-44 on claim', async () => {
      // 1. Reject caller-supplied password / link_key_b64u / # fragment with HTTP 400
      for (const badBody of [
        { action: 'seal', password: 'CallerSuppliedSecret', unlockKey: 'refl-pin-88' },
        { action: 'claim', escrow_id: 'esc_123', pin: 'refl-pin-88', link_key_b64u: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
        { action: 'claim', claim_url: 'https://secrets.bitbop.dev/?escrow_id=esc_123#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', pin: 'refl-pin-88' },
      ]) {
        const badRes = await env.fetchApp('/api/reflect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(badBody),
        });
        assert.equal(badRes.status, 400, `Reflector must reject ${JSON.stringify(badBody)} with HTTP 400`);
      }

      // 2. Seal fixed internal synthetic payload (normal quota, no # or link_key_b64u in response)
      const sealRes = await env.fetchApp('/api/reflect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'seal',
          pin: 'refl-pin-88',
        }),
      });
      assert.equal(sealRes.status, 200);
      const sealData = await sealRes.json();
      assert.equal(sealData.ok, true);
      assert.equal(sealData.share.claim_url.includes('#'), false, 'Reflector seal claim_url must not include # fragment');
      assert.equal(sealData.share.link_key_b64u, undefined, 'Reflector seal must not return link_key_b64u');

      // 3. Claim using fixed internal synthetic link_key and mandatory wrong-PIN probe
      const claimRes = await env.fetchApp('/api/reflect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'claim',
          escrow_id: sealData.share.escrow_id,
          claim_url: sealData.share.claim_url,
          pin: 'refl-pin-88',
        }),
      });
      assert.equal(claimRes.status, 200);
      const claimData = await claimRes.json();
      assert.equal(claimData.ok, true);
      assert.equal(claimData.decrypted_plaintext, 'SYNTHETIC-REFLECTOR-PROBE-V2');
      assert.equal(claimData.reveal_verified, true);
      assert.equal(claimData.wrong_pin_status, 403);
      assert.equal(claimData.burn_recheck_status, 409);
      assert.equal(claimData.steps.every((s) => s.passed === true), true);
    });
  });

  // =========================================================================
  // Scenario 4: Headless Chromium Browser E2E Verification
  // =========================================================================
  describe('Scenario 4: Headless Chromium Browser E2E Verification', () => {
    it('S4: Browser seals via Sample Demo, strips #link_key from address bar, verifies ML-DSA-44, decrypts, and redacts UAT telemetry', async () => {
      let browser;
      try {
        browser = await chromium.launch({ headless: true });
      } catch {
        browser = await chromium.launch({ headless: true, channel: 'chrome' });
      }
      try {
        const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
        const page = await context.newPage();

        // 1. Open sender view and run Sample Demo
        await page.goto(`${env.appUrl}/?uat=1`, { waitUntil: 'domcontentloaded' });
        await page.click('#sample-demo-btn');
        await page.waitForFunction(
          () => typeof window.__uatState === 'function' && Boolean(window.__uatState().escrowId),
          undefined,
          { timeout: 15000 },
        );

        const senderOut = await page.evaluate(() => ({
          claimUrl: document.getElementById('share-url-box')?.textContent?.trim() || '',
          pinShown: document.getElementById('share-pin-box')?.textContent?.trim() || '',
          hasQrSvg: Boolean(document.querySelector('#qr-container svg')),
          uatLogStr: JSON.stringify(window.__uatRecorder.exportLog()),
          vw: window.innerWidth,
          sw: document.documentElement.scrollWidth,
        }));

        assert.ok(senderOut.claimUrl.includes('#'), 'Claim URL must contain #link_key fragment');
        assert.ok(senderOut.hasQrSvg, 'Sender card must render local SVG QR code');
        assert.ok(senderOut.sw <= senderOut.vw + 1, 'Zero horizontal overflow on 412px mobile viewport');
        const linkKeyFragment = senderOut.claimUrl.split('#')[1];
        assert.equal(linkKeyFragment.length, 43, 'Link key fragment must be 43 Base64URL chars');
        assert.ok(!senderOut.uatLogStr.includes(linkKeyFragment), 'UAT log must never contain linkKeyFragment');

        // 2. Navigate to malformed fragment -> must fail closed with zero /api/escrow/* network requests
        const badUrl = `${env.appUrl}/?escrow_id=esc_bad_test&uat=1#short`;
        await page.goto(badUrl, { waitUntil: 'domcontentloaded' });
        const badState = await page.evaluate(() => ({
          state: window.__uatState(),
          resultText: document.getElementById('result')?.innerText || '',
        }));
        assert.equal(badState.state.hasLinkKey, false);
        assert.match(badState.resultText, /Incomplete or damaged SecretSender link/i);

        // 3. Navigate to valid fullClaimUrl and complete recipient reveal
        const u = new URL(senderOut.claimUrl);
        u.host = `127.0.0.1:${env.appPort}`;
        u.searchParams.set('uat', '1');
        await page.goto(u.toString(), { waitUntil: 'domcontentloaded' });

        // Verify history.replaceState stripped the #fragment from location.hash
        const hashAfterLoad = await page.evaluate(() => window.location.hash);
        assert.equal(hashAfterLoad, '', 'Address bar #fragment must be stripped immediately after load');

        await page.fill('#unlock', senderOut.pinShown);
        await page.click('#reveal-btn');
        await page.waitForSelector('#pw-display', { timeout: 15000 });

        const recipientOut = await page.evaluate(() => ({
          decrypted: document.getElementById('pw-display')?.textContent || '',
          resultText: document.getElementById('result')?.innerText || '',
          ctaVisible: document.getElementById('post-reveal-cta')?.style.display !== 'none',
          uatLogStr: JSON.stringify(window.__uatRecorder.exportLog()),
        }));

        assert.match(recipientOut.decrypted, /^\[SAMPLE DEMO\]/);
        assert.match(recipientOut.resultText, /YES \(ML-DSA-44/);
        assert.equal(recipientOut.ctaVisible, true, 'Post-reveal CTA must be visible after successful reveal');
        assert.ok(!recipientOut.uatLogStr.includes(recipientOut.decrypted), 'UAT log must redact decrypted secret');
        assert.ok(!recipientOut.uatLogStr.includes(senderOut.pinShown), 'UAT log must redact PIN');
      } finally {
        await browser.close();
      }
    });
  });
});
