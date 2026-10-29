# SecretSender external diagnostics — v1.1 scope

The production application is the Cloudflare Worker plus Static Assets. External diagnostic/browser tooling is optional and is not another SecretSender deployment runtime. This page replaces the older instructions for copying a removed serverless reflector or deploying a generic plaintext secret endpoint.

## Worker synthetic self-test

`POST /api/reflect` in [`worker/index.mjs`](../worker/index.mjs) exposes `ping`, `seal` and `claim`. It uses **fixed internal synthetic content and a fixed public diagnostic key**. It is not a service for remotely decrypting arbitrary recipient shares.

- `ping` returns edge telemetry without creating or consuming escrow.
- `seal` uses the fixed synthetic payload/key, a test PIN and optional policy parameters. It creates a normal-quota share (`is_sample: false`) using the caller's bearer token or configured `BITBOP_API_KEY`.
- `claim` takes the **synthetic** escrow ID (or fragment-free URL) and test PIN. It must pass non-consuming status, mandatory wrong-PIN `403`, valid synthetic decryption, local and upstream signature verification, and distinct-claimant `409`. Every recorded step must pass.
- Caller-supplied `password`, `secret`, `plaintext`, `synthetic_secret`, `link_key` and `link_key_b64u` are rejected with `400`, as is a `claim_url` containing `#`.
- These restrictions do not validate ownership of a supplied escrow ID. A real share can be consumed before fixed-key decryption fails. Never pass real shares, real recipient PINs or full fragment links to diagnostics.

Use [TEST_INFRA.md](../TEST_INFRA.md) for the precise constants, procedure and evidence limits. A self-test consumes its synthetic share and can use real quota if aimed at a public upstream. Prefer an isolated test environment.

## Optional Cloud Run tooling

[`cloudrun-reflector/`](../cloudrun-reflector/README.md) remains in the repository as an external diagnostic host with a Node process and headless-browser/model tooling. Its `POST /reflect` protocol actions are distinct from the Worker's `POST /api/reflect`.

Its protocol `seal`/`claim` use the fixed synthetic envelope/key and reject the same top-level secret/key fields and fragment-bearing `claim_url`. The optional browser actions require separate review: `browser_seal` discards the browser's random link-key fragment in its response, while `browser_claim` appends the fixed diagnostic key. They do not currently form a valid paired handoff for shares made with the normal browser's random key.

`scripts/run_external_s21_reflector_uat.mjs` exists and uses `UAT_REFLECTOR_URL` (defaulting to the public SecretSender `/api/reflect`) and a physical device. It can create/consume test shares, mint/use credentials and run external browser/model operations. Read and configure it before any separately authorized test run; it is not a passive health check, and its existence is not fresh evidence of success.

The generic browser/session/model actions are not covered by the Worker's fixed-payload guarantee. Do not treat rejection of a few top-level fields as an arbitrary-script security boundary. Keep this tooling isolated from real secret handling.

No Cloud Run service, public reflector, API key or entropy collector needs to be deployed, replaced or modified to run the isolated local regression suite. See [deployment guidance](DEPLOYMENT.md) for the actual application runtime.
