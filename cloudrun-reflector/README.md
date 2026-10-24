# Google Cloud Run — Multi-Agent UAT Reflector (`uat-agent-reflector`)

A **scale-to-zero (`--min-instances=0`)** Google Cloud Run container that provides an external full-browser (`Playwright Chromium` + `WebRTC` + `WebCrypto` + `ML-KEM-768` + `window.__uatRecorder`) peer outside your network and outside Cloudflare, funded by your Google Cloud credits.

## Capabilities (`POST /reflect`)

| `action` | Mode | Description |
| :--- | :--- | :--- |
| `"ping"` | Fast | Returns GCP region (`australia-southeast1`), Cloud Run revision (`K_REVISION`), and external GCP egress IP (`egressIp`). |
| `"seal"` | Protocol | Seals a secret via `POST https://secrets.bitbop.dev/api/share` from Google Cloud's network. |
| `"claim"` | Protocol | Executes `ML-KEM-768` keygen + `POST /escrow/reveal` (`403` wrong PIN probe, `200` valid decrypt, `409` burn recheck) + `ML-DSA-44` `/verify` from Google Cloud. |
| `"browser_seal"` | **Full Chromium** | Launches headless Chromium inside Cloud Run, navigates to `https://secrets.bitbop.dev/?uat=1`, seals a secret via real DOM clicks, and returns the `window.__uatRecorder` telemetry log. |
| `"browser_claim"` | **Full Chromium** | Launches headless Chromium inside Cloud Run, opens the Claim URL, decrypts the secret in the browser DOM, and returns the `window.__uatRecorder` telemetry log. |
| `"browser_session"` | **Universal WebRTC / Multi-App** | Opens **any** URL (`https://dungeon.bitbop.dev`, `https://pooled.run`, `https://secrets.bitbop.dev`) in Chromium with WebRTC/TURN enabled, executes scripted DOM steps, and returns `window.__uatRecorder` telemetry + optional PNG screenshot. |
| `"hermes_uat"` | **Hermes Google Endpoint Loop** | Loads `hermes.yaml` (`provider: gemini`, `https://generativelanguage.googleapis.com/v1beta/openai` + Vertex AI fallback), sends the live Chromium DOM snapshot to Gemini (`gemini-2.5-flash`), executes the LLM-planned UAT steps in headless Chromium, and returns the reasoning trace + `window.__uatRecorder` log. |

## Hermes Google Endpoint Configuration (`hermes.yaml`)

`cloudrun-reflector/hermes.yaml` configures the Google Gemini / Vertex AI endpoints (`_config_version: 50`):
- **Primary Provider (`gemini`)**: `https://generativelanguage.googleapis.com/v1beta` (native) & `https://generativelanguage.googleapis.com/v1beta/openai` (`chat_completions`), default model `gemini-2.5-flash`.
- **Fallback Provider (`google-vertex`)**: `https://australia-southeast1-aiplatform.googleapis.com/v1/projects/gen-lang-client-0057994039/locations/australia-southeast1/endpoints/openapi` (authenticating via Cloud Run's built-in GCP Metadata Server token if `GOOGLE_API_KEY` is omitted).

## 1-Command Deployment to Google Cloud Run

```powershell
powershell -ExecutionPolicy Bypass -File .\cloudrun-reflector\deploy-cloudrun.ps1
```

## Running the Split-Horizon S21 + Multi-Agent Cloud Swarm

Once deployed, point `UAT_REFLECTOR_URL` at your Cloud Run service URL:

```powershell
$env:UAT_REFLECTOR_URL = "https://uat-agent-reflector-<hash>-ts.a.run.app/reflect"

# Run standard 6-step S21 <-> Cloud Run split-horizon UAT + 5 parallel full-browser Cloud Run agents:
node scripts/run_external_s21_reflector_uat.mjs --swarm 5 --browser
```
