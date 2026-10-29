# SecretSender v1.1 verification procedures

Use [README.md](README.md) for the wire contract and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for prerequisites and setup. [TEST_READY.md](TEST_READY.md) separates historical reported results, current review evidence and implementation gaps.

## Local regression commands

Install dependencies using the documented lockfile workaround, then install Chromium and build:

```bash
npx playwright install chromium
npm run build:cf
npm test
node tests/verify_m1_challenger2.mjs
node --test --test-reporter=tap tests/adversarial_challenge_m1.test.mjs
```

The E2E runner supports `node tests/e2e/runner.mjs --tier=1` through `--tier=4`. Tier 4 includes an actual headless browser test; a full pass needs Playwright's Chromium or its fallback installed Chrome channel.

For explicit machine-readable counts, run the files directly:

```bash
node --test --test-reporter=tap --test-concurrency=1 tests/e2e/tier*.test.mjs
```

The npm runner parses TAP `# tests`/`# pass`/`# fail` lines. On runtimes selecting the spec reporter by default it can print `0/0` despite executed tests; retain the explicit TAP output and exit status instead of relying on that summary.

| Suite | What executes | Boundary of its evidence |
| --- | --- | --- |
| `npm test` / E2E tier files | The real SecretSender Worker with a local HTTP adapter and test `ASSETS` binding; local cryptographic BitBop test service; browser test in Tier 4 | Exercises source and browser behavior. The upstream is a test double, not production BitBop or physical entropy |
| `verify_m1_challenger2.mjs` | Template/source checks, asset equality, HTTP behavior and concurrency | Source/adapter verification, not a deployed Cloudflare attestation |
| `adversarial_challenge_m1.test.mjs` | Methods, malformed inputs, traversal and leakage checks through that local adapter | Does not reproduce every Cloudflare network/WAF behavior |
| `cross_repo_live_bitbop.test.mjs` | Imported BitBop Worker and coordinator backed by in-memory SQLite/KV and deterministic synthetic entropy/test signing keys | Local cross-repository integration, despite “live” in its filename; no production endpoint or collector validation |

`tests/e2e/harness.mjs` imports `worker/index.mjs` and `buildHtml` directly. It creates a local cryptographic upstream with ephemeral ML-DSA-44 keys and injects the matching **test public key** into served browser assets and Worker env. It retains a simulated upstream and Node HTTP adapter for isolation; removal of the old mock-server file does not mean tests run against real hardware. The deleted standalone application server and separate mock-server file are not dependencies.

Setting a shell `BITBOP_API_BASE` does not convert `npm test` into a production test: the harness supplies its own upstream and `BITBOP_API` binding. Do not describe the test suite as a live-service health check.

## Cross-repository integration

The test imports `../bitbop-quantum-node/source_payload/index.js` relative to the SecretSender checkout's parent. Place a compatible `bitbop-quantum-node` checkout beside `SecretSender`, install that repository's documented dependencies, and record both commit SHAs. Node must provide `node:sqlite` / `DatabaseSync`; Node 20 alone does not satisfy this test.

```bash
node tests/cross_repo_live_bitbop.test.mjs
```

Read the test before execution if either repository has changed. The checked-in version imports both Workers and constructs local env objects, in-memory storage, test keys and synthetic beacon data. It checks quota, status, PIN handling, two-layer decryption, five-minute same-claimant retry and competing-claimant `409` behavior. A pass does not independently confirm current public deployment or the entropy pipeline.

## Synthetic self-test

On an isolated test target, `POST /api/reflect` accepts JSON actions:

| Action | Input | Effect |
| --- | --- | --- |
| `ping` (default) | `{"action":"ping"}` | Returns edge telemetry; no escrow claim |
| `seal` | `action`, optional test `pin`, embargo/TTL; bearer token or configured `BITBOP_API_KEY` | Creates an internally fixed synthetic envelope; returns `share.escrow_id`, test PIN and fragment-free base URL |
| `claim` | `action`, synthetic `escrow_id` (or fragment-free `claim_url`), test `pin`/`unlock_key` | Checks status, mandatory wrong-PIN `403`, valid reveal/decrypt, local and upstream signatures, distinct-claimant `409` |

The fixed test plaintext is `SYNTHETIC-REFLECTOR-PROBE-V2`; the diagnostic key is 32 zero bytes, encoded as 43 `A` characters. These public constants are for the restricted diagnostic, never normal shares. Caller-supplied `password`, `secret`, `plaintext`, `synthetic_secret`, `link_key` and `link_key_b64u` are rejected, as is any supplied `claim_url` containing `#`. These checks do not establish that a caller-supplied escrow ID was created by the diagnostic. Never point `claim` at a real escrow ID/PIN.

Synthetic `seal` uses `is_sample: false` and normal quota; `claim` consumes that synthetic share. Check HTTP status, `ok === true` and every returned `steps[].passed === true`. An incomplete/failed claim returns a failure (normally `422` for `ok: false`), not a partial success. A `ping` response or an empty set of successful observations is insufficient evidence.

The browser's **Run 45s Sample Demo** is separate: it uses fresh browser encryption and `is_sample: true`. Its label does not force a 45-second embargo. Only synthetic content belongs in demonstrations and UAT. See [external diagnostics](docs/EXTERNAL_AGENT_REFLECTOR_ARCHITECTURE.md).

## Browser acceptance and deployment verification

Use [docs/UAT_PLAN.md](docs/UAT_PLAN.md) to verify the full-link/PIN flow, session expiry, evidence checks and redaction. Inspect network requests to confirm that the normal browser never submits the plaintext or link key; expect same-origin status/reveal/verify traffic. Verify copied/SMS links without truncating the fragment.

The `uat:deterministic`, `uat:model` and `uat:external` package scripts exist, but require a physical device, their configured browser/target and possibly an external model or reflector. The deterministic/model runners and `config/uat.config.json` still contain pre-v1.1 assumptions (blank sender PIN, no explicit sender key, fragment-free claim links or zero same-origin claim requests). Treat them as unvalidated tooling until reconciled. Their existence and old `logs/uat/` reports are not fresh acceptance evidence.

For deployment verification, record the actual deployed version independently, check `/health` and headers, and use dedicated synthetic browser shares on an approved test target. Local suites, a signed receipt or a successful reflector call alone do not establish production correctness, hardware entropy quality or absence of all plaintext leakage.
