# SecretSender: Formal User Acceptance Testing (UAT) Plan & Hardware Verification Specification

**Document Version**: 2.0.0  
**Target Application**: SecretSender (`c:\code\projects\SecretSender`)  
**Architecture**: Single-Server Node.js (`server.mjs`) + Post-Quantum Browser Decapsulation (`mlkem.browser.js`)  
**Hardware Verification Target**: Physical Samsung Galaxy S21 Ultra 5G (`SM_G998B`, serial `R5CR60QL05P`)  
**Author**: Worker M2 1 (UAT Plan & Flight Recorder Worker)  
**Status**: APPROVED & PUBLISHED FOR MILESTONE M2 / M3  

---

## 1. Executive Summary & Verification Scope

This document specifies the formal User Acceptance Testing (UAT) plan for **SecretSender**, reskinned in the authentic `www.bitbop.dev` visual livery and instrumented with a deterministic white-box flight recorder and busy seam (`window.__uatRecorder`, `window.__uatState()`, `window.__uatBusy()`).

The UAT harness executes against two complementary layers:
1. **Deterministic Playwright-over-ADB/CDP Suite**: End-to-end verification of cryptographic flows, HTTP response codes, timing embargoes, and DOM states directly on the physically connected Samsung Galaxy S21 Ultra.
2. **Autonomous Model-Driven UAT Persona Loop**: Exploratory agent interaction via DOM affordances, asserting zero dead clicks, zero viewport horizontal overflows, and zero unhandled exceptions.

### 1.1 Scope Boundaries & Core Invariants
- **Livery Fidelity**: Verifiable compliance with the BitBop design system (colors, typography, badges, radial grid, scanner telemetry).
- **Viewport Integrity**: Zero horizontal overflow (`document.documentElement.scrollWidth <= window.innerWidth`) on mobile viewports ranging from 384px to 412px, specifically calibrated for Samsung Galaxy S21 Ultra.
- **Post-Quantum Cryptography**: NIST FIPS 203 ML-KEM-768 client-side decapsulation, WebCrypto AES-256-GCM transit and envelope decryption, and NIST FIPS 204 ML-DSA-44 receipt verification.
- **Security & Privacy Invariants**:
  - **Zero App-Server Queries During Claim**: 100% of recipient operations communicate directly with BitBop Edge (`https://api.bitbop.dev`); zero requests are sent to the SecretSender host.
  - **Wrong PIN 403 Non-Burn**: An incorrect unlock key returns HTTP 403 and does NOT burn the escrow.
  - **Burn-on-Read 409 Replay Enforcement**: Once unsealed, any subsequent reveal attempt yields HTTP 409 and cannot retrieve data.
  - **Timing Embargo**: An escrow with an active unlock embargo yields HTTP 425, display of the 24h countdown clock, and automatic decapsulation when the clock reaches `00:00:00`.

---

## 2. Hardware Test Bed & Physical Device Configuration

### 2.1 Physical Device Specification
| Parameter | Value | Verification Reference |
|---|---|---|
| Device Model | Samsung Galaxy S21 Ultra 5G (`SM_G998B`) | `adb devices -l` |
| ADB Serial | `R5CR60QL05P` | USB 3.0 Direct Connection |
| Device State | `device` (Authorized) | `adb get-state` |
| Native Display Resolution | 1440 x 3200 (WQHD+) / 1080 x 2400 (FHD+) | Display Settings |
| Android Chrome Viewport | **412px** (width) x **915px** (height) | `window.innerWidth` x `window.innerHeight` |
| Compact Android Viewport | **384px** (width) x **800px** (height) | Minimum supported small-phone profile |
| Chrome Browser Version | `Chrome/155.0.8059.84` (V8 `15.5.35.25`) | CDP `/json/version` |
| CDP Remote Socket | `@chrome_devtools_remote` | Android abstract UNIX socket |

