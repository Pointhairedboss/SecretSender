# Project: SecretSender BitBop Livery Reskin, Physical S21 UAT & Corporate P2P Assessment

## Architecture
- Single-server Node.js ESM HTTP server (`server.mjs`) serving:
  - Reskinned HTML/CSS/DOM interface adhering to authentic `www.bitbop.dev` design system.
  - Client-side cryptographic bundle (`/mlkem.browser.js`).
  - Static SVG brand assets (`/favicon.svg`, `/badges/*.svg`).
  - API endpoint (`/api/share`) forwarding commits to BitBop hardware escrow (`https://api.bitbop.dev/escrow/commit`).
  - Health check endpoint (`/health`).
- Browser Client Crypto & Telemetry:
  - Local ML-KEM-768 decapsulation & WebCrypto AES-256-GCM decryption.
  - Zero server calls to SecretSender during recipient claim/reveal.
  - White-box UAT flight recorder seam (`window.__uatRecorder`, `window.__uatState()`, `window.__uatBusy()`) gated to dev/localhost or `?uat=1`.
- Testing Infrastructure:
  - Connected physical Samsung Galaxy S21 Ultra (`SM_G998B`, serial `R5CR60QL05P`) via ADB reverse `tcp:5179` and forward CDP `tcp:9222`.
  - Deterministic Playwright-over-ADB verification suite and Model-Driven UAT persona runner saving reports in `logs/uat/`.
  - Independent requirement-driven E2E test suite publishing `TEST_READY.md`.
- Documentation & Engineering Assessment:
  - `docs/UAT_PLAN.md`: formal UAT test plan.
  - `docs/CORPORATE_P2P_CLOUDFLARE_ASSESSMENT.md`: comprehensive corporate P2P Cloudflare engineering assessment.

