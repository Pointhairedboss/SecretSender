# SecretSender v1.1 verification status and follow-up findings

This page records the limits of the available evidence; it is not a production-readiness declaration. The documentation review on 30 October 2026 used main commit `16921db57c285cd3fcdebd72243f04a1d7fb6557`, after Remediation v1.1 and the `run_worker_first` follow-up. Runtime, dependency and cryptographic code are unchanged by this documentation PR.

## Previously reported evidence

[PR #1](https://github.com/Pointhairedboss/SecretSender/pull/1) reports **61 passing E2E tests, 195 verification checks, 92 adversarial tests**, and successful cross-repository testing. Those are the merged PR's reported results, not independent confirmation of today's production deployment. Older 62-test readiness claims and stored S21 reports predate the remediation and do not describe this release.

## Checks performed for this documentation review

The local environment used Node `24.22.1`. Dependencies were installed with `npm install --package-lock=false --ignore-scripts --no-audit --no-fund` after reproducing the committed lockfile failure. No dependency/lockfile changes are included.

| Check | Observed result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` (with bounded fetch options) | Failed: lockfile missing `@noble/post-quantum@0.6.1` and transitive entries |
| `npm run build:cf` | Passed |
| `npx wrangler deploy --dry-run` with a temporary output directory | Passed with Wrangler `4.156.0`; bundle/static-assets and declared bindings inspected; no publish |
| `node tests/verify_m1_challenger2.mjs` | **195/195 passed** locally |
| `node --test --test-reporter=tap tests/adversarial_challenge_m1.test.mjs` | **92/92 passed** locally |
| `npm test` | Failed on missing Chromium/Chrome for the browser case; its reporter-dependent summary showed `0/0` counts |
| Direct E2E files with explicit TAP and `--test-concurrency=1` | **60/61 passed**; the headless-browser case failed because no supported browser executable was available |
| Direct E2E files with default file concurrency | **59/61 passed**; browser unavailable plus the test upstream's concurrent-claim race described below |
| `npx playwright install chromium` | Failed: downloaded archives could not be unpacked (truncated/invalid ZIP); no browser E2E pass claimed |
| Signature-verifier probe with ephemeral test keys | Both Worker and browser-bundle verifiers accepted signed v2 evidence without a delivery signature or envelope commitment |
| Envelope-size probe with synthetic content | Worker validator accepted an encrypted 513-byte plaintext equivalent, above the sender UI's 512-byte limit |

The cross-repository test was inspected but not rerun: a matching sibling BitBop checkout was not present. No production endpoints were used for escrow tests; no production keys, deployment or entropy-pipeline state were changed. A Wrangler dry run is a local packaging check, not remote readiness evidence.

## Implementation and tooling discrepancies to review separately

These findings explain the documentation's qualifications. They are not cryptographic changes or claims of a demonstrated production exploit.

| Finding | Source / evidence | Consequence |
| --- | --- | --- |
| Clean install is blocked; declared Node minimum is too low for a dependency | `package-lock.json` omits the Noble dependency declared by `package.json`; installed `@noble/post-quantum@0.6.1` requires Node >=20.19.0 | Repair lockfile/runtime requirements separately. The documented install workaround is for local development, not a reproducible release |
| The local upstream has a concurrent-claim race | `tests/e2e/harness.mjs` checks `rec.claimed`, awaits KEM/encryption, then sets it. Under file-parallel E2E execution, B4.1 observed `[200,200]` instead of `[200,409]`; the serial-tier run passed that case | The test double does not reliably model atomic consumption. This observation does not establish whether the production coordinator has the same race |
| The displayed “QR Code” is not a complete QR encoder | `createLocalQrSvgElement` in `scripts/client_template.mjs` repeats input bits into a fixed matrix with finder-like patterns, without QR data framing, error correction or format/version encoding. The browser test checks SVG presence, not successful decoding | Do not advertise scan interoperability. Use copied/SMS links pending a real encoder and decoder-based acceptance check; no camera decode was performed in this review |
| V2 receipt fields are not all mandatory | `verifyReceiptSignatureInWorker`, browser `verifyReceiptSignature` and the recipient reveal path accept legacy signed layouts; delivery-signature and envelope-commitment checks run only when the relevant fields exist. A test-key probe confirmed verifier acceptance with those v2 fields absent | Local signature success alone is not proof that every advertised v2 delivery/integrity field was required. Review the intended receipt schema separately |
| Browser and Worker payload limits differ | Sender checks 1–512 UTF-8 bytes; `validateAndCanonicalizeEnvelopeV2` accepts 17–700 decoded ciphertext bytes and at most 1536 serialized envelope bytes | A direct client can submit more than the browser limit. A synthetic 513-byte equivalent was accepted by the validator |
| Five-minute session expiry is checked on use, not by timed erasure | `initRecipientFragmentAndSession` and `performDirectBrowserReveal` compare `saved_at_ms`; no five-minute cleanup timer is installed | Do not promise that idle tab storage is physically cleared at precisely five minutes. Long embargo waits require reopening the original link |
| Older device/model UAT tooling still assumes the old workflow | `scripts/run_s21_deterministic_uat.mjs` expects a blank sender PIN to succeed and zero same-origin claim requests; model/config paths omit explicit credentials/PIN and construct fragment-free claims | The rewritten UAT plan describes current acceptance criteria; these older runners are not certified implementations of it |
| Optional Cloud Run browser actions do not form a working paired handoff | `cloudrun-reflector/server.mjs` `browser_seal` uses the normal browser's fresh random key but removes the fragment from its returned URL; `browser_claim` appends the fixed synthetic key | Do not claim those actions validate arbitrary browser-created shares end to end. Use protocol-synthetic checks or the local browser E2E case pending a separate tooling repair |
| Sample-demo label is not enforced timing | `sample-demo-btn` calls `executeSenderSeal(true)` with the currently selected embargo | “Run 45s Sample Demo” is a button label, not a guaranteed 45-second delay |
| Test summaries depend on the reporter | `tests/e2e/runner.mjs` parses TAP counters; this Node environment selected spec output by default | Use explicit TAP and exit status for reliable counts |

The synthetic reflector also accepts a caller-supplied escrow ID/PIN without proving that the ID belongs to an internally created diagnostic. Its fixed-key decryption can fail **after upstream consumption** if misused on another share. Keep real shares away from all reflector actions; the input-field restrictions are not a synthetic-share ownership check.

## What remains unverified

Current public deployment SHA/configuration; production browser behavior; upstream physical entropy quality; operational erasure beyond the service's recorded policy; external Cloud Run/hardware S21 UAT; and the compatibility of an independently selected current BitBop checkout. Use [TEST_INFRA.md](TEST_INFRA.md) and [docs/UAT_PLAN.md](docs/UAT_PLAN.md) for bounded follow-up verification.