### 2.2 USB Tunnel Setup & Pre-Flight Execution
Before executing any UAT suites, the host workstation establishes the bidirectional tunnels:
```bash
# 1. Reverse tunnel: Android Chrome -> Workstation SecretSender Server (Port 5179)
# Note: Chrome treats http://localhost as a W3C Secure Context (required for crypto.subtle)
adb -s R5CR60QL05P reverse tcp:5179 tcp:5179

# 2. Forward tunnel: Workstation Playwright -> Android Chrome DevTools (Port 9222)
adb -s R5CR60QL05P forward tcp:9222 localabstract:chrome_devtools_remote

# 3. Screen wake, keep-awake, and unlock keyguard
adb -s R5CR60QL05P shell svc power stayon usb
adb -s R5CR60QL05P shell input keyevent KEYCODE_WAKEUP
adb -s R5CR60QL05P shell wm dismiss-keyguard

# 4. Launch Android Chrome pointing to SecretSender UAT entrypoint
adb -s R5CR60QL05P shell am start -n com.android.chrome/com.google.android.apps.chrome.Main -d "http://localhost:5179/?uat=1"
```

---

## 3. White-Box Flight Recorder & Seam Specification

SecretSender exposes three global synchronization and telemetry primitives on `window` (active on `localhost`, `127.0.0.1`, or when query parameter `?uat=1` is present):

### 3.1 Global Seam Primitives
1. `window.__uatBusy()`: Returns `true` if any network request (`window.fetch`) or cryptographic operation (ML-KEM key generation, decapsulation, AES-GCM decryption, receipt verification) is in flight. Used by test runners for deterministic synchronization without arbitrary sleeps.
2. `window.__uatState()`: Returns an instantaneous snapshot of application state:
   ```json
   {
     "view": "admin" | "claim",
     "escrowId": "string" | null,
     "timelockActive": boolean,
     "remainingSeconds": number | null,
     "revealed": boolean,
     "burned": boolean,
     "error": "string" | null,
     "secretPlaintext": "string" | null
   }
   ```
3. `window.__uatRecorder`: In-memory ring buffer tracking up to 5,000 events:
   - `{ t, type: 'action', name: 'click'|'input'|'navigation', target: string, payload?: any }`
   - `{ t, type: 'network', method: string, url: string, status: number, ok: boolean, ms: number, error?: string }`
   - `{ t, type: 'state', label: string, summary?: any }`
   - `{ t, type: 'hold', id: string, on: boolean, heldMs?: number, why?: string }`
   - `{ t, type: 'error', where: 'window'|'promise'|'console', message: string, stack?: string }`

---

## 4. Structured UAT Test Matrix (8 Operational Areas)

