import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';
import { MlKem768 } from 'mlkem';

import secretSenderWorker, {
  encryptSyntheticEnvelopeV2InIsolate,
  decryptSyntheticEnvelopeV2InIsolate,
  verifyReceiptSignatureInWorker,
} from '../worker/index.mjs';

import bitbopWorker, {
  BitBopCoordinator,
  sealBeaconEntropyBlock,
} from '../../bitbop-quantum-node/source_payload/index.js';

const TEST_SEAL_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const seed32 = new Uint8Array(32).fill(0x5a);
const dsaKeys = ml_dsa44.keygen(seed32);
const SERVICE_PRIV_B64 = Buffer.from(dsaKeys.secretKey).toString('base64');
const SERVICE_PUB_B64 = Buffer.from(dsaKeys.publicKey).toString('base64');

function bytesToHex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

function sha256HexPrefixed(str) {
  return 'sha256:' + crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

class NodeSqliteStorage {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.lastAlarmMs = null;
    this.sql = {
      exec: (query, ...params) => {
        const trimmed = query.trim();
        const upper = trimmed.toUpperCase();
        const sanitizedParams = params.map((p) => (p === undefined ? null : p));
        if (
          sanitizedParams.length === 0 &&
          !upper.startsWith('SELECT ') &&
          !upper.startsWith('PRAGMA ')
        ) {
          this.db.exec(trimmed);
          return { toArray: () => [] };
        }
        const stmt = this.db.prepare(trimmed);
        if (upper.startsWith('SELECT ') || upper.startsWith('PRAGMA ')) {
          const rows = stmt.all(...sanitizedParams);
          return { toArray: () => rows };
        }
        stmt.run(...sanitizedParams);
        return { toArray: () => [] };
      },
    };
  }
  async setAlarm(ms) {
    this.lastAlarmMs = ms;
  }
}

class MemoryKV {
  constructor() {
    this.map = new Map();
  }
  async get(key, type) {
    const val = this.map.get(key);
    if (val === undefined) return null;
    if (type === 'json') return JSON.parse(val);
    return val;
  }
  async put(key, val) {
    this.map.set(key, typeof val === 'string' ? val : JSON.stringify(val));
  }
  async delete(key) {
    this.map.delete(key);
  }
}

async function createCrossRepoEnv() {
  const kv = new MemoryKV();
  const storage = new NodeSqliteStorage();
  const beaconEdKeyPair = await crypto.webcrypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ]);
  const beaconEdPubRaw = new Uint8Array(
    await crypto.webcrypto.subtle.exportKey('raw', beaconEdKeyPair.publicKey),
  );
  const beaconEdPubHex = bytesToHex(beaconEdPubRaw);

  const bitbopEnv = {
    BITBOP_KV: kv,
    BEACON_KV: kv,
    BEACON_SEAL_KEY: TEST_SEAL_KEY,
    BEACON_PUBLIC_KEY: beaconEdPubHex,
    BEACON_PUBLIC_KEY_MLDSA44_B64: SERVICE_PUB_B64,
    SERVICE_PRIVATE_KEY_MLDSA44_B64: SERVICE_PRIV_B64,
    SERVICE_PUBLIC_KEY_MLDSA44_B64: SERVICE_PUB_B64,
    STRIPE_WEBHOOK_SECRET: 'whsec_cross_repo_test',
    AUTHORIZED_API_KEYS: 'sys-secret-admin-key',
    SYSTEM_API_KEY: 'sys-secret-admin-key',
  };

  const rawEntropy = new Uint8Array(65536);
  for (let i = 0; i < rawEntropy.length; i++) rawEntropy[i] = (i * 41 + 7) & 0xff;
  const rawEntropyHex = bytesToHex(rawEntropy);
  const sealedEntropy = await sealBeaconEntropyBlock(rawEntropy, TEST_SEAL_KEY);
  const blockTimestamp = new Date().toISOString();
  const prevHash = 'sha256:' + '0'.repeat(64);
  const blockHash = sha256HexPrefixed(`200:${blockTimestamp}:${rawEntropyHex}:${prevHash}`);
  const edSigBytes = await crypto.webcrypto.subtle.sign(
    'Ed25519',
    beaconEdKeyPair.privateKey,
    new TextEncoder().encode(blockHash),
  );
  const blockSigBytes = ml_dsa44.sign(new TextEncoder().encode(blockHash), dsaKeys.secretKey);

  await kv.put(
    'beacon:200',
    JSON.stringify({
      version: '2.0',
      sequence: 200,
      timestamp: blockTimestamp,
      chain: { entry_hash: blockHash, prev_hash: prevHash },
      previous_hash: prevHash,
      hash: blockHash,
      entropy: { ...sealedEntropy, byte_count: rawEntropy.length },
      source: { id: 'usb-trng-1', type: 'hardware' },
      key_id: 'mldsa44-release-2026-01',
      signature_scheme: 'ml-dsa-44',
      signature: `ed25519:${bytesToHex(new Uint8Array(edSigBytes))}`,
      signature_mldsa44: `mldsa44:${bytesToHex(blockSigBytes)}`,
    }),
  );
  await kv.put('pool:cursor', '200');
  await kv.put(
    'pool:index',
    JSON.stringify({
      active_sequence: 200,
      active_offset: 0,
      latest_sequence: 200,
      pool_depth: 1,
    }),
  );

  const coordinator = new BitBopCoordinator(
    {
      storage,
      blockConcurrencyWhile: async (fn) => await fn(),
    },
    bitbopEnv,
  );
  bitbopEnv.BITBOP_COORDINATOR = {
    idFromName: () => 'GLOBAL_COORDINATOR',
    get: () => ({
      fetch: (reqOrUrl, init) => {
        const req = typeof reqOrUrl === 'string' ? new Request(reqOrUrl, init) : reqOrUrl;
        return coordinator.fetch(req);
      },
    }),
  };

  // Wire SecretSender Worker directly to bitbop-quantum-node Worker via BITBOP_API Service Binding
  const secretSenderEnv = {
    PUBLIC_ORIGIN: 'https://secrets.bitbop.dev',
    SERVICE_PUBLIC_KEY_MLDSA44_B64: SERVICE_PUB_B64,
    BITBOP_API: {
      fetch: (reqOrUrl, init) => {
        const req = typeof reqOrUrl === 'string' ? new Request(reqOrUrl, init) : reqOrUrl;
        return bitbopWorker.fetch(req, bitbopEnv);
      },
    },
  };

  return { bitbopEnv, secretSenderEnv, coordinator, storage };
}

