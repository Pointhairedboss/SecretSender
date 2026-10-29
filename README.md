# SecretSender

SecretSender shares a one-time secret through a browser-encrypted **Client Envelope v2** and BitBop escrow. Remediation v1.1 was merged in [PR #1](https://github.com/Pointhairedboss/SecretSender/pull/1) on 27 October 2026.

The application runtime is [`worker/index.mjs`](worker/index.mjs), with Cloudflare Static Assets built from [`scripts/client_template.mjs`](scripts/client_template.mjs). There is no standalone Node application server. Start with the [deployment guide](docs/DEPLOYMENT.md); use [TEST_INFRA.md](TEST_INFRA.md) for verification and [TEST_READY.md](TEST_READY.md) for evidence limits and known discrepancies.

## Sender and recipient workflow

1. The sender enters or explicitly mints a BitBop API key in the browser. Ordinary sharing requires that key as a bearer token. A key is not automatically provisioned at application startup.
2. The sender enters a secret of **1–512 UTF-8 bytes**, supplies a **mandatory 4–64-character PIN**, or clicks **Generate 8-Char PIN**, and chooses retention and an optional embargo. PINs are trimmed before validation; they are strings, not numeric codes.
3. The browser generates a random 32-byte link key and encrypts the secret locally with HKDF-SHA256 and AES-256-GCM. Only the resulting envelope, PIN and policy parameters go to `POST /api/share`.
4. The Worker commits that encrypted envelope to BitBop with `escrow_profile: "secretsender-v2"`, `reveal_policy: "once"` and `idempotency_key` equal to the envelope's `share_id`. It verifies the creation response locally and through BitBop `/verify` before returning a fragment-free `base_claim_url`.
5. The sender's browser appends `#<43-character unpadded Base64URL link key>` locally. **Copy Claim Link** and **Send via SMS** carry the complete link. **Copy PIN Separately** supplies the PIN for a separate channel; the SMS body says to share the PIN separately and does not include it. The rendered SVG handoff graphic has a known QR encoding gap; use the copied link or SMS, not an assumed working QR scan ([details](TEST_READY.md)).
6. The recipient opens the original complete link. The browser removes the valid fragment from the address bar with `history.replaceState`, generates or restores an ephemeral ML-KEM-768 claimant keypair and `claim_id`, and stores claim state in tab-scoped `sessionStorage` with a **five-minute validity window**, checked on initialization and reveal rather than erased by a timer.
7. A non-consuming `GET /api/escrow/status` checks availability, profile and PIN requirements. The recipient enters the PIN; `POST /api/escrow/reveal` sends the PIN, `claim_id` and public key, never the link key. The browser verifies the response, unseals BitBop's outer envelope, and decrypts the inner Client Envelope v2 locally.
8. Successful decryption clears the stored claim state and offers a JSON evidence receipt. Terminal status responses also clear it; after a successful upstream reveal, subsequent verification/decryption errors clear it too. Wrong PIN (`403`), backoff (`429`) and embargo (`425`) allow retry while the session remains fresh. After five minutes, reopen the **original complete link**, including its fragment.

A timelocked page shows the availability time and a countdown during the final 24 hours. Automatic reveal at zero requires a valid entered PIN and an unexpired claim session. An hours-long countdown does not extend the five-minute session.

BitBop enforces release, expiry, PIN throttling and competing-claimant rejection. The cross-repository contract includes a five-minute retry of the **same encrypted delivery** for the same claimant; a different claimant gets `409` after consumption. “One-time” does not mean every repeated HTTP request must return `409`. A successful upstream reveal can consume the share even if the browser subsequently fails verification or decryption. Retain the original link until delivery is complete.

## Security boundaries and evidence

The **link key encrypts the content**. The **PIN authorizes escrow release**; it is not the inner encryption key. Normal application requests do not send the plaintext secret or link key to SecretSender or BitBop. URL fragments are omitted from HTTP requests, but remain sensitive wherever the full link is copied, messaged or exposed to browser software.

The Worker and BitBop see the PIN, sender bearer token where used, encrypted envelope and request metadata. The browser currently remembers the sender API key in `localStorage`. Recipient claim material, including the link key and ephemeral private key, is temporarily in `sessionStorage`. This is not a zero-storage system: BitBop stores escrow/delivery state and browsers hold keys and displayed plaintext. Browser-origin script integrity, device security, TLS and upstream policy enforcement remain trust boundaries; burn-on-read cannot erase copies already made.

Creation succeeds only when Worker-local ML-DSA-44 verification **and** upstream verification succeed, followed by a browser-local signature check. Reveal requires browser-local verification **and** `/api/escrow/verify` success; that Worker route combines its own local verification with upstream `/verify`. Public release keys are pinned under `mldsa44-release-2026-01` in the Worker and browser crypto bundle.

The sender can download the creation evidence receipt; the recipient can download the reveal evidence receipt. These signatures authenticate the issuer's recorded entropy-lineage, envelope-commitment and release-policy claims. They do not establish the truth or safety of the secret, independently certify hardware quality, or prove erasure of every copy. The current verifiers accept legacy signed receipt layouts too; delivery signatures and envelope-commitment checks are conditional on their fields being present ([verification gaps](TEST_READY.md)). Preserve a full delivery response separately if an audit requires its delivery-signature binding; the download button normally exports the inner evidence receipt only.

## HTTP routes

Browser operations use **same-origin SecretSender routes**, which call BitBop through `BITBOP_API` when bound, otherwise HTTPS at `BITBOP_API_BASE` (default `https://api.bitbop.dev`). There is no “zero requests to SecretSender during reveal” invariant.

| Route | Method | Purpose / upstream |
| --- | --- | --- |
| `/`, `/index.html` | GET, HEAD | Generated sender/claim UI; `?escrow_id=...` selects claim mode |
| `/mlkem.browser.js`, `/favicon.svg`, `/badges/*` | GET, HEAD | Static browser crypto and brand assets |
| `/health` | GET, HEAD | Local health: `{"status":"ok","service":"SecretSender","profile":"secretsender-v2"}`; does not test BitBop |
| `/api/share` | POST | Validate Client Envelope v2, commit to `/escrow/commit`, verify receipt |
| `/api/keys/free` | POST | Explicit user-initiated free-key request to `/api/keys/free` |
| `/api/key-status` | GET | Forward bearer token to `/api/keys/status` |
| `/api/escrow/status?escrow_id=...` | GET | Non-consuming `/escrow/status` query |
| `/api/escrow/reveal` | POST | Forward claimant request to `/escrow/reveal` |
| `/api/escrow/verify` | POST | Worker-local signature check plus upstream `/verify` |
| `/api/reflect` | POST | Restricted synthetic diagnostic only; see below |

Wrong methods return `405` with `Allow`; unknown `/api/*` routes return `404`. Worker checks deny traversal patterns and selected source/config paths. API JSON and the root/index HTML responses use `Cache-Control: no-store`; the Worker also adds CSP, `Referrer-Policy: no-referrer` and other security headers. Other static-asset caching follows the asset response. Keep `assets.run_worker_first: true` so these guards apply before static delivery.

## Client Envelope v2 integration contract

`POST /api/share` takes JSON. Real sharing requires `Authorization: Bearer <sender-key>`.

| Field | Requirement |
| --- | --- |
| `client_envelope` | Object in the canonical form below |
| `unlockKey` | Required string with `trim().length` of 4–64 (JavaScript UTF-16 code units); `unlock_key` is also accepted |
| `unlockAfterSeconds` | Optional number, 0–518400 (six days), floored; otherwise `unlockAtIso` can specify an ISO date/time |
| `ttlSeconds` | Optional number, 60–604800 (seven days), floored; raised as needed to at least embargo + 3600 seconds |
| `is_sample` | Only literal `true` selects the sample path; omit or use `false` for ordinary sharing |

The canonical envelope fields, in serialization order, are:

| Field | Value |
| --- | --- |
| `v` | `2` |
| `share_id` | UUID v4 generated for this envelope |
| `alg` | `"AES-256-GCM"` |
| `kdf` | `"HKDF-SHA256"` |
| `salt_b64u` | 16 random bytes, 22 unpadded Base64URL characters |
| `nonce_b64u` | 12 random bytes, 16 unpadded Base64URL characters |
| `ciphertext_b64u` | Ciphertext including the 128-bit GCM tag, unpadded Base64URL |

Derive a 256-bit AES key from the random 32-byte link key using HKDF-SHA256, the envelope salt, and UTF-8 info `secretsender:envelope:v2:aes256gcm`. The UTF-8 GCM additional authenticated data is `secretsender:envelope:v2:<share_id>:<salt_b64u>:<nonce_b64u>`. Encrypt the UTF-8 secret with the envelope nonce and a 128-bit tag. Match the browser implementation; do not substitute the PIN or BitBop entropy for the link key.

The Worker serializes the canonical envelope with `JSON.stringify`, limits it to 1536 UTF-8 bytes, hashes it as `context_hash: "sha256:<hex>"`, and submits its Base64 encoding as `seal_payload_b64`. It sets upstream idempotency from `client_envelope.share_id`; a top-level `idempotency_key` is not the source of that value. Reuse the same encrypted envelope/share ID when retrying its commit.

Top-level `password`, `secret` or `plaintext` fields return `400`. There is no supported plaintext share endpoint. The browser limits secrets to 512 UTF-8 bytes; the Worker currently permits a wider 17–700-byte ciphertext range, a discrepancy recorded in [TEST_READY.md](TEST_READY.md).

UI retention presets are **24 hours, three days and seven days** (default seven days); ordinary API requests without a TTL default to 24 hours. The sample path defaults to at least one hour. Embargo and retention are separate settings, and the Worker can extend retention to leave at least one hour after unlock.

## Sample demo versus restricted synthetic self-test

The **Run 45s Sample Demo** button uses the normal browser encryption path, a browser-generated link key and `is_sample: true`. It can use `BITBOP_SAMPLE_API_KEY`, falling back to `BITBOP_API_KEY` when no sender bearer token is provided. The button label is not an execution-time guarantee; the current handler uses the selected embargo rather than forcing 45 seconds. Upstream code controls sample eligibility and quota accounting.

`POST /api/reflect` is a different, server-executed **synthetic self-test**. Its `ping`, `seal` and `claim` actions use a fixed internal diagnostic plaintext and a fixed public test link key. It rejects caller-supplied `password`, `secret`, `plaintext`, `synthetic_secret`, `link_key`, `link_key_b64u`, and `claim_url` values containing `#`. This guard is not proof that any supplied escrow ID belongs to a synthetic share: never give it a real share's ID or PIN.

Synthetic sealing uses `is_sample: false` and normal quota. Claiming checks non-consuming status, a mandatory wrong-PIN `403`, synthetic decryption, signatures, and a second distinct-claimant reveal returning `409`; all recorded steps must pass. It consumes its test share and does not prove production browser confidentiality or hardware entropy quality. See the [diagnostic guide](docs/EXTERNAL_AGENT_REFLECTOR_ARCHITECTURE.md). No production health check should claim a real secret.
