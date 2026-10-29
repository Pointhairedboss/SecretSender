# SecretSender v1.1 browser acceptance plan

This plan supersedes the pre-remediation Node-server and direct-to-BitBop browser requirements. It is a **plan**, not an executed sign-off. The older physical-device and model-driven scripts still need reconciliation ([known gaps](../TEST_READY.md)); they are not an automated implementation of every case below.

Use [deployment setup](DEPLOYMENT.md), [the current protocol](../README.md) and [verification procedures](../TEST_INFRA.md). Test only synthetic content on an isolated compatible upstream. Record SecretSender and upstream revisions, dependency/browser versions, target origin, time and test-key identity. Never capture real PINs, full claim links, API keys or secrets in shared reports.

## Test setup

1. Build/start the Worker with the documented dependencies and a compatible **test** BitBop service binding/upstream. Verify that neither defaults nor configured bindings lead escrow requests to production.
2. Install Chromium for local E2E. The existing automated browser case is `tests/e2e/tier4_scenarios.test.mjs` scenario S4; run it through the local harness as described in [TEST_INFRA.md](../TEST_INFRA.md).
3. For manual browser checks, use HTTPS or `http://localhost:5179` and supply an explicit test sender key/PIN, or use the browser's synthetic sample path. Ordinary sharing never auto-generates a PIN from an empty field.
4. Optionally use an authorized Android device with `adb -s <serial> reverse tcp:5179 tcp:5179`. For CDP, use `adb -s <serial> forward tcp:9222 localabstract:chrome_devtools_remote`. No physical device or prior device report is assumed to be available.
5. Use fresh synthetic shares for consuming cases. Keep the **original full link** in private test memory; the claim-page address bar loses its fragment by design.

## Browser seams and reporting

On localhost/127.0.0.1 or with `?uat=1`, inspect `window.__uatRecorder`, `window.__uatState()` and `window.__uatBusy()`. Use the busy seam to synchronize observations. `secretPlaintext` in state is `"[REDACTED]"` after reveal, not a source from which to extract a test secret. Inspect DOM values only inside the test and redact exports.

Capture status codes and safe state transitions. Assert that request bodies, console output and exported recorder logs do not disclose synthetic plaintext, PIN, API bearer tokens, fragment key or private claimant key. Same-origin API requests are expected; the absence of all application-server requests is no longer a requirement.

## Acceptance matrix

The established case IDs are retained for traceability; their expectations now follow Client Envelope v2.

