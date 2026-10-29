# Optional external diagnostic host — not the SecretSender runtime

The SecretSender application is [`worker/index.mjs`](../worker/index.mjs) with Static Assets. This directory's separate `server.mjs` is optional external diagnostic/browser/model tooling; it is not the deleted root Node application server. The [application deployment guide](../docs/DEPLOYMENT.md) is authoritative for v1.1.

## Current interfaces and limits

| Interface | Current purpose / limit |
| --- | --- |
| `POST /reflect` with `ping` | External-host telemetry |
| `POST /reflect` with `seal` / `claim` | Fixed synthetic envelope/key protocol diagnostics; never real secrets |
| `browser_seal` / `browser_claim` | Optional headless browser actions; their paired link-key handoff is incomplete |
| `browser_session` / `hermes_uat` | General browser/model tooling with broader capabilities; not the Worker's restricted synthetic endpoint |

Protocol `seal` constructs Client Envelope v2 with internal `SYNTHETIC-REFLECTOR-PROBE-V2` content and the public fixed diagnostic key, uses a test PIN and `is_sample: false`, and calls the target application's encrypted `/api/share` path. It may use a caller bearer token or configured `BITBOP_API_KEY` and attempts an explicit free-key request if neither is available. Normal quotas and consuming reveal behavior still apply.

`handleReflect` rejects caller-supplied `password`, `secret`, `plaintext`, `synthetic_secret`, `link_key`, `link_key_b64u` and fragment-bearing `claim_url`. Never provide a real share ID/PIN: the restriction does not prove that the ID belongs to the synthetic diagnostic and cannot prevent upstream consumption of a mistakenly supplied share.

**Known browser-tooling discrepancy:** `browser_seal` creates a normal random-key browser share but returns a URL with the fragment removed. `browser_claim` appends the fixed synthetic key. Do not claim this pair validates arbitrary browser-created shares end to end. [TEST_READY.md](../TEST_READY.md) records this and the other verification gaps.

## Configuration reference

The code reads `PORT` (default 8080), `SECRETSENDER_ORIGIN` (default public SecretSender), `BITBOP_API_BASE` (default public BitBop), optional `REFLECTOR_TOKEN` and `BITBOP_API_KEY`, plus its Hermes/model configuration. These settings belong to this diagnostic process, not to the application Worker. Inspect `server.mjs`, `hermes.yaml`, `package.json` and the deployment script before a separately scoped diagnostic-host change.

Existing deployment scripts and Docker files are tooling artifacts, not instructions to publish a production secret-processing service. Provisioning or changing an external host is unnecessary for local regression and is outside this documentation correction. Do not rely on former cost, availability or live-host claims as verified facts.

For the Worker's restricted self-test, use [the diagnostic guide](../docs/EXTERNAL_AGENT_REFLECTOR_ARCHITECTURE.md) and [local verification procedures](../TEST_INFRA.md). Production secret creation and decryption stay in the sender/recipient browsers.
