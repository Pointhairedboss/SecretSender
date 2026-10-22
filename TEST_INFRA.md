# TEST_INFRA.md: E2E Testing Track Architecture & Methodology

**Project**: SecretSender (BitBop Livery Reskin, Physical S21 UAT & Corporate Assessment)  
**Author**: E2E Test Track Architect / Test Writer (`test_writer_e2e_1`)  
**Status**: Active  
**Last Updated**: 2026-10-22  

---

## 1. Testing Philosophy & Principles

The SecretSender E2E Testing Track adheres to an **opaque-box, requirement-driven testing philosophy** designed to rigorously validate functional, cryptographic, stylistic, and invariant contracts without relying on internal implementation details.

### Core Principles
1. **Opaque-Box Verification**: Tests interact strictly with public interfaces (HTTP routes, headers, HTML/CSS DOM structure, WebCrypto and ML-KEM-768 post-quantum cryptographic primitives, and BitBop Escrow API contracts).
2. **Deterministic & Hermetic Execution**: The test harness includes an in-process, high-fidelity mock BitBop Escrow server implementing the complete ML-KEM-768 + AES-256-GCM + ML-DSA-44 protocol. This guarantees 100% reproducible execution offline or in CI without network latency, rate limits, or external server outages, while supporting live API testing via `BITBOP_API_BASE`.
3. **Progressive Testability**: Tests are stratified into 4 tiers so that baseline server and asset capabilities are validated first, followed by edge cases, cross-feature interactions, and full real-world scenarios.
4. **Authoritative Expected Output Derivation**: Expected outputs are derived directly from `ORIGINAL_REQUEST.md`, `PROJECT.md`, and official BitBop design specifications (`c:\code\projects\bitbop-quantum-node\web`), rather than reflecting arbitrary server responses.
5. **Zero-Dependency Lightweight Architecture**: Aligned with SecretSender's single-server ESM architecture, tests utilize Node.js native test runner and assertion libraries (`node:test`, `node:assert/strict`) requiring zero build steps or heavy test frameworks.

---

## 2. 4-Tier Testing Methodology

The test suite is structured around a rigorous 4-tier methodology:

```
+--------------------------------------------------------------------------+
| Tier 4: Real-World Scenarios                                             |
| E2E secret transfer, adversary PIN attack, timelock auto-reveal, S21 UAT |
+--------------------------------------------------------------------------+
                                    ^
+--------------------------------------------------------------------------+
| Tier 3: Cross-Feature Combinations (Pairwise Combinatorial)              |
| Timelock + Wrong PIN, Timelock + Valid Claim, SMS link + Unicode payload |
+--------------------------------------------------------------------------+
                                    ^
+--------------------------------------------------------------------------+
| Tier 2: Boundary & Corner Cases (Boundary Value Analysis)                |
| Empty payloads, max-size secrets, 0s embargo, wrong PINs, double-claims  |
+--------------------------------------------------------------------------+
                                    ^
+--------------------------------------------------------------------------+
| Tier 1: Feature Coverage (Category-Partition Equivalence Classes)         |
| >=5 test cases per core feature: static assets, livery, seal, claim, err |
+--------------------------------------------------------------------------+
```

### Tier 1: Feature Coverage (Category-Partition)
Covers all baseline equivalence partitions across core features with at least 5 distinct test cases per feature category:
- **Category 1A (Static Asset Delivery & HTTP Mime Types)**: Root HTML `/`, client crypto bundle `/mlkem.browser.js`, health check `/health`, SVG icons `/favicon.svg`, brand badges `/badges/*`, and 404 routing.
- **Category 1B (BitBop Livery & Design Tokens)**: Surface palette (`#0F1012`, `#0B0C0E`, `#16181D`), action button colors (`#FFD600`, text `#1A1600`, hover `#FFE14D`), telemetry accents (`#10B981`), typography (`Space Grotesk`, `Inter`, `JetBrains Mono`), and glider-grid / scanner-line styling.
- **Category 1C (Admin Secret Sealing API)**: Payload sealing via `POST /api/share`, custom PIN preservation, auto-generated PIN creation, receipt verification, context hash nonce invariant (zero password entropy leaked).
- **Category 1D (Claim Flow & Post-Quantum Decryption)**: Client ML-KEM-768 keypair generation, public key encoding, decapsulation, AES-256-GCM envelope decryption, and zero SecretSender server request invariant during claim.
- **Category 1E (Error Codes & Security Invariants)**: Missing password (400/500), wrong unlock key (403 non-burn), burned secret (409 burn-on-read), active timelock embargo (425 Too Early).

### Tier 2: Boundary Value Analysis & Edge Cases
Evaluates extreme inputs, resource boundaries, and non-standard states:
- Empty secret string and whitespace-only secret rejection.
- Large payload boundary stress (64KB - 256KB+ secrets) verifying base64 expansion and decryption integrity.
- Zero-second embargo (`unlockAfterSeconds: 0`) and negative embargo duration normalization.
- Long embargo periods (e.g. 30 days) and ISO date string handling.
- Wrong PIN variations (mismatched length, special characters, unicode PINs) proving non-burn behavior.
- Double-claim attempts verifying strict burn-on-read enforcement (first 200, second 409).
- Malformed timestamps and non-JSON request bodies.