| Case | Action | Expected result |
| --- | --- | --- |
| UAT-LIV-01 | Inspect computed theme tokens | Brand colors and usable focus states |
| UAT-LIV-02 | Fetch favicon/badges/crypto bundle | Correct content types; no source/config disclosure |
| UAT-LIV-03 | Inspect visual grid/scanner styling | Layout remains usable; visual checks do not establish cryptographic security |
| UAT-VIEW-01 | Sender at 412×915 | No horizontal overflow; key, mandatory PIN and retention controls usable |
| UAT-VIEW-02 | Recipient at 412×915 | Full link initializes; PIN/reveal controls usable |
| UAT-VIEW-03 | Both views at 384×800 | Content wraps without hiding required controls |
| UAT-VIEW-04 | Desktop at 1440×900 | Readable centered layout |
| UAT-SEAL-01 | Try blank PIN, then click Generate 8-Char PIN and seal with a test key | Blank PIN refused locally; explicit generation produces a PIN; outgoing body has v2 encrypted envelope, no secret or link key |
| UAT-SEAL-02 | Custom trimmed PIN and 30-second embargo | Mandatory PIN preserved; worker returns policy timestamps and verifies creation receipt |
| UAT-SEAL-03 | Future date within six days; also try beyond six days | Allowed delay recorded; excessive embargo refused; TTL leaves at least one hour after unlock |
| UAT-SEAL-04 | Empty or >512-byte UTF-8 secret | Refused before sharing; check multibyte byte counts |
| UAT-TIME-01 | Open a complete timelocked link | Non-consuming GET status; availability time displayed; premature reveal is 425 without consumption |
| UAT-TIME-02 | Inspect final-day countdown | HH:MM:SS display; test with fresh session instead of assuming an idle session lasts 24 hours |
| UAT-TIME-03 | Enter valid PIN; wait for a short embargo to end | Automatic reveal only while the five-minute claim session is valid; expiry requires original link |
| UAT-AUTH-01 | Send a wrong PIN on a fresh test share | 403, no burn; backoff may return 429, no burn |
| UAT-AUTH-02 | Enter the correct PIN after a wrong attempt | Successful reveal while session remains valid |
| UAT-CRYPTO-01 | Reveal through same-origin Worker | ML-KEM outer unseal yields the inner envelope; HKDF/AES-GCM with fragment key yields exact original UTF-8 content |
| UAT-CRYPTO-02 | Verify response and download receipts | Browser-local and Worker/upstream checks succeed; tampered signatures fail; validate commitment when present; record conditional-field gap rather than assume all v2 fields are mandatory |
| UAT-CRYPTO-03 | Use a synthetic HTML/script-like secret | Displayed as inert text; no script execution |
| UAT-BURN-01 | Reveal; repeat with a distinct claimant | New claimant gets 409; same claimant/key may receive the identical encrypted response within upstream's five-minute retry window |
| UAT-BURN-02 | Open an already consumed or expired share | Non-consuming status handles burned/expired state; clear claim session and disable inappropriate reveal |
| UAT-NET-01 | Observe normal create/status/reveal/verify traffic | Same-origin `/api/*` requests present; no normal request carries plaintext secret or fragment link key |
| UAT-SMS-01 | Inspect copy/SMS actions | Full `#link_key` link preserved, PIN copied separately; SMS does not include PIN; app makes no external QR-rendering request |

## Additional v1.1 boundary cases

- Missing, malformed or truncated fragment: fail closed before any escrow status/reveal request. A syntactically valid but wrong key may fail **after consumption**; use only expendable shares.
- Refresh within five minutes: restore `link_key_b64u`, `claim_id`, `kyber_pk_hex`, `kyber_sk_b64u` and `saved_at_ms` from tab-scoped `ss_claim_<escrow_id>` storage. A different tab without that state must use the original full link.
- Expired session: initialization/reveal rejects stale state; reopening the original link restores the intended path. Check-on-use expiry is not timer-driven physical deletion.
- Success, terminal status and post-consumption decryption/verification errors: stored claim state is cleared. Wrong-PIN/backoff/embargo paths can retain it for bounded retries.
- No sender bearer token for ordinary sharing: `401`. Explicit trial key mint and key-status checks use same-origin routes; sample credentials do not silently authorize normal shares.
- API boundary checks: malformed envelope/forbidden top-level plaintext fields/PIN outside 4–64 → `400`; wrong methods → `405`; unknown API route → `404`.
- Creation/reveal receipt downloads: ensure no plaintext, PIN or link key is included. The normal download exports the evidence receipt, not necessarily the full delivery response.
- Recorder and DOM: exported telemetry redacts credentials and content; revealed plaintext remains visible/copyable in the DOM, so key cleanup is not erasure of all browser data.
- SVG handoff graphic: presence/size is not a QR scan test. The current generator lacks standard QR encoding; do not sign off QR interoperability without a separate real decoder-based test and implementation repair.

## Acceptance record

Record every case as passed, failed or not run with supporting redacted evidence. Record code-inspected assertions separately from executed browser checks. A full gate requires successful build, meaningful explicit-TAP test results, the actual browser case, and resolved or explicitly accepted discrepancies. PR #1's reported totals, a local `/health` response, a successful synthetic reflector call or historical S21 logs do not establish the current production deployment's correctness.
