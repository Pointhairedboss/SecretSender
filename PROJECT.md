# SecretSender implementation map — Remediation v1.1

This is the current implementation map, superseding the pre-remediation single-server milestone/interface description. Remediation v1.1 merged in [PR #1](https://github.com/Pointhairedboss/SecretSender/pull/1); the reviewed main revision is `16921db57c285cd3fcdebd72243f04a1d7fb6557`, including `assets.run_worker_first: true`.

| Component | Current responsibility |
| --- | --- |
| `worker/index.mjs` | Cloudflare Worker routes; Client Envelope v2 validation; authenticated BitBop commit; status/reveal proxy; combined local/upstream receipt checks; restricted synthetic self-test |
| `scripts/client_template.mjs` | Sender and recipient UI; browser content encryption; full fragment-link construction; mandatory PIN handling; claim session lifecycle; receipt downloads; sanitized UAT seams |
| `mlkem.browser.js` | ML-KEM-768 and pinned local ML-DSA-44 browser verification |
| `scripts/build_cloudflare.mjs` | Build `public/index.html` from the template and copy the crypto bundle |
| `wrangler.jsonc` | Worker entrypoint, static assets, service binding and custom-domain route |
| `tests/e2e/harness.mjs` | Isolated Node adapter around the real Worker, local cryptographic test upstream and test-only public-key injection |
| `cloudrun-reflector/` | Optional external diagnostic/browser tooling; not the application runtime |

## Interface contracts

- **Sender → Worker:** bearer-authenticated `POST /api/share` with `client_envelope` v2, mandatory `unlockKey`, optional embargo/TTL and sample marker. Top-level plaintext secret fields are rejected.
- **Worker → BitBop:** `secretsender-v2` escrow profile, one-time reveal policy, canonical encrypted envelope, envelope hash, PIN and `share_id` idempotency. `BITBOP_API` service binding wins over public HTTPS fetch.
- **Worker → sender:** verified commit/evidence response and fragment-free `base_claim_url`. Only the browser can append its generated 256-bit link key.
- **Recipient → Worker:** non-consuming status, then PIN/claim-ID/ML-KEM public-key reveal and receipt verification through same-origin API routes.
- **Recipient-local:** five-minute tab session; pinned signature verification; outer-envelope unseal; inner-envelope decryption with the fragment link key. No normal application-server plaintext decryption path.
- **Diagnostics:** fixed synthetic reflector payload/key only. Synthetic sealing uses normal quota; claims are consuming operations on dedicated test shares.

The PIN controls release and the link key encrypts content. The normal sender API key is explicitly supplied/minted and remembered in browser `localStorage`; it is not auto-minted on startup. Upstream state and temporary browser key storage mean “zero storage” is not an accurate description.

## Operational references

- [README.md](README.md): workflow, exact route table, envelope contract and evidence boundaries.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): actual setup commands, bindings, key-pin coordination and release preparation.
- [TEST_INFRA.md](TEST_INFRA.md): local and cross-repository verification procedures.
- [TEST_READY.md](TEST_READY.md): reported versus independently observed evidence and implementation discrepancies.
- [docs/UAT_PLAN.md](docs/UAT_PLAN.md): current browser acceptance plan.
- [docs/EXTERNAL_AGENT_REFLECTOR_ARCHITECTURE.md](docs/EXTERNAL_AGENT_REFLECTOR_ARCHITECTURE.md): synthetic external diagnostic scope.

Historical milestone approvals and stored reports do not certify the current production deployment. No deployment, production-key change or entropy-pipeline change is part of these documentation corrections.