### Tier 3: Cross-Feature Combinations (Pairwise Combinatorial)
Validates interactions between disparate system features:
- **Timelock Embargo + Wrong PIN**: Premature unlock attempt with wrong PIN triggers proper status without compromising burn state.
- **Timelock Embargo + Valid Claim**: Countdown expiration auto-transition from locked state to successful reveal.
- **SMS Handoff Link + Mobile Viewport**: Special character URL encoding (`sms:?body=...`) ensuring query strings do not break SMS URI schemes or cause mobile viewport overflow.
- **Custom PIN + Far-Future Embargo + Multi-byte Unicode**: Japanese, emoji, and binary payloads sealed with custom PIN and future unlock timestamp.
- **Flight Recorder Seam + Dev vs Prod Gating**: `window.__uatRecorder` active on localhost or `?uat=1`, correctly reporting busy states and DOM telemetry.

### Tier 4: Real-World Application Scenarios
Simulates realistic end-to-end user journeys and architecture verification:
- **Scenario 1 (Full Secret Transfer Journey)**: Alice seals a database password, copies SMS handoff link; Bob opens claim link on mobile, enters PIN, browser executes client-side ML-KEM-768 + AES-256-GCM decryption, verifies ML-DSA-44 provenance receipt; subsequent claim attempts are rejected.
- **Scenario 2 (Adversary Tamper & Brute-Force Defense)**: Eve intercepts claim URL and tests candidate PINs; receives HTTP 403 without burning the secret; legitimate recipient enters correct PIN and recovers secret; subsequent adversary attempts receive HTTP 409 permanently burned.
- **Scenario 3 (Time-Locked Embargo Countdown & Auto-Reveal)**: Sender schedules a time-locked secret; recipient loads claim page before embargo and sees active countdown; countdown expires (`00:00:00`); client auto-initiates browser decryption and reveals secret.
- **Scenario 4 (Hardware S21 & Corporate Architecture Audit)**: Validates formal assertions for Features 14-23: UAT plan coverage, S21 ADB hardware tunnel configuration, and Corporate P2P / Cloudflare hop table completeness.

---

## 3. Feature Inventory Coverage Table (Features 1-24)

