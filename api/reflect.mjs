// api/reflect.mjs
// Portable External Agent Reflector for Vercel Serverless Functions (AWS Lambda) or Node.js.
// Drop this file into any Vercel repo's `api/` folder (e.g. pooled.run/api/reflect.mjs) to run
// the external peer on AWS Lambda outside Cloudflare's network, hitting https://secrets.bitbop.dev
// and https://api.bitbop.dev over the public internet.

import crypto from 'node:crypto';
import { MlKem768 } from 'mlkem';

const SECRETSENDER_ORIGIN = process.env.SECRETSENDER_ORIGIN || 'https://secrets.bitbop.dev';
const BITBOP_API_BASE = process.env.BITBOP_API_BASE || 'https://api.bitbop.dev';

async function decryptBitBopReveal(revealData, secretKeyBytes, kemInstance) {
  const { cipher, sealed_envelope: sealed } = revealData;
  const kyberCtBytes = Buffer.from(cipher.kyber_ciphertext_hex, 'hex');
  const sharedSecret = await kemInstance.decap(kyberCtBytes, secretKeyBytes);

  const transitKey = await crypto.subtle.importKey('raw', sharedSecret, { name: 'AES-GCM' }, false, ['decrypt']);
  const transitIv = Buffer.from(cipher.aes_iv_hex, 'hex');
  const transitCt = Buffer.from(cipher.aes_ciphertext_hex, 'hex');
  const rawEntropyBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: transitIv }, transitKey, transitCt);
  const entropyHex = Buffer.from(rawEntropyBuf).toString('hex');

  const envKeyDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(entropyHex));
  const envKey = await crypto.subtle.importKey('raw', envKeyDigest, { name: 'AES-GCM' }, false, ['decrypt']);
  const envIv = Buffer.from(sealed.iv_hex, 'hex');
  const envCt = Buffer.from(sealed.ciphertext_b64, 'base64');
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: envIv }, envKey, envCt);
  return new TextDecoder().decode(plainBuf);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  const action = body.action || 'ping';
  const telemetry = {
    provider: process.env.VERCEL ? 'vercel-aws-lambda' : 'external-node-reflector',
    region: process.env.VERCEL_REGION || process.env.AWS_REGION || 'external',
    timestamp: new Date().toISOString(),
  };

  try {
    if (action === 'ping') {
      res.status(200).json({ ok: true, action: 'ping', edge_telemetry: telemetry });
      return;
    }

    if (action === 'seal') {
      const r = await fetch(`${SECRETSENDER_ORIGIN}/api/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const share = await r.json();
      res.status(r.status).json({ ok: r.ok, action: 'seal', edge_telemetry: telemetry, share });
      return;
    }

    if (action === 'claim') {
      const { escrow_id: escrowId, unlock_key: unlockKey, test_wrong_pin: testWrongPin = true } = body;
      const kem = new MlKem768();
      const [publicKey, secretKey] = await kem.generateKeyPair();
      const pkHex = Buffer.from(publicKey).toString('hex');
      const steps = [];

      let wrongPinStatus = null;
      if (testWrongPin) {
        const wr = await fetch(`${BITBOP_API_BASE}/escrow/reveal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            escrow_id: escrowId,
            unlock_key: `${unlockKey}-wrong`,
            kyber_public_key: pkHex,
            signature_scheme: 'ml-dsa-44',
          }),
        });
        wrongPinStatus = wr.status;
        steps.push({ step: 'wrong_pin_probe', status: wr.status, passed: wr.status === 403 });
      }

      const rr = await fetch(`${BITBOP_API_BASE}/escrow/reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: escrowId,
          unlock_key: String(unlockKey),
          kyber_public_key: pkHex,
          signature_scheme: 'ml-dsa-44',
        }),
      });
      const revealData = await rr.json();
      if (rr.status !== 200) {
        res.status(422).json({ ok: false, action: 'claim', edge_telemetry: telemetry, reveal_status: rr.status, error: revealData.error });
        return;
      }

      const decryptedPlaintext = await decryptBitBopReveal(revealData, secretKey, kem);
      steps.push({ step: 'mlkem768_aes256gcm_decrypt', status: 200, passed: Boolean(decryptedPlaintext) });

      const vr = await fetch(`${BITBOP_API_BASE}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(revealData),
      });
      const vd = await vr.json();
      const revealVerified = vr.status === 200 && vd.valid !== false;
      steps.push({ step: 'mldsa44_receipt_verify', status: vr.status, passed: revealVerified });

      const br = await fetch(`${BITBOP_API_BASE}/escrow/reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_id: escrowId,
          unlock_key: String(unlockKey),
          kyber_public_key: pkHex,
          signature_scheme: 'ml-dsa-44',
        }),
      });
      steps.push({ step: 'burn_on_read_409_check', status: br.status, passed: br.status === 409 });

      res.status(200).json({
        ok: true,
        action: 'claim',
        edge_telemetry: telemetry,
        escrow_id: escrowId,
        decrypted_plaintext: decryptedPlaintext,
        reveal_verified: revealVerified,
        beacon_sequence: revealData.beacon_sequence,
        wrong_pin_status: wrongPinStatus,
        burn_recheck_status: br.status,
        steps,
      });
      return;
    }

    res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