## Code Layout
- `c:\code\projects\SecretSender\server.mjs`: Node.js HTTP server, routes, HTML/CSS generation, and client-side scripts.
- `c:\code\projects\SecretSender\public\`: Static SVG brand assets (`favicon.svg`, `badges/bitbop-favicon.svg`, `badges/bitbop-wordmark-dark.svg`, `badges/powered-by-bitbop-emerald.svg`, `badges/powered-by-bitbop-gold.svg`).
- `c:\code\projects\SecretSender\docs\UAT_PLAN.md`: Formal UAT test plan document.
- `c:\code\projects\SecretSender\docs\CORPORATE_P2P_CLOUDFLARE_ASSESSMENT.md`: Corporate P2P and Cloudflare assessment report.
- `c:\code\projects\SecretSender\scripts\run_s21_deterministic_uat.ts`: Deterministic Playwright-over-ADB test runner.
- `c:\code\projects\SecretSender\scripts\run_model_uat.ts`: Model-driven UAT persona runner.
- `c:\code\projects\SecretSender\logs\uat\`: Output directory for machine-readable UAT execution reports.
- `c:\code\projects\SecretSender\tests\e2e\`: Requirement-driven E2E test suite.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Single-Server Node Architecture | Lightweight ESM HTTP server in `server.mjs`, zero frontend build step | M1 | ORIGINAL_REQUEST §R1 |
| 2 | Static SVG Brand Asset Serving | Serve `/favicon.svg` and `/badges/*` directly with `image/svg+xml; charset=utf-8` | M1 | ORIGINAL_REQUEST §R1 |
| 3 | BitBop Surface Palette & Patterns | `#0F1012` surface, `#0B0C0E` base, `#16181D`/`#1B1E24` containers, `#262932` borders, `.glider-grid`, `.scanner-line` | M1 | ORIGINAL_REQUEST §R1 |
| 4 | BitBop Action & Telemetry Colors | `#FFD600` primary CTA, `#1A1600` text, `#FFE14D` hover, `2px solid #FFD600` focus outline, `#10B981` emerald, `#F87171` error | M1 | ORIGINAL_REQUEST §R1 |
| 5 | BitBop Typography System | Space Grotesk (headlines/brand), Inter (body), JetBrains Mono (telemetry/countdown/receipts) | M1 | ORIGINAL_REQUEST §R1 |
| 6 | Responsive Admin View (S21) | Admin secret sealing view with 0px horizontal overflow on S21 viewport | M1 | ORIGINAL_REQUEST §R1 |
| 7 | Responsive Claim View (S21) | Recipient claim/countdown view with 0px horizontal overflow on S21 viewport | M1 | ORIGINAL_REQUEST §R1 |
| 8 | ML-KEM-768 & AES-256-GCM Core | Client-side decapsulation, WebCrypto AES-256-GCM decryption, SHA-256 key derivation | M1 | ORIGINAL_REQUEST §R1 |
| 9 | ML-DSA-44 Post-Quantum Provenance | Receipt verification via `POST https://api.bitbop.dev/verify` | M1 | ORIGINAL_REQUEST §R1 |
| 10 | Timelock Embargo & Countdown | Future reveal embargo + 24h countdown clock auto-revealing at `00:00:00` | M1 | ORIGINAL_REQUEST §R1 |
| 11 | Zero Server Request Invariant | Client browser executes reveal directly with BitBop Edge; 0 requests to SecretSender | M1 | ORIGINAL_REQUEST §R1 |
| 12 | Error & Security Invariants | Wrong PIN 403 non-burn; 409 burn-on-read enforcement on re-attempt | M1 | ORIGINAL_REQUEST §R1 |
| 13 | Native SMS Handoff Link | Properly formatted `sms:?&body=...` link | M1 | ORIGINAL_REQUEST §R1 |
| 14 | Formal UAT Test Plan | Publication of structured `docs/UAT_PLAN.md` with test IDs, preconditions, steps, and expected outcomes | M2 | ORIGINAL_REQUEST §R2 |
| 15 | White-Box Flight Recorder Seam | `window.__uatRecorder`, `window.__uatState()`, `window.__uatBusy()`, gated to dev/localhost or `?uat=1` | M2 | ORIGINAL_REQUEST §R2 |
| 16 | Hardware S21 Connectivity & Tunnels | Physical S21 Ultra `R5CR60QL05P` verified; ADB reverse `5179` and forward CDP `9222` | M3 | ORIGINAL_REQUEST §R2 |
| 17 | Deterministic Playwright-over-ADB Suite | Automated verification of all 16 UAT plan test cases on physical device `R5CR60QL05P` | M3 | ORIGINAL_REQUEST §R2 |
| 18 | Model-Driven UAT Persona Loop | Autonomous exploratory testing loop logging DOM telemetry, 0 dead clicks, 0 overflows, 0 errors | M3 | ORIGINAL_REQUEST §R2 |
| 19 | Machine-Readable UAT Reports | Comprehensive JSON reports saved in `logs/uat/` | M3 | ORIGINAL_REQUEST §R2 |
| 20 | Hop-by-Hop Protocol & Port Table | 7-hop network analysis of D-D stack (Cloudflare edge, TURN/STUN, PeerJS, TURNS) | M4 | ORIGINAL_REQUEST §R3 |
| 21 | Enterprise Security Controls Analysis | Detailed analysis of UDP blocking, Symmetric NAT, SWG TLS inspection, reputation filtering, GPOs | M4 | ORIGINAL_REQUEST §R3 |
| 22 | Synchronous vs Store-and-Forward | Operational mismatch analysis (browser tab-open requirement vs multi-day embargo) | M4 | ORIGINAL_REQUEST §R3 |
| 23 | Compatibility Matrix & Recommendations | 5-tier corporate network matrix and Cloudflare deployment architecture recommendations | M4 | ORIGINAL_REQUEST §R3 |
| 24 | E2E Testing Track & Final Verification | Opaque-box test suite publishing `TEST_READY.md`, 100% pass, adversarial hardening, clean audit | M5 | ORIGINAL_REQUEST Acceptance |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | BitBop Livery Reskin & SVG Asset Serving | Reskin `server.mjs`, stage SVGs in `public/`, serve `/favicon.svg` and `/badges/*`, enforce design system, preserve crypto flows | none | DONE |
| M2 | UAT Plan & Flight Recorder Instrumentation | Publish `docs/UAT_PLAN.md`, instrument `window.__uatRecorder`, `window.__uatState()`, `window.__uatBusy()` in `server.mjs` | M1 | DONE |
| M3 | Physical S21 Deterministic & Model-Driven UAT | Implement and execute `scripts/run_s21_deterministic_uat.ts` and `scripts/run_model_uat.ts` on `R5CR60QL05P`, fix bugs, save reports in `logs/uat/` | M1, M2 | DONE |
| M4 | Corporate P2P Cloudflare Assessment | Author `docs/CORPORATE_P2P_CLOUDFLARE_ASSESSMENT.md` with hop table, failure analysis, 5-tier matrix, recommendations | none | DONE |
| M5 | Final Milestone: 100% E2E Pass & Audit | Run full E2E test suite from E2E Track (`TEST_READY.md`), adversarial coverage hardening (Tier 5), forensic integrity audit | M1, M2, M3, M4 | DONE |

## Interface Contracts
### `server.mjs` ↔ Browser Client
- Routes:
  - `GET /`: returns UTF-8 HTML document containing inlined BitBop styles, layout, and client logic.
  - `GET /favicon.svg`: returns SVG icon (`image/svg+xml; charset=utf-8`).
  - `GET /badges/:filename`: returns SVG badge (`image/svg+xml; charset=utf-8`).
  - `GET /mlkem.browser.js`: returns JavaScript bundle (`application/javascript; charset=utf-8`).
  - `GET /health`: returns JSON `{ status: 'ok', service: 'SecretSender' }`.
  - `POST /api/share`: accepts JSON `{ password, unlockKey, unlockAfterSeconds, unlockAtIso }`, commits to BitBop API, returns JSON receipt.

### Browser Client ↔ White-Box Flight Recorder
- `window.__uatRecorder`: recording instance capturing action events, network requests, console errors, navigation.
- `window.__uatState()`: returns `{ view: 'admin'|'claim', escrowId: string|null, timelockActive: boolean, revealed: boolean, burned: boolean, error: string|null }`.
- `window.__uatBusy()`: returns boolean indicating whether pending network calls or cryptographic computations are active.

### Browser Client ↔ BitBop Escrow API (`https://api.bitbop.dev`)
- Direct client-side POST to `https://api.bitbop.dev/escrow/reveal` with `{ escrow_id, kyber_public_key, unlock_key }`.
- Direct client-side POST to `https://api.bitbop.dev/verify` with `{ receipt }`.
- Zero queries sent to SecretSender application server during claim/reveal.