| Feature # | Feature Name | Mapped Test Tier | Test Module | Verification Method |
|:---:|:---|:---:|:---|:---|
| **1** | Single-Server Node Architecture | Tier 1 | `tier1_features.test.mjs` | Spawns `server.mjs` directly with 0 build steps; verifies HTTP listeners, routes, and memory footprint. |
| **2** | Static SVG Brand Asset Serving | Tier 1 | `tier1_features.test.mjs` | Verifies `/favicon.svg` and `/badges/*` return `HTTP 200` with `image/svg+xml; charset=utf-8`. |
| **3** | BitBop Surface Palette & Patterns | Tier 1 | `tier1_features.test.mjs` | Inspects DOM CSS rules for `#0F1012`, `#0B0C0E`, `#16181D`, `#262932`, `.glider-grid`, `.scanner-line`. |
| **4** | BitBop Action & Telemetry Colors | Tier 1 | `tier1_features.test.mjs` | Validates `#FFD600` primary buttons, `#1A1600` text, `#10B981` telemetry, `#F87171` errors, focus outlines. |
| **5** | BitBop Typography System | Tier 1 | `tier1_features.test.mjs` | Validates font imports and styling for `Space Grotesk`, `Inter`, and `JetBrains Mono`. |
| **6** | Responsive Admin View (S21) | Tier 1, 3 | `tier1_features.test.mjs`, `tier3_combinations.test.mjs` | Validates viewport meta tags, max-width constraints (<=480px), and box-sizing rules preventing horizontal overflow. |
| **7** | Responsive Claim View (S21) | Tier 1, 3 | `tier1_features.test.mjs`, `tier3_combinations.test.mjs` | Validates `#claim-view` layout, word-break on monospace secret displays, and viewport boundaries. |
| **8** | ML-KEM-768 & AES-256-GCM Core | Tier 1, 4 | `tier1_features.test.mjs`, `tier4_scenarios.test.mjs` | End-to-end execution of ML-KEM-768 decapsulation and WebCrypto AES-256-GCM decryption with test vectors. |
| **9** | ML-DSA-44 Post-Quantum Provenance | Tier 1, 4 | `tier1_features.test.mjs`, `tier4_scenarios.test.mjs` | Verifies receipt structure (`beacon_sequence`, signature, valid flag) via `POST /verify`. |
| **10** | Timelock Embargo & Countdown | Tier 2, 3, 4 | `tier2_boundaries.test.mjs`, `tier3_combinations.test.mjs`, `tier4_scenarios.test.mjs` | Validates `unlock_after_seconds`, `unlockAtIso`, countdown timer logic, and HTTP 425 responses. |
| **11** | Zero Server Request Invariant | Tier 1, 4 | `tier1_features.test.mjs`, `tier4_scenarios.test.mjs` | Monitors server traffic during claim/reveal to assert zero queries hit SecretSender server. |
| **12** | Error & Security Invariants | Tier 1, 2, 4 | `tier1_features.test.mjs`, `tier2_boundaries.test.mjs`, `tier4_scenarios.test.mjs` | Verifies HTTP 403 (wrong PIN, secret preserved) and HTTP 409 (burn-on-read permanent destruction). |
| **13** | Native SMS Handoff Link | Tier 1, 3 | `tier1_features.test.mjs`, `tier3_combinations.test.mjs` | Validates `sms:?body=...` URI format, encoding of claim URL, PIN, and provenance parameters. |
| **14** | Formal UAT Test Plan | Tier 4 | `tier4_scenarios.test.mjs` | Verifies existence, completeness, test ID coverage, and step definitions in `docs/UAT_PLAN.md`. |
| **15** | White-Box Flight Recorder Seam | Tier 3 | `tier3_combinations.test.mjs` | Validates `window.__uatRecorder`, `window.__uatState()`, `window.__uatBusy()` presence and gating. |
| **16** | Hardware S21 Connectivity & Tunnels | Tier 4 | `tier4_scenarios.test.mjs` | Validates ADB command contracts, reverse tunnel `tcp:5179`, and forward CDP `tcp:9222`. |
| **17** | Deterministic Playwright-over-ADB Suite | Tier 4 | `tier4_scenarios.test.mjs` | Verifies executable test definitions in `scripts/run_s21_deterministic_uat.ts`. |
| **18** | Model-Driven UAT Persona Loop | Tier 4 | `tier4_scenarios.test.mjs` | Verifies model persona runner scripts and telemetry collection logic. |
| **19** | Machine-Readable UAT Reports | Tier 4 | `tier4_scenarios.test.mjs` | Validates JSON report schema, dead click counters, and viewport overflow tracking in `logs/uat/`. |
| **20** | Hop-by-Hop Protocol & Port Table | Tier 4 | `tier4_scenarios.test.mjs` | Validates 7-hop protocol analysis in `docs/CORPORATE_P2P_CLOUDFLARE_ASSESSMENT.md`. |
| **21** | Enterprise Security Controls Analysis | Tier 4 | `tier4_scenarios.test.mjs` | Validates firewall, SWG, TLS inspection, and GPO evaluation in assessment document. |
| **22** | Synchronous vs Store-and-Forward | Tier 4 | `tier4_scenarios.test.mjs` | Validates operational mismatch analysis between WebRTC P2P and timelocked secret escrow. |
| **23** | Compatibility Matrix & Recommendations | Tier 4 | `tier4_scenarios.test.mjs` | Validates 4+ corporate network archetypes and actionable Cloudflare deployment architecture. |
| **24** | E2E Testing Track & Final Verification | Tier 1-4 | `runner.mjs`, `TEST_READY.md` | Orchestrates 100% pass across all test tiers and publishes `TEST_READY.md`. |

---

## 4. Test Directory Layout & Architecture

```
c:\code\projects\SecretSender\
├── TEST_INFRA.md                          # Test track architecture specification (this file)
├── TEST_READY.md                          # Readiness report and execution results
├── package.json                           # Configured with "test": "node tests/e2e/runner.mjs"
└── tests/
    └── e2e/
        ├── harness.mjs                    # Shared test harness (server lifecycle, client crypto, mock BitBop)
        ├── mock_bitbop_server.mjs         # High-fidelity BitBop Escrow API mock (ML-KEM-768, AES-GCM, ML-DSA-44)
        ├── tier1_features.test.mjs        # Tier 1: Core Feature Coverage (>=5 tests per core feature)
        ├── tier2_boundaries.test.mjs      # Tier 2: Boundary Value Analysis & Edge Cases
        ├── tier3_combinations.test.mjs    # Tier 3: Cross-Feature Pairwise Combinations
        ├── tier4_scenarios.test.mjs       # Tier 4: Real-World Scenarios & Architecture Verification
        └── runner.mjs                     # Master test suite runner
```

---

## 5. Execution Instructions

### Running the Entire Suite
```bash
# Using standard npm script:
npm test

# Or invoking the runner directly:
node tests/e2e/runner.mjs
```

### Running Specific Tiers
```bash
node tests/e2e/runner.mjs --tier=1
node tests/e2e/runner.mjs --tier=2
node tests/e2e/runner.mjs --tier=3
node tests/e2e/runner.mjs --tier=4
```

### Running Against Live BitBop API (Optional Override)
```bash
BITBOP_API_BASE=https://api.bitbop.dev node tests/e2e/runner.mjs
```
*(By default, the harness starts an internal high-fidelity mock server for 100% hermetic offline execution).*

---

## 6. Exit Codes & Reporting

- **Exit 0**: All test cases in all configured tiers passed cleanly.
- **Exit 1**: One or more test assertions failed, or an unhandled error occurred during test setup/execution.
- The runner emits structured, colored terminal output with execution timings, per-tier breakdown, and detailed error diagnostics.
