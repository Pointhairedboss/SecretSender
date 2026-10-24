# External Agent Reflector Architecture & Hosting Comparison

## 1. Overview: What Is an External Agent Reflector?

When testing a distributed or peer-to-peer web application (`SecretSender`, `D-D`, or `pooled.run`), running both peers on `localhost` or on the same home Wi-Fi / LAN hides real-world internet failure modes:
- Edge TLS termination, HSTS, CORS, and WAF rules
- NAT hair-pinning, CGNAT, and STUN/TURN relay selection (`turn:...:3478` vs `turns:...:443`)
- Cross-origin mobile browser behavior (Android Chrome on a physical Samsung Galaxy S21 Ultra `R5CR60QL05P` vs. an external cloud peer)

An **External Agent Reflector** is a cloud-hosted peer outside your LAN that can be commanded by your local UAT orchestrator (`scripts/run_external_s21_reflector_uat.mjs`) to act as the remote sender or recipient while your physical S21 acts as the local mobile peer.

---

## 2. Comparison of the 5 Hosting Options

| Hosting Option | True External Network (Outside LAN & Outside CF)? | Supports HTTP + WebCrypto + ML-KEM-768 (`SecretSender`)? | Supports Full Headless Browser + WebRTC UDP/TURN (`D-D` / `pooled.run`)? | Cost & Billing Model | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Cloudflare Worker** (`worker/index.mjs` `/api/reflect`) | ✅ Outside LAN<br>⚠️ Inside Cloudflare Edge | ✅ **Yes** (Native `crypto.subtle` + `mlkem` in V8 isolate) | ⚠️ Only with paid Browser Rendering (`@cloudflare/playwright`), and no raw UDP WebRTC | **\$0.00** (Included in your existing Workers plan) | **Best instant reflector for `SecretSender`** (already wired & live at `https://secrets.bitbop.dev/api/reflect`). |
| **2. Vercel Serverless Function** (`api/reflect.mjs` on `pooled.run`) | ✅ **Yes** (Runs on AWS Lambda `iad1`/`syd1`, completely outside Cloudflare) | ✅ **Yes** (Node.js 22 runtime with WebCrypto + `mlkem`) | ❌ AWS Lambda microVMs block inbound/ephemeral WebRTC UDP | **\$0.00** (Included in your existing Vercel Hobby/Pro tier) | **Best zero-cost cross-cloud HTTP/Crypto reflector** (tests AWS $\rightarrow$ Cloudflare public routing, WAF, and TLS). |
| **3. Google Cloud Run (Playwright + Hermes Container)** | ✅ **Yes** (Runs on Google Cloud `australia-southeast1` / `us-central1`) | ✅ **Yes** | ✅ **Yes** (Real Chromium browser + WebGPU software/L4 + WebRTC STUN/TURN) | **Covered by your GCP Credits**; **scales to `0` ($0.00) when idle** (bills only during a 60s UAT run) | **Best all-around External Agent Reflector** for full-browser DOM + WebRTC P2P (`D-D` / `pooled.run`) + Hermes LLM loops. |
| **4. Dedicated Linux VPS** (Hetzner / DO / Vultr) | ✅ **Yes** | ✅ **Yes** | ✅ **Yes** (Unrestricted UDP/TCP & symmetric NAT simulation via `iptables`) | **\$4–\$6 / month** fixed (burns money 24/7 even when not running UAT) | Only needed if you want to simulate hostile corporate firewall/NAT rules via custom Linux `iptables`/`tc` netem. |
| **5. Codex / Antigravity Cloud Window** | ✅ Outside LAN | ✅ **Yes** | ⚠️ Ephemeral container; egress proxy often blocks UDP WebRTC; cannot be triggered headlessly by local cron/CLI | Included in subscription | Good for interactive manual debugging, **poor fit for automated repeatable UAT scripts**. |

---

## 3. Recommended Two-Tier Reflector Strategy

### Tier A: Instant Protocol & Crypto Reflector (Cloudflare Worker & Vercel)
For `SecretSender`, the recipient flow is pure HTTPS + `ML-KEM-768` + WebCrypto `AES-256-GCM` + `ML-DSA-44`.
- **Cloudflare Edge Reflector (Live Now):** [worker/index.mjs](file:///c:/code/projects/SecretSender/worker/index.mjs) exposes `POST https://secrets.bitbop.dev/api/reflect` supporting `action: "ping" | "seal" | "claim"`.
- **Vercel Cross-Cloud Reflector (Drop-In):** Copy [api/reflect.mjs](file:///c:/code/projects/SecretSender/api/reflect.mjs) into your Vercel repo (`c:\code\projects\pool\windows\api\reflect.mjs`) and run:
  ```powershell
  $env:UAT_REFLECTOR_URL = "https://pooled.run/api/reflect"
  npm run uat:external
  ```
  This forces the remote peer to run on **AWS Lambda** (via Vercel), traverse the public internet into **Cloudflare (`secrets.bitbop.dev` / `api.bitbop.dev`)**, and exchange secrets with your physical **Samsung Galaxy S21 Ultra (`R5CR60QL05P`)**.

### Tier B: Full Browser + WebRTC + Hermes Reflector on Google Cloud Run (Using Your GCP Credits)
When you also want an external agent that opens a **real headless Chromium browser**, clicks real DOM buttons via Hermes, and establishes **WebRTC DataChannels / TURN relays** (for `D-D` or `pooled.run` as well as `SecretSender`), **Google Cloud Run** is the clear winner over a VPS:
1. **Uses your existing Google Cloud credits.**
2. **`--min-instances=0` (Scales to Zero):** Costs **\$0.00** whenever you aren't running a test. When `npm run uat:external` calls it, Cloud Run boots the container in ~2 seconds, runs the Playwright / Hermes browser session from a Google Cloud datacenter IP, returns the `window.__uatRecorder` JSON report, and scales back down to zero.
3. **One-Command Deploy to GCP Cloud Run:**
   ```bash
   gcloud run deploy uat-agent-reflector \
     --source ./reflector-cloudrun \
     --region australia-southeast1 \
     --memory 2Gi --cpu 2 \
     --min-instances 0 --max-instances 2 \
     --allow-unauthenticated
   ```