async function runCrossRepoIntegrationTests() {
  console.log('=== Cross-Repo Integration Suite: SecretSender Worker <-> BitBop Platform Worker ===');
  const { secretSenderEnv } = await createCrossRepoEnv();

  // 1. Mint a free key through SecretSender's /api/keys/free proxy -> BitBop /api/keys/free
  console.log('1. Minting self-service Free Key via SecretSender -> BitBop...');
  const kem = new MlKem768();
  const [pkBytes, skBytes] = await kem.generateKeyPair();
  const mintReq = new Request('https://secrets.bitbop.dev/api/keys/free', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '198.51.100.44',
    },
    body: JSON.stringify({ kyber_public_key: Buffer.from(pkBytes).toString('hex') }),
  });
  const mintRes = await secretSenderWorker.fetch(mintReq, secretSenderEnv);
  assert.equal(mintRes.status, 200, 'Free key mint must succeed with HTTP 200');
  const mintData = await mintRes.json();
  const sharedSecret = await kem.decap(
    new Uint8Array(Buffer.from(mintData.cipher.kyber_ciphertext_hex, 'hex')),
    skBytes,
  );
  const aesKey = await crypto.webcrypto.subtle.importKey(
    'raw',
    sharedSecret,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const keyBuf = await crypto.webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(mintData.cipher.aes_iv_hex, 'hex') },
    aesKey,
    Buffer.from(mintData.cipher.aes_ciphertext_hex, 'hex'),
  );
  const freeApiKey = new TextDecoder().decode(keyBuf).trim();
  assert.match(freeApiKey, /^bb_free_[0-9a-f]{8}_[0-9a-f]{64}_[0-9a-f]{32}$/);
  secretSenderEnv.BITBOP_SAMPLE_API_KEY = freeApiKey;
  secretSenderEnv.BITBOP_API_KEY = freeApiKey;

  // 2. Seal a Client Envelope v2 secret via SecretSender POST /api/share -> BitBop /escrow/commit
  console.log('2. Sealing Client Envelope v2 via SecretSender POST /api/share...');
  const syntheticSecret = 'CrossRepo-Quantum-Secret-2026!@#';
  const { client_envelope: envelope, linkKeyB64u } = await encryptSyntheticEnvelopeV2InIsolate(
    syntheticSecret,
  );
  assert.match(linkKeyB64u, /^[A-Za-z0-9_-]{43}$/);

  const shareReq = new Request('https://secrets.bitbop.dev/api/share', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${freeApiKey}`,
      'CF-Connecting-IP': '198.51.100.44',
    },
    body: JSON.stringify({
      client_envelope: envelope,
      unlockKey: '948201',
      unlockAfterSeconds: 0,
      ttlSeconds: 3600,
    }),
  });
  const shareRes = await secretSenderWorker.fetch(shareReq, secretSenderEnv);
  assert.equal(shareRes.status, 200, 'POST /api/share must succeed with HTTP 200');
  const shareData = await shareRes.json();
  assert.ok(shareData.escrow_id, 'Must return escrow_id');
  assert.equal(shareData.commit_verified, true, 'Commit receipt must be verified');
  assert.equal(shareData.evidence_receipt.escrow_profile, 'secretsender-v2');
  assert.equal(shareData.evidence_receipt.receipt_version, 2);
  assert.equal(
    shareData.commit_receipt.sealed_envelope,
    undefined,
    'Hosted commit receipt must not leak sealed_envelope before reveal',
  );

  // 3. Replay identical creation request (Creation Idempotency Check)
  console.log('3. Verifying Creation Idempotency (zero extra debit on duplicate retry)...');
  const replayRes = await secretSenderWorker.fetch(
    new Request('https://secrets.bitbop.dev/api/share', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${freeApiKey}`,
        'CF-Connecting-IP': '198.51.100.44',
      },
      body: JSON.stringify({
        client_envelope: envelope,
        unlockKey: '948201',
        unlockAfterSeconds: 0,
        ttlSeconds: 3600,
      }),
    }),
    secretSenderEnv,
  );
  assert.equal(replayRes.status, 200);
  const replayData = await replayRes.json();
  assert.equal(replayData.escrow_id, shareData.escrow_id, 'Idempotent replay must return same escrow_id');

  // Check key status to confirm only 1 handover (50 credits) was debited
  const statusKeyRes = await secretSenderWorker.fetch(
    new Request('https://secrets.bitbop.dev/api/key-status', {
      method: 'GET',
      headers: { Authorization: `Bearer ${freeApiKey}` },
    }),
    secretSenderEnv,
  );
  assert.equal(statusKeyRes.status, 200);
  const statusKeyData = await statusKeyRes.json();
  assert.equal(statusKeyData.used, 50, 'Exactly 50 credits debited once across both calls');

  // 4. Non-consuming GET /api/escrow/status probe
  console.log('4. Probing non-consuming GET /api/escrow/status...');
  const escStatusRes = await secretSenderWorker.fetch(
    new Request(`https://secrets.bitbop.dev/api/escrow/status?escrow_id=${shareData.escrow_id}`),
    secretSenderEnv,
  );
  assert.equal(escStatusRes.status, 200);
  const escStatusData = await escStatusRes.json();
  assert.equal(escStatusData.status, 'available');
  assert.equal(escStatusData.escrow_profile, 'secretsender-v2');
  assert.equal(escStatusData.requires_unlock_key, true);

  // 5. Reveal with wrong PIN (403, not burned)
  console.log('5. Verifying wrong PIN returns 403 and preserves escrow...');
  const [claimPk, claimSk] = await kem.generateKeyPair();
  const claimPkHex = Buffer.from(claimPk).toString('hex');
  const claimId = crypto.randomUUID();

  const wrongPinRes = await secretSenderWorker.fetch(
    new Request('https://secrets.bitbop.dev/api/escrow/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.88' },
      body: JSON.stringify({
        escrow_id: shareData.escrow_id,
        claim_id: claimId,
        unlock_key: '000000',
        kyber_public_key: claimPkHex,
        signature_scheme: 'ml-dsa-44',
      }),
    }),
    secretSenderEnv,
  );
  assert.equal(wrongPinRes.status, 403);

  // 6. Reveal with valid PIN + 5-minute same-claimant retry + competing claimant 409
  console.log('6. Verifying valid reveal, dual-layer decryption, 5m retry, and competing claimant 409...');
  const revealRes = await secretSenderWorker.fetch(
    new Request('https://secrets.bitbop.dev/api/escrow/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.88' },
      body: JSON.stringify({
        escrow_id: shareData.escrow_id,
        claim_id: claimId,
        unlock_key: '948201',
        kyber_public_key: claimPkHex,
        signature_scheme: 'ml-dsa-44',
      }),
    }),
    secretSenderEnv,
  );
  assert.equal(revealRes.status, 200);
  const revealData = await revealRes.json();
  assert.equal(revealData.escrow_profile, 'secretsender-v2');
  assert.ok(revealData.evidence_receipt);
  assert.ok(revealData.delivery_signature);

  const workerSigCheck = verifyReceiptSignatureInWorker(revealData, secretSenderEnv);
  assert.equal(workerSigCheck.valid, true, 'Worker ML-DSA-44 verifier must accept reveal receipt');

  // Same claimant retry within 5m returns identical encrypted response (200)
  const retryRevealRes = await secretSenderWorker.fetch(
    new Request('https://secrets.bitbop.dev/api/escrow/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.88' },
      body: JSON.stringify({
        escrow_id: shareData.escrow_id,
        claim_id: claimId,
        unlock_key: '948201',
        kyber_public_key: claimPkHex,
        signature_scheme: 'ml-dsa-44',
      }),
    }),
    secretSenderEnv,
  );
  assert.equal(retryRevealRes.status, 200, 'Same-claimant retry must succeed with HTTP 200');
  const retryData = await retryRevealRes.json();
  assert.equal(retryData.delivery_signature, revealData.delivery_signature);

  // Competing claimant with different claim_id gets 409 Conflict
  const [otherPk] = await kem.generateKeyPair();
  const competingRes = await secretSenderWorker.fetch(
    new Request('https://secrets.bitbop.dev/api/escrow/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.99' },
      body: JSON.stringify({
        escrow_id: shareData.escrow_id,
        claim_id: crypto.randomUUID(),
        unlock_key: '948201',
        kyber_public_key: Buffer.from(otherPk).toString('hex'),
        signature_scheme: 'ml-dsa-44',
      }),
    }),
    secretSenderEnv,
  );
  assert.equal(competingRes.status, 409, 'Competing claimant must receive HTTP 409 Conflict');

  // 7. Exercise POST /api/reflect end-to-end against real BitBop Worker
  console.log('7. Exercising POST /api/reflect (seal + claim) against real BitBop Worker...');
  const badReflectRes = await secretSenderWorker.fetch(
    new Request('https://secrets.bitbop.dev/api/reflect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${freeApiKey}`,
      },
      body: JSON.stringify({
        action: 'seal',
        password: 'ForbiddenCallerSecret',
        pin: '774411',
      }),
    }),
    secretSenderEnv,
  );
  assert.equal(badReflectRes.status, 400, 'Reflector must reject caller-supplied password with HTTP 400');

  const reflectSealRes = await secretSenderWorker.fetch(
    new Request('https://secrets.bitbop.dev/api/reflect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${freeApiKey}`,
      },
      body: JSON.stringify({
        action: 'seal',
        pin: '774411',
      }),
    }),
    secretSenderEnv,
  );
  assert.equal(reflectSealRes.status, 200);
  const reflectSealData = await reflectSealRes.json();
  assert.equal(reflectSealData.ok, true);
  assert.ok(reflectSealData.share.escrow_id);
  assert.equal(reflectSealData.share.link_key_b64u, undefined, 'Reflector seal must not return link_key_b64u');
  assert.equal(reflectSealData.share.claim_url.includes('#'), false, 'Reflector seal claim_url must not contain #');

  const reflectClaimRes = await secretSenderWorker.fetch(
    new Request('https://secrets.bitbop.dev/api/reflect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${freeApiKey}`,
      },
      body: JSON.stringify({
        action: 'claim',
        escrow_id: reflectSealData.share.escrow_id,
        pin: reflectSealData.share.unlock_key,
      }),
    }),
    secretSenderEnv,
  );
  assert.equal(reflectClaimRes.status, 200);
  const reflectClaimData = await reflectClaimRes.json();
  assert.equal(reflectClaimData.ok, true, 'Reflector claim against real BitBop must pass all checks');
  assert.equal(reflectClaimData.decrypted_plaintext, 'SYNTHETIC-REFLECTOR-PROBE-V2');
  assert.equal(reflectClaimData.reveal_verified, true);
  assert.equal(reflectClaimData.wrong_pin_status, 403);
  assert.equal(reflectClaimData.burn_recheck_status, 409);
  assert.equal(
    reflectClaimData.steps.every((s) => s.passed === true),
    true,
    'Every mandatory reflector step must pass',
  );

  console.log('✔ All Cross-Repo SecretSender <-> BitBop Platform integration assertions passed!');
}

runCrossRepoIntegrationTests().catch((err) => {
  console.error('Cross-repo integration test failed:', err);
  process.exit(1);
});