The test matrix comprises 23 test specifications across all 8 operational areas.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SECRET SENDER UAT MATRIX                        │
├────────────────────────────────────────────────────────────────────────┤
│ Area 1: Livery Tokens & BitBop Brand Identity        (UAT-LIV-01..03)  │
│ Area 2: Mobile Viewport & Responsive Geometry        (UAT-VIEW-01..04) │
│ Area 3: Admin Secret Sealing                         (UAT-SEAL-01..04) │
│ Area 4: Timelock Embargo & 24h Countdown Auto-Reveal (UAT-TIME-01..03) │
│ Area 5: Wrong PIN 403 Non-Burn Preservation          (UAT-AUTH-01..02) │
│ Area 6: ML-KEM-768 Decrypt & ML-DSA-44 Verification  (UAT-CRYPTO-01..03│
│ Area 7: 409 Burn-on-Read Replay Enforcement          (UAT-BURN-01..02) │
│ Area 8: Zero-Server Claim & Native SMS Handoff       (UAT-NET-01, SMS) │
└────────────────────────────────────────────────────────────────────────┘
```

---

### Area 1: Livery Tokens & BitBop Brand Identity

#### `UAT-LIV-01`: Theme Token Compliance & Computed Style Integrity
- **Priority**: P0 (Blocker)
- **Viewport**: Desktop (1440x900) & S21 Mobile (412x915)
- **Preconditions**: SecretSender running on port 5179.
- **Step-by-Step Execution**:
  1. Navigate to `http://localhost:5179/?uat=1`.
  2. Inspect computed styles of `document.body`.
  3. Inspect computed styles of `.shell`.
  4. Inspect computed styles of primary CTA button (`#seal-btn`).
  5. Inspect computed styles of telemetry badge (`.header-status-badge` or `.eyebrow`).
- **Expected Cryptographic / DOM Outcome**:
  - `body` background is `#0F1012` (`rgb(15, 16, 18)`).
  - `.shell` background is `#16181D` (`rgb(22, 24, 29)`) with border `#262932` (`rgb(38, 41, 50)`).
  - `#seal-btn` background is `#FFD600` (`rgb(255, 214, 0)`) with text `#1A1600` (`rgb(26, 22, 0)`).
  - Telemetry badge text is `#10B981` (`rgb(16, 185, 129)`), background `#062419` (`rgb(6, 36, 25)`).
  - Computed fonts: Headlines use `Space Grotesk`, body uses `Inter`, telemetry uses `JetBrains Mono`.
- **Verification Command**:
  ```bash
  npx playwright test -g "UAT-LIV-01"
  ```

#### `UAT-LIV-02`: Official BitBop SVG Asset Delivery & MIME Conformance
- **Priority**: P0 (Blocker)
- **Viewport**: Headless / Any
- **Preconditions**: SecretSender running on port 5179.
- **Step-by-Step Execution**:
  1. Send `GET /favicon.svg`.
  2. Send `GET /badges/bitbop-favicon.svg`.
  3. Send `GET /badges/bitbop-wordmark-dark.svg`.
  4. Send `GET /badges/powered-by-bitbop-emerald.svg`.
  5. Send `GET /badges/powered-by-bitbop-gold.svg`.
- **Expected Cryptographic / DOM Outcome**:
  - All 5 requests return `HTTP 200 OK`.
  - `Content-Type` header strictly matches `image/svg+xml; charset=utf-8`.
  - Byte length > 0, XML payload begins with `<svg` and ends with `</svg>`.
- **Verification Command**:
  ```bash
  curl -I -s http://localhost:5179/favicon.svg
  curl -I -s http://localhost:5179/badges/bitbop-wordmark-dark.svg
  ```

#### `UAT-LIV-03`: Glider Grid Radial Pattern & Telemetry Scanner Line Animation
- **Priority**: P1 (Critical)
- **Viewport**: S21 Mobile (412x915)
- **Preconditions**: SecretSender loaded.
- **Step-by-Step Execution**:
  1. Inspect element `.glider-grid` in the DOM.
  2. Inspect element `.scanner-line` in the DOM.
  3. Verify CSS properties for background grid and animation keyframes.
- **Expected Cryptographic / DOM Outcome**:
  - `.glider-grid` exists, is fixed to `inset: 0`, has `pointer-events: none`, and contains `radial-gradient(circle, #262932 1px, transparent 1px)`.
  - `.scanner-line` exists, background is `#10B981`, and animation `scan` is active.
- **Verification Command**:
  ```bash
  page.evaluate(() => !!document.querySelector('.glider-grid') && !!document.querySelector('.scanner-line'))
  ```

---

### Area 2: Mobile Viewport & Responsive Geometry (Samsung S21 384-412px)

#### `UAT-VIEW-01`: Physical S21 Admin View Zero Horizontal Overflow (412x915)
- **Priority**: P0 (Blocker)
- **Viewport**: Physical S21 Chrome (412x915, DPR 3.5)
- **Preconditions**: S21 connected via ADB with reverse tunnel active (`adb reverse tcp:5179 tcp:5179`).
- **Step-by-Step Execution**:
  1. Launch Chrome on device pointing to `http://localhost:5179/?uat=1`.
  2. Execute DOM measurement: `document.documentElement.scrollWidth` and `window.innerWidth`.
  3. Query all interactive elements (`input`, `button`, `.preset-btn`) and verify bounding client rects.
- **Expected Cryptographic / DOM Outcome**:
  - `Math.max(0, document.documentElement.scrollWidth - window.innerWidth) === 0`.
  - Zero clipped affordance targets (`rect.right <= 412 + 4` and `rect.left >= -4`).
  - `#admin-view` fits cleanly within shell padding without horizontal scrollbars.
- **Verification Command**:
  ```bash
  node scripts/run_s21_deterministic_uat.ts --test UAT-VIEW-01
  ```

#### `UAT-VIEW-02`: Physical S21 Claim View Zero Horizontal Overflow (412x915)
- **Priority**: P0 (Blocker)
- **Viewport**: Physical S21 Chrome (412x915, DPR 3.5)
- **Preconditions**: Active escrow created; URL is `http://localhost:5179/?escrow_id=test-escrow-id&uat=1`.
- **Step-by-Step Execution**:
  1. Open claim view on S21 Chrome.
  2. Trigger countdown clock display (`#timelock-box`).
  3. Execute DOM measurement: `document.documentElement.scrollWidth` vs `window.innerWidth`.
- **Expected Cryptographic / DOM Outcome**:
  - Horizontal overflow is exactly `0px`.
  - Countdown clock `#countdown-clock` text (`HH:MM:SS`) scales cleanly without breaking container boundaries.
  - Unlock Key input field and Reveal button span full width without clipping.
- **Verification Command**:
  ```bash
  node scripts/run_s21_deterministic_uat.ts --test UAT-VIEW-02
  ```

#### `UAT-VIEW-03`: Small Mobile Viewport Boundaries (384x800)
- **Priority**: P1 (Critical)
- **Viewport**: Emulated Compact Android (384px x 800px)
- **Preconditions**: Playwright browser context set to `{ width: 384, height: 800 }`.
- **Step-by-Step Execution**:
  1. Load Admin view (`/`) and Claim view (`/?escrow_id=test`).
  2. Measure `scrollWidth` vs `innerWidth`.
- **Expected Cryptographic / DOM Outcome**:
  - Zero horizontal overflow (`scrollWidth <= 384px`).
  - Preset embargo buttons wrap into multi-line flex rows without horizontal distortion.
- **Verification Command**:
  ```bash
  npx playwright test -g "UAT-VIEW-03"
  ```

#### `UAT-VIEW-04`: Desktop Viewport Scaling & Shell Centering (1440x900)
- **Priority**: P2 (High)
- **Viewport**: Desktop Chrome (1440px x 900px)
- **Preconditions**: Workstation desktop browser.
- **Step-by-Step Execution**:
  1. Open `http://localhost:5179/?uat=1`.
  2. Measure `.shell` computed width and horizontal centering margins.
- **Expected Cryptographic / DOM Outcome**:
  - `.shell` has `max-width: 480px`.
  - Card is horizontally centered in the viewport with equal left and right margins.
- **Verification Command**:
  ```bash
  page.evaluate(() => { const r = document.querySelector('.shell').getBoundingClientRect(); return r.width <= 480; })
  ```

---

### Area 3: Admin Secret Sealing

#### `UAT-SEAL-01`: Immediate Admin Secret Sealing with Auto-Generated PIN
- **Priority**: P0 (Blocker)
- **Viewport**: S21 Mobile (412x915)
- **Preconditions**: Admin view active at `http://localhost:5179/?uat=1`.
- **Step-by-Step Execution**:
  1. Type `"QuantumSecurePassword99"` into `#secret`.
  2. Leave `#pin` blank.
  3. Click `#seal-btn`.
  4. Wait for `window.__uatBusy() === false`.
- **Expected Cryptographic / DOM Outcome**:
  - `POST /api/share` sends payload to BitBop `/escrow/commit` with `seal_payload_b64`.
  - BitBop commits record and returns `escrow_id`, ML-DSA-44 beacon receipt, and auto-minted PIN.
  - UI displays `#result` card with:
    - `Claim URL`: `http://localhost:5179/?escrow_id=<id>`.
    - `Unlock Key`: 8-character hex PIN.
    - `Commit verified`: `YES (ML-DSA-44)`.
    - `Send via SMS` button with `sms:?body=...` link.
- **Verification Command**:
  ```bash
  node scripts/run_s21_deterministic_uat.ts --test UAT-SEAL-01
  ```

#### `UAT-SEAL-02`: Custom PIN & Embargo Preset Sealing (+30s Demo)
- **Priority**: P0 (Blocker)
- **Viewport**: S21 Mobile (412x915)
- **Preconditions**: Admin view active.
- **Step-by-Step Execution**:
  1. Enter secret `"TopSecretPayload123"`.
  2. Enter custom PIN `"alpha-bravo-7"`.
  3. Click preset button `+30s (Demo)`.
  4. Click `#seal-btn`.
- **Expected Cryptographic / DOM Outcome**:
  - `POST /api/share` payload includes `unlockAfterSeconds: 30` and `unlockKey: "alpha-bravo-7"`.
  - Returned receipt indicates `unlock_after_seconds: 30` and ISO timestamp `unlock_at`.
  - UI displays Available On embargo timestamp.
- **Verification Command**:
  ```bash
  node scripts/run_s21_deterministic_uat.ts --test UAT-SEAL-02
  ```

#### `UAT-SEAL-03`: Future Datetime-Local Picker Sealing (+48h Embargo)
- **Priority**: P1 (Critical)
- **Viewport**: S21 Mobile (412x915)
- **Preconditions**: Admin view active.
- **Step-by-Step Execution**:
  1. Set `#unlock-dt` to a date 48 hours in the future.
  2. Enter secret and click `#seal-btn`.
- **Expected Cryptographic / DOM Outcome**:
  - Server calculates `unlockAfterSeconds` corresponding to target date (`> 172000s`).
  - BitBop records embargo timestamp matching target date.
- **Verification Command**:
  ```bash
  node scripts/run_s21_deterministic_uat.ts --test UAT-SEAL-03
  ```

#### `UAT-SEAL-04`: Empty Secret Input Refusal & Zero-Network Guard
- **Priority**: P1 (Critical)
- **Viewport**: S21 Mobile (412x915)
- **Preconditions**: Admin view active. `#secret` input is empty.
- **Step-by-Step Execution**:
  1. Click `#seal-btn` without typing any secret.
- **Expected Cryptographic / DOM Outcome**:
  - Action refused locally in browser.
  - UI displays error banner: `"Enter a secret password."`.
  - Zero outgoing HTTP requests recorded in `window.__uatRecorder` (`networkCalls === 0`).
- **Verification Command**:
  ```bash
  page.evaluate(() => window.__uatRecorder.events().filter(e => e.type === 'network').length === 0)
  ```

---

### Area 4: Timelock Embargo & 24h Countdown Clock Auto-Reveal

#### `UAT-TIME-01`: Future Reveal Embargo Detection (HTTP 425 Too Early)
- **Priority**: P0 (Blocker)
- **Viewport**: S21 Mobile (412x915)
- **Preconditions**: Escrow created with +30s embargo.
- **Step-by-Step Execution**:
  1. Navigate to `http://localhost:5179/?escrow_id=<id>&uat=1`.
  2. Initial probe to `https://api.bitbop.dev/escrow/reveal` returns `HTTP 425 Too Early`.
- **Expected Cryptographic / DOM Outcome**:
  - Probe catches HTTP 425 with JSON containing `unlock_at`.
  - `#timelock-box` card transitions to `display: block`.
  - `#timelock-heading` displays: `⏳ Time-Locked Secret (Embargo Active)`.
  - `#reveal-btn` is disabled with label `Locked Until Available Date`.
  - `window.__uatState().timelockActive === true`.
- **Verification Command**:
  ```bash
  node scripts/run_s21_deterministic_uat.ts --test UAT-TIME-01
  ```

#### `UAT-TIME-02`: Final 24h Countdown Clock Formatting (`HH:MM:SS`)
- **Priority**: P0 (Blocker)
- **Viewport**: S21 Mobile (412x915)
- **Preconditions**: Escrow with embargo `< 24 hours` (e.g. +30s).
- **Step-by-Step Execution**:
  1. Observe `#countdown-wrap` and `#countdown-clock` element.
  2. Sample `#countdown-clock.textContent` across 1 second.
- **Expected Cryptographic / DOM Outcome**:
  - `#countdown-wrap` is visible.
  - `#countdown-clock` displays formatted `00:00:SS` matching regex `^\d{2}:\d{2}:\d{2}$`.
  - Clock ticks downward every 250ms.
  - `#countdown-sub` displays: `Final 24-hour countdown (HH:MM:SS)`.
- **Verification Command**:
  ```bash
  page.evaluate(() => /^\d{2}:\d{2}:\d{2}$/.test(document.getElementById('countdown-clock').textContent))
  ```

#### `UAT-TIME-03`: Automatic Reveal & Decrypt at 00:00:00 Countdown Expiry
- **Priority**: P0 (Blocker)
- **Viewport**: S21 Mobile (412x915)
- **Preconditions**: Escrow created with +10s embargo. User pre-enters valid Unlock Key into `#unlock`.
- **Step-by-Step Execution**:
  1. Load claim page.
  2. Type valid PIN into `#unlock` input while countdown is running.
  3. Wait for countdown to reach `00:00:00`.
- **Expected Cryptographic / DOM Outcome**:
  - When timer reaches 0, `tick()` calls `performDirectBrowserReveal(enteredKey)` automatically.
  - No manual click on `#reveal-btn` is required.
  - Browser executes ML-KEM-768 decapsulation and WebCrypto AES-GCM decryption.
  - Decrypted plaintext secret is displayed in `#pw-display`.
  - `window.__uatState().revealed === true`.
- **Verification Command**:
  ```bash
  node scripts/run_s21_deterministic_uat.ts --test UAT-TIME-03
  ```

---

### Area 5: Wrong PIN 403 Non-Burn Preservation

#### `UAT-AUTH-01`: Wrong Unlock Key (HTTP 403) Non-Burn Preservation
- **Priority**: P0 (Blocker)
- **Viewport**: S21 Mobile (412x915)
- **Preconditions**: Immediate escrow active.
- **Step-by-Step Execution**:
  1. Open claim view.
  2. Type wrong PIN `"incorrect-pin-999"` into `#unlock`.
  3. Click `#reveal-btn`.
  4. Wait for `window.__uatBusy() === false`.
- **Expected Cryptographic / DOM Outcome**:
  - Direct call to BitBop `/escrow/reveal` returns `HTTP 403 Forbidden`.
  - UI displays error banner: `Wrong unlock key (403). Secret NOT burned.` and reports remaining attempts.
  - Escrow remains active in hardware vault (NOT burned).
  - `window.__uatState().burned === false` and `window.__uatState().revealed === false`.
- **Verification Command**:
  ```bash
  node scripts/run_s21_deterministic_uat.ts --test UAT-AUTH-01
  ```

#### `UAT-AUTH-02`: Subsequent Valid Unlock Following Wrong Key Attempt
- **Priority**: P0 (Blocker)
- **Viewport**: S21 Mobile (412x915)
- **Preconditions**: Following `UAT-AUTH-01`, page remains loaded.
- **Step-by-Step Execution**:
  1. Clear `#unlock` input.
  2. Type the genuine PIN.
  3. Click `#reveal-btn`.
- **Expected Cryptographic / DOM Outcome**:
  - BitBop returns `HTTP 200 OK` with cipher package.
  - Browser decrypts secret successfully.
  - Plaintext rendered into `#pw-display`.
- **Verification Command**:
  ```bash
  node scripts/run_s21_deterministic_uat.ts --test UAT-AUTH-02
  ```

---

### Area 6: Valid ML-KEM-768 Decrypt & ML-DSA-44 Provenance Verify

#### `UAT-CRYPTO-01`: Pure Browser ML-KEM-768 Decapsulation & AES-256-GCM Decryption
- **Priority**: P0 (Blocker)
- **Viewport**: S21 Mobile (412x915)
- **Preconditions**: Active escrow; recipient possesses valid PIN.
- **Step-by-Step Execution**:
  1. Recipient loads claim view and enters PIN.
  2. Recipient clicks `#reveal-btn`.
  3. Browser generates ephemeral ML-KEM-768 keypair `(pkHex, skBytes)`.
  4. POST to `https://api.bitbop.dev/escrow/reveal`.
  5. Browser decapsulates `cipher.kyber_ciphertext_hex` with `skBytes` -> 32-byte `sharedSecret`.
  6. Browser decrypts `cipher.aes_ciphertext_hex` with `sharedSecret` -> 32-byte raw entropy.
  7. Browser derives envelope key via `SHA-256(entropyHex)`.
  8. Browser decrypts `sealed_envelope.ciphertext_b64` via WebCrypto AES-GCM -> UTF-8 plaintext.
- **Expected Cryptographic / DOM Outcome**:
  - Plaintext matches exact original secret sealed by Admin.
  - Displayed in `#pw-display`.
- **Verification Command**:
  ```bash
  node scripts/run_s21_deterministic_uat.ts --test UAT-CRYPTO-01
  ```

#### `UAT-CRYPTO-02`: Post-Quantum ML-DSA-44 Beacon Receipt Verification
- **Priority**: P1 (Critical)
- **Viewport**: S21 Mobile (412x915)
- **Preconditions**: Successful reveal from `UAT-CRYPTO-01`.
- **Step-by-Step Execution**:
  1. Browser takes full reveal receipt JSON and executes `POST https://api.bitbop.dev/verify`.
  2. Inspect response `{ valid: true, beacon_sequence: ... }`.
- **Expected Cryptographic / DOM Outcome**:
  - Verification returns valid signature over beacon sequence.
  - UI displays: `Reveal verified: YES (ML-DSA-44 Beacon #<seq>)` in emerald `.ok` styling.
  - Link to BitBop provenance explorer is provided (`https://www.bitbop.dev/provenance?...`).
- **Verification Command**:
  ```bash
  node scripts/run_s21_deterministic_uat.ts --test UAT-CRYPTO-02
  ```

#### `UAT-CRYPTO-03`: Plaintext DOM Rendering & XSS Injection Immunization
- **Priority**: P0 (Blocker)
- **Viewport**: S21 Mobile (412x915)
- **Preconditions**: Admin seals secret containing malicious payload:
  `"<script>window.__xss_fired=true</script><img src=x onerror='window.__xss_fired=true'>"`
- **Step-by-Step Execution**:
  1. Recipient reveals the secret on S21 Chrome.
  2. Check `window.__xss_fired`.
  3. Inspect `#pw-display.textContent` vs `#pw-display.innerHTML`.
- **Expected Cryptographic / DOM Outcome**:
  - `window.__xss_fired === undefined`.
  - Secret is rendered strictly via `element.textContent = plaintext`.
  - Raw HTML tags appear as inert text; zero script evaluation.
- **Verification Command**:
  ```bash
  page.evaluate(() => window.__xss_fired === undefined && document.getElementById('pw-display').textContent.includes('<script>'))
  ```

---

### Area 7: 409 Burn-on-Read Replay Enforcement

#### `UAT-BURN-01`: Burn-on-Read Replay Enforcement (HTTP 409 Conflict)
- **Priority**: P0 (Blocker)
- **Viewport**: S21 Mobile (412x915)
- **Preconditions**: Escrow successfully revealed and decrypted in `UAT-CRYPTO-01`.
- **Step-by-Step Execution**:
  1. Without reloading, click `#reveal-btn` a second time (or reload and submit the same valid PIN).
- **Expected Cryptographic / DOM Outcome**:
  - BitBop Edge returns `HTTP 409 Conflict`.
  - UI renders warning banner:
    `Secret permanently burned (409). Cannot retrieve again. This one-time record was already unsealed and destroyed.`
  - Decrypted plaintext is unreachable.
  - `window.__uatState().burned === true`.
- **Verification Command**:
  ```bash
  node scripts/run_s21_deterministic_uat.ts --test UAT-BURN-01
  ```

#### `UAT-BURN-02`: Claim Page Direct Load on Burned Escrow (Probe 409)
- **Priority**: P1 (Critical)
- **Viewport**: S21 Mobile (412x915)
- **Preconditions**: Escrow already burned in prior session.
- **Step-by-Step Execution**:
  1. Fresh browser tab loads `http://localhost:5179/?escrow_id=<burned_id>&uat=1`.
  2. Initial probe executes.
- **Expected Cryptographic / DOM Outcome**:
  - Initial probe returns `HTTP 409`.
  - UI immediately alerts user that secret was already claimed.
  - `#reveal-btn` remains inert.
- **Verification Command**:
  ```bash
  node scripts/run_s21_deterministic_uat.ts --test UAT-BURN-02
  ```

---

### Area 8: Zero-Server-Query Invariant & Native SMS Handoff

#### `UAT-NET-01`: Zero App-Server Requests During Recipient Claim
- **Priority**: P0 (Blocker)
- **Viewport**: S21 Mobile (412x915)
- **Preconditions**: Network observer attached to Playwright session.
- **Step-by-Step Execution**:
  1. Load claim URL `http://localhost:5179/?escrow_id=<id>&uat=1`.
  2. Enter valid PIN.
  3. Reveal and verify secret.
  4. Collect all network URLs requested by the browser during steps 1-3.
- **Expected Cryptographic / DOM Outcome**:
  - Exactly **ZERO** HTTP requests are sent to `localhost:5179` (or `SecretSender` origin) after initial HTML/bundle load.
  - 100% of escrow reveal, key decapsulation, and verification queries route directly to `https://api.bitbop.dev/*`.
- **Verification Command**:
  ```bash
  node scripts/run_s21_deterministic_uat.ts --test UAT-NET-01
  ```

#### `UAT-SMS-01`: Native SMS Handoff Link Formatting & Payload Encoding
- **Priority**: P1 (Critical)
- **Viewport**: S21 Mobile (412x915)
- **Preconditions**: Admin completes secret sealing.
- **Step-by-Step Execution**:
  1. Locate `.btn-sms` anchor in the Admin confirmation card.
  2. Inspect the `href` attribute.
- **Expected Cryptographic / DOM Outcome**:
  - `href` starts with `sms:?body=`.
  - Query contains URI-encoded body containing:
    1. Claim URL (`http://localhost:5179/?escrow_id=...`).
    2. Unlock Key PIN.
    3. BitBop Provenance URL.
  - Clicking launches native Android SMS messenger (tested via Intent validation).
- **Verification Command**:
  ```bash
  page.evaluate(() => document.querySelector('.btn-sms').getAttribute('href').startsWith('sms:?body='))
  ```

---

## 5. Model-Driven UAT Persona Specifications

In addition to deterministic testing, the autonomous LLM runner executes three real-world user personas via ADB CDP:

| Persona ID | Goal / Mindset | Interaction Style | Acceptance Assertion |
|---|---|---|---|
| `happy-path` | Admin seals secret with default settings; recipient enters PIN and claims secret. | Direct, deliberate input, happy-path sequence. | 0 dead clicks, secret decrypted, ML-DSA-44 verified, 0 errors. |
| `adversarial-validation` | Attempts empty submissions, invalid dates, wrong PINs, and replay reveals. | Rapid, boundary-testing, negative inputs. | 403 & 409 handled gracefully, non-burn verified, 0 unhandled errors. |
| `mobile-ux` | Physical S21 touch exploration, preset toggle switching, keyboard show/dismiss, rapid copy button presses. | Mobile touch gestures, viewport monitoring. | 0px horizontal overflow at every step, all buttons hit-tested cleanly. |

---

## 6. Machine-Readable Reporting Formats (`logs/uat/`)

All test executions produce structured, timestamped JSON artifacts in `logs/uat/`:

### 6.1 `logs/uat/deterministic-s21-report.json`
```json
{
  "suite": "SecretSender Physical S21 Deterministic UAT",
  "device": {
    "serial": "R5CR60QL05P",
    "model": "SM_G998B",
    "chromeVersion": "Chrome/155.0.8059.84",
    "viewport": { "width": 412, "height": 915 }
  },
  "completedAt": "2026-10-22T02:00:00.000Z",
  "durationMs": 14250,
  "summary": {
    "total": 23,
    "passed": 23,
    "failed": 0
  },
  "results": [
    {
      "id": "UAT-LIV-01",
      "area": "Area 1: Livery Tokens",
      "status": "PASS",
      "durationMs": 320
    }
  ]
}
```

### 6.2 `logs/uat/uat-report-<persona>.json`
```json
{
  "persona": "mobile-ux",
  "completedAt": "2026-10-22T02:15:00.000Z",
  "stepsExecuted": 10,
  "deadClicks": [],
  "viewportOverflowSteps": [],
  "flightRecorder": {
    "format": "web-uat/1",
    "summary": {
      "actions": 12,
      "networkCalls": 6,
      "errors": 0
    }
  }
}
```

---

## 7. Quality Gate & Acceptance Sign-off Criteria

To achieve Milestone 2 & Milestone 3 sign-off, the following criteria must be satisfied:
1. `docs/UAT_PLAN.md` is published with all 23 test specifications across 8 areas.
2. `node --check server.mjs` passes with zero syntax errors.
3. `npm test` passes 100% of the 62 existing E2E tests.
4. `window.__uatRecorder`, `window.__uatState()`, and `window.__uatBusy()` are verified functional in live browser sessions on both `http://localhost:5179/?uat=1` and `http://127.0.0.1:5179/`.
5. Deterministic S21 test suite achieves 100% pass on physical hardware `R5CR60QL05P`.
6. Model-driven exploratory loop finishes with 0 dead clicks, 0px horizontal overflow, and 0 errors.
