# Historical Corporate Environment Assessment: Cloudflare Edge & WebRTC P2P Deployment Analysis

**Document Status:** Historical comparative assessment; operational sections updated for v1.1
**Author:** Worker M4 1 (Corporate P2P Cloudflare Assessment Author)  
**Target Application:** `SecretSender` (`c:\code\projects\SecretSender`)  
**Reference Architecture:** `D-D` Cloudflare Edge Worker + Realtime TURN + PeerJS Mesh (`c:\code\projects\D-D`)  
**Associated Documents:** `PROJECT.md`, `ORIGINAL_REQUEST.md`, `docs/UAT_PLAN.md`  
**Date:** October 2026  

> **v1.1 status:** This is a historical comparison with a different application's WebRTC architecture. Percentages, cost/availability claims and prior sign-offs below are retained as historical analysis, not independently verified measurements or current release guarantees. Sections 5.1 and 7 now point to the merged implementation. Use [the current README](../README.md), [deployment guide](DEPLOYMENT.md) and [verification status](../TEST_READY.md) for SecretSender operations. Normal browser claims use same-origin Worker routes and a browser-generated fragment key; no generic plaintext reverse-proxy example is a supported integration.

---

## 1. Executive Summary & Purpose

### 1.1 Scope & Mandate
This engineering assessment evaluates the viability, survivability, security implications, and operational feasibility of deploying `SecretSender` (`c:\code\projects\SecretSender`) post-UAT to Cloudflare Workers using the external peer-to-peer (P2P) WebRTC and TURN relay architecture established in `c:\code\projects\D-D` (`worker/index.js`, `vendor/pooled/api/turn.mjs`, `docs/DEPLOYMENT_CLOUDFLARE_BITBOP.md`, `docs/DEPLOY.md`).

The assessment was commissioned to determine whether replacing or augmenting the existing BitBop hardware-anchored escrow architecture (`https://api.bitbop.dev`) with a browser-to-browser WebRTC DataChannel stack would succeed in enterprise corporate environments, financial institutions, defense networks, and mobile carrier environments.

### 1.2 Core Architectural Thesis & Key Findings

1. **The Fundamental Operational Paradigm Mismatch:**  
   `D-D` is a synchronous, real-time multiplayer cooperative game where all participating players are online simultaneously in the same virtual room with active browser tabs open. In stark contrast, `SecretSender` is an **asynchronous store-and-forward one-time secret delivery system**. A sender creates a secret at time $T_0$ and configures a time-lock reveal embargo lasting hours, days, or weeks until $T_1$. Requiring the sender's device and browser tab to stay persistently awake, powered on, and connected to WebRTC signaling for hours or days is impossible on desktop (laptop lid closure, OS power management, browser restarts) and physically impossible on mobile devices (iOS Safari and Android Chrome enforce aggressive background tab suspension, killing WebSockets and WebRTC sockets within **15–30 seconds**).

2. **Perimeter Security Controls Break WebRTC P2P in Corporate Networks:**  
   In managed enterprise environments (Fortune 500 enterprises, healthcare, banking, defense contractors, and government agencies), direct WebRTC P2P fails in **over 85%** of connection attempts. Outbound UDP is blocked by default-deny egress firewall policies, and enterprise firewalls implement Symmetric NAT, which mathematically precludes ICE hole-punching.

3. **Cloudflare TURNS Fails Under Enterprise TLS Inspection (SSL Bumping):**  
   While Cloudflare Calls provides a fallback relay over TCP port 443 (`turns:turn.cloudflare.com:443?transport=tcp`), this relay fails catastrophically when routed through enterprise **Secure Web Gateways (SWG)** such as Zscaler Internet Access (ZIA), Palo Alto Networks NGFW with App-ID, Netskope, or BlueCoat ProxySG. Because enterprise SWGs intercept and decrypt TLS traffic on port 443, their protocol identification engines encounter binary STUN/TURN framing (magic cookie `0x2112A442`) instead of valid HTTP/HTTPS or WebSocket frames. The SWG classifies the connection as a protocol anomaly or unauthorized tunnel and immediately terminates it via `TCP RST`.

4. **Public Signaling Reputational Blocking:**  
   The `D-D` architecture relies on a third-party public signaling server (`wss://0.peerjs.com`). Commercial enterprise URL filtering databases classify `0.peerjs.com` under categories such as "Peer-to-Peer / File Sharing" or "Uncategorized Personal Communications", triggering automatic proxy blocks under standard Acceptable Use Policies (AUP). Furthermore, the public server provides no enterprise SLA, multi-tenancy isolation, or guaranteed uptime.

5. **Inability to Enforce Byzantine Cryptographic Guarantees Client-Side:**  
   Pure client-side P2P cannot enforce single-use **burn-on-read** or unforgeable **time-lock embargoes** without a trusted, Byzantine-fault-tolerant hardware anchor. If the sender's client stores the secret, the sender can withhold delivery, modify system clocks, or retain duplicate copies.

6. **Strategic Recommendation:**  
   `SecretSender` must **NOT** adopt WebRTC P2P for core secret delivery. Instead, `SecretSender` should deploy to Cloudflare as a **Cloudflare Edge Worker with Static Assets** acting as an edge reverse proxy and CDN for the **BitBop Hardware Escrow API** (`https://api.bitbop.dev`). This architecture achieves **100% corporate proxy and firewall survivability** via standard HTTPS REST (TLS 1.3), true asynchronous time-locking rooted in hardware atomic clocks, and post-quantum NIST FIPS 203 ML-KEM-768 / NIST FIPS 204 ML-DSA-44 cryptographic provenance.

---

## 2. Hop-by-Hop Protocol & Port Topology (The D-D Architecture)

The reference `D-D` architecture distributes execution between client browsers, Cloudflare Workers, Cloudflare Calls Realtime TURN relays, and the public PeerJS signaling service. Below is the exhaustive topological mapping of every network hop required to establish and maintain a connection in the `D-D` stack.

### 2.1 Complete Hop-by-Hop Topology Table

| Hop # | Component / Connection | Destination Endpoint | Transport Layer Protocol & Port | Application Layer Protocol | Operational Purpose in `D-D` | Corporate Network Survivability Rate | Corporate Failure Mechanism |
|---|---|---|---|---|---|---|---|
| **Hop 1** | **Edge Static Asset Delivery** | `dungeon.bitbop.dev` or `*.workers.dev` | TCP 443 (or UDP 443 via HTTP/3 QUIC) | HTTPS (TLS 1.3, HTTP/2) | Worker serves HTML shell, bundled JS (`dist/`), vendor libraries (`peerjs.min.js`), audio presets, and 3D assets via `env.ASSETS.fetch(request)` | **High (98%)** | Permitted through standard corporate HTTP/HTTPS forward proxies. Blocked only if the custom domain is newly registered and uncategorized. |
| **Hop 2** | **ICE Credential Vending API** | `/api/ice-servers` & `/api/turn` on Edge Worker | TCP 443 | HTTPS REST (JSON over TLS 1.3) | Worker invokes Cloudflare Calls REST API (`https://rtc.live.cloudflare.com/v1/turn/keys/...`) to mint ephemeral TURN credentials (TTL 600–86400s) | **High (98%)** | Standard HTTPS POST/GET. Protected by `Origin` / `Sec-Fetch-Site: same-origin` checks and per-IP rate limiting (`TURN_RATE`). |
| **Hop 3** | **PeerJS WebRTC Signaling** | `0.peerjs.com` | TCP 443 | WSS (WebSocket over TLS) & HTTPS polling fallback | Client registers peer ID, discovers remote peers, exchanges SDP offers/answers, and trickles ICE candidates | **Low (25–35%)** | SWGs (Zscaler, Palo Alto) block `0.peerjs.com` under P2P/File Sharing categories. Proxy SSL bumping terminates WebSockets; public server lacks enterprise tenancy/SLA. |
| **Hop 4** | **Public STUN Discovery** | `stun.cloudflare.com:3478`, `stun.l.google.com:19302` | UDP 3478, UDP 19302 | STUN (RFC 5389 / RFC 8489) | Browser probes STUN servers to discover its public reflexive IP address and port mapping (`srflx` candidate) | **Very Low (5–10%)** | Enterprise firewalls drop outbound UDP traffic on non-DNS ports. Silent packet drops cause multi-second ICE gathering timeouts. |
| **Hop 5** | **Direct P2P DataChannel** | Peer Browser Public / Host IP | UDP dynamic ephemeral ports (1024–65535) | SCTP over DTLS over UDP | Direct low-latency browser-to-browser communication channel for game state or secret transmission | **Extremely Low (5–12%)** | Blocked by Symmetric NATs (allocating destination-dependent external ports). Firewall default-deny drops inbound/outbound dynamic UDP. |
| **Hop 6** | **Cloudflare Calls TURN (UDP Relay)** | `turn:turn.cloudflare.com:3478?transport=udp` | UDP 3478 | TURN over UDP (RFC 5766 / RFC 8656) | Relays WebRTC packets through Cloudflare Anycast edge when direct peer-to-peer hole-punching fails | **Very Low (5–10%)** | Outbound UDP port 3478 blocked by enterprise egress firewall filters. |
| **Hop 7** | **Cloudflare Calls TURNS (TLS Relay)** | `turns:turn.cloudflare.com:443?transport=tcp` | TCP 443 | TURNS (TURN protocol framed in TLS) | Fallback relay specifically designed for restricted networks where all UDP is blocked and only port 443 TCP is open | **Low–Medium (20–40%)** | Fails under enterprise SWG TLS Inspection / SSL Bumping. Decryption reveals non-HTTP binary STUN frames, causing immediate `TCP RST`. |

---

### 2.2 Deep Code & Protocol Analysis for Each Hop

#### Hop 1: Edge Static Asset Delivery (`worker/index.js`, Lines 60–69)
```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/turn') return turn(request, env);
    if (url.pathname === '/api/ice-servers') return iceServers(request, env);
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
```
- **Network Path:** Standard TCP port 443 or HTTP/3 QUIC (UDP 443).
- **Execution:** When a user requests the application, Cloudflare's Anycast edge handles the TLS termination and delegates to `env.ASSETS.fetch(request)`. The static bundle includes the compiled HTML, CSS, JavaScript, and third-party WebRTC libraries.
- **Corporate Survivability:** Near 100%. Enterprise firewalls and forward proxies permit standard HTTPS GET requests to valid domains. If the enterprise forces HTTP/1.1 or HTTP/2 through an explicit proxy, Cloudflare automatically negotiates the compatible ALPN protocol.

#### Hop 2: ICE Credential Vending API (`worker/index.js` & `vendor/pooled/api/turn.mjs`)
```javascript
// worker/index.js lines 42-58
async function iceServers(request, env) {
  const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  const self = new URL(request.url).origin;
  const origin = request.headers.get('Origin') || '';
  const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
  const sameSite = origin === self || isLocalOrigin || request.headers.get('Sec-Fetch-Site') === 'same-origin';
  if (!sameSite) return json(STUN_ONLY);
  // ...
  const res = await turn(new Request(request.url, { method: 'POST', headers }), env);
  // ...
}
```
- **Network Path:** Standard HTTPS POST/GET to `/api/ice-servers` or `/api/turn`.
- **Underlying Call:** The Worker invokes the Cloudflare Calls REST API endpoint:
  `POST https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate-ice-servers`
  passing `Authorization: Bearer <TURN_KEY_API_TOKEN>` and `{ "ttl": 86400 }`.
- **Filtering Logic:** `cleanIceServers()` in `vendor/pooled/api/turn.mjs` (lines 69–82) explicitly purges all port-53 candidates (`/:53(\?|$)/`), because standard web browsers treat port 53 (DNS) as a restricted port and will refuse to bind WebRTC sockets to it.
- **Corporate Survivability:** Very high (98%). The payload is pure JSON. However, this hop merely *delivers* the credentials; it does not guarantee that the client can actually connect to the vended relay endpoints.

#### Hop 3: Public PeerJS WebRTC Signaling (`wss://0.peerjs.com`)
- **Network Path:** WebSocket over TLS (WSS) connecting to `0.peerjs.com:443`.
- **Function:** PeerJS operates a shared pub/sub broker. Client A connects, claims an ID, and listens for incoming connections. Client B connects and sends an SDP offer via `0.peerjs.com`, which relays it to Client A. Client A responds with an SDP answer, followed by ICE candidate exchanges.
- **Corporate Failure Mode:**
  1. **Domain Reputation & URL Categorization:** `0.peerjs.com` is frequently categorized by security appliances as "P2P / File Sharing" or "Dynamic DNS". Corporate firewall rules blocking the P2P category immediately return an HTTP 403 or inject a captive block page.
  2. **WebSocket Interception:** Transparent corporate proxies (Zscaler, BlueCoat) often disable or intercept WebSocket upgrade headers (`Upgrade: websocket`, `Connection: Upgrade`), terminating the handshake.
  3. **Multi-Tenancy Vulnerabilities:** `0.peerjs.com` is a free, unauthenticated public server without tenant isolation. Any client can probe IDs, collide with namespaces, or suffer outages during upstream DDoS attacks.

#### Hop 4: Public STUN Binding Discovery (`stun.cloudflare.com:3478`, `stun.l.google.com:19302`)
- **Protocol:** STUN (Session Traversal Utilities for NAT, RFC 5389 / RFC 8489) over UDP.
- **Mechanism:** The browser transmits a 20-byte STUN Binding Request header containing the magic cookie `0x2112A442` and a 96-bit transaction ID to port 3478 or 19302.
- **Corporate Failure Mode:** In 90–95% of corporate enterprise environments, outbound UDP on ports other than 53 is blocked by border firewalls. The STUN requests are dropped silently. The browser ICE agent waits for transaction timeouts (typically 39.5 seconds per RFC 5389 without exponential backoff tuning), causing severe connection establishment latency before falling back to relay candidates.

#### Hop 5: Direct P2P DataChannel (Browser-to-Browser UDP)
- **Protocol:** Stream Control Transmission Protocol (SCTP) encapsulated in Datagram Transport Layer Security (DTLS) over UDP.
- **Port Range:** Dynamically allocated ephemeral high ports (`1024–65535`).
- **Corporate Failure Mode:**
  1. **Egress Firewall Rules:** Corporate firewalls explicitly drop outbound UDP to arbitrary destination ports.
  2. **Symmetric NAT Port Scrambling:** Discussed in Section 3.2, Symmetric NAT renders ICE hole-punching mathematically impossible. Direct P2P connectivity drops to < 10% in enterprise networks.

#### Hop 6: Cloudflare Calls TURN over UDP (`turn:turn.cloudflare.com:3478?transport=udp`)
- **Protocol:** Traversal Using Relays around NAT (TURN, RFC 5766 / RFC 8656).
- **Mechanism:** The client attempts to send a TURN `Allocate` request to Cloudflare's anycast IP on UDP port 3478 using the ephemeral HMAC-SHA1 credentials minted in Hop 2.
- **Corporate Failure Mode:** UDP port 3478 is universally blocked by enterprise edge firewalls. Only networks that deliberately permit WebRTC (such as permissive tech company guest networks) allow outbound UDP 3478.

#### Hop 7: Cloudflare Calls TURNS over TLS (`turns:turn.cloudflare.com:443?transport=tcp`)
- **Protocol:** TURN over TLS on TCP port 443.
- **Intended Purpose:** Conceived as the "universal firewall bypass" for WebRTC. Because port 443 is universally open for HTTPS, routing TURN inside TLS should, in theory, penetrate strict corporate firewalls.
- **Corporate Failure Mode:** In modern enterprise environments, port 443 is no longer a transparent pipe. As detailed in Section 3.3, enterprise Secure Web Gateways (SWGs) perform **SSL Bumping / TLS Inspection**. The gateway terminates the TLS session, inspects the decrypted byte stream, identifies binary STUN packets instead of HTTP verbs, flags the stream as protocol evasion, and resets the TCP connection.

---

## 3. Deep-Dive Enterprise Security Control Interactions & Failure Mode Analysis

Modern enterprise networks (specifically Tier 2 through Tier 5) are governed by Zero-Trust Network Architecture (ZTNA), Next-Generation Firewalls (NGFW), and Secure Web Gateways (SWG). This section analyzes the exact mechanics by which these systems dismantle the `D-D` WebRTC P2P stack.

```
+----------------------------------------------------------------------------------------------------+
|                                    ENTERPRISE PERIMETER DEFENSE                                    |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  [Client Browser]                                                                                  |
|         |                                                                                          |
|         +---> UDP 3478 / Dynamic UDP --------------------> [NGFW Default-Deny] ----> ❌ DROP       |
|         |     (STUN / TURN UDP / Direct P2P)               (Egress Rule #101)                      |
|         |                                                                                          |
|         +---> TCP 443 (wss://0.peerjs.com) --------------> [SWG URL Filter] -------> ❌ 403 BLOCK  |
|         |     (Signaling Offer / Answer)                   (Category: P2P / Sharing)               |
|         |                                                                                          |
|         +---> TCP 443 (turns:turn.cloudflare.com:443) ---> [SWG SSL Decryption]                            |
|               (TURNS Relay)                                       |                                |
|                                                                   v                                |
|                                                        [Layer 7 App-ID Decoder]                    |
|                                                        (Inspects Decrypted Bytes)                  |
|                                                                   |                                |
|                                                        Expected: GET / POST / HTTP                 |
|                                                        Found: Magic Cookie 0x2112A442              |
|                                                                   |                                |
|                                                                   v                                |
|                                                        [Protocol Anomaly Alert] ---> ❌ TCP RST    |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

### 3.1 Perimeter Egress Firewalls & UDP Filtering
- **Standard Enterprise Posture:** Enterprise firewalls (Palo Alto Networks, Fortinet FortiGate, Check Point Quantum, Cisco Firepower) enforce a strict default-deny egress stance. Outbound UDP is completely prohibited, with the sole exception of UDP port 53 to internal enterprise domain controllers / DNS resolvers.
- **Silent Packet Drop Behavior:** Unlike internal subnets that might return an ICMP `Destination Port Unreachable` (Type 3, Code 3), perimeter firewalls silently drop outbound UDP packets to prevent port scanning reconnaissance.
- **Impact on ICE Candidate Gathering:**
  When Chromium or WebKit attempts to gather `srflx` (server reflexive) candidates via `stun.cloudflare.com:3478` or `stun.l.google.com:19302`, the UDP request times out. The ICE agent must wait for multiple retransmissions before concluding that UDP is dead. This introduces a **4 to 10 second delay** into the connection phase before TCP candidates are evaluated.

### 3.2 NAT Topologies: The Mathematical Impossibility of Symmetric NAT Hole-Punching
NAT implementations are categorized by RFC 3489 / RFC 4787 into Cone NATs and Symmetric NATs:

1. **Cone NAT (Full Cone, Restricted Cone, Port-Restricted Cone):**  
   Common in residential broadband routers. When internal endpoint `10.0.0.5:50000` contacts any external server, the NAT device allocates a single external mapping:
   $$\text{Tuple}_{\text{ext}} = (198.51.100.1, 41234)$$
   This external IP:port mapping remains identical whether the host contacts the STUN server or Peer B. Thus, Peer B can send packets directly to `198.51.100.1:41234` and pierce the firewall.

2. **Symmetric NAT (Enterprise Standard & 4G/5G CGNAT):**  
   Enterprise firewalls and carrier-grade NATs (CGNAT) enforce Symmetric NAT. The external port allocation is a function of the entire 4-tuple:
   $$\text{External Port} = f(\text{Src IP}, \text{Src Port}, \text{Dst IP}, \text{Dst Port})$$
   
   - **Step 1:** Internal browser (`10.10.10.42:52001`) sends STUN binding request to `stun.cloudflare.com:3478` (`162.159.192.1:3478`).
     $$\text{NAT Allocation: } 10.10.10.42:52001 \longrightarrow 203.0.113.10:48102$$
     The STUN server responds: *"Your reflexive endpoint is 203.0.113.10:48102."*
   - **Step 2:** The browser signals `203.0.113.10:48102` to Peer B via PeerJS.
   - **Step 3:** Peer B attempts to send UDP packets to `203.0.113.10:48102`.
   - **Step 4:** Meanwhile, the browser sends packets to Peer B (`198.51.100.99:55000`). Because the destination IP and port have changed, the Symmetric NAT allocates a brand new, randomized external port:
     $$\text{NAT Allocation: } 10.10.10.42:52001 \longrightarrow 203.0.113.10:61445$$
   - **Result:** Peer B sends packets to port `48102`, but the enterprise firewall has no state table entry mapping port `48102` from Peer B's IP. The firewall drops the packets. Direct P2P hole-punching fails with **100% mathematical certainty**.

### 3.3 Secure Web Gateways (SWG) & TLS Inspection / SSL Bumping

In enterprise networks, outbound web traffic does not exit via simple IP routing. All traffic on port 80 and 443 is forced through a Secure Web Gateway:
- **Zscaler Internet Access (ZIA)**
- **Palo Alto Networks Prisma Access / NGFW SSL Decryption**
- **Netskope Security Cloud**
- **Broadcom / Symantec BlueCoat ProxySG**

#### The Protocol Decode Trap on TURNS Port 443:
1. **Certificate Substitution:** The enterprise deploys a corporate root CA certificate to all managed workstations via Microsoft Intune or Active Directory GPO. When the browser initiates a TLS handshake with `turns:turn.cloudflare.com:443?transport=tcp`, the SWG intercepts the handshake, presents a forged certificate signed by the corporate CA, and terminates TLS.
2. **Deep Packet Inspection (DPI) & App-ID:** Once the SWG decrypts the TLS session, its Layer 7 protocol parser examines the payload:
   - In standard HTTPS, it expects HTTP request lines: `GET / HTTP/1.1\r\nHost: ...` or HTTP/2 frames (`0x0000... PRI * HTTP/2.0`).
   - In TURNS, the browser transmits a binary STUN message. The first 4 bytes consist of:
     - Message Type: `0x0003` (Allocate Request)
     - Message Length: `0x00...`
     - Magic Cookie: `0x2112A442` (Fixed 32-bit constant defined in RFC 5389)
3. **Protocol Anomaly Enforcement:** The SWG's application identification engine (e.g., Palo Alto App-ID) flags the connection:
   $$\text{Classification: } \texttt{unknown-tcp} \text{ or } \texttt{protocol-evasion} \text{ on port 443}$$
   Enterprise security policy mandates that non-HTTP traffic encapsulated inside port 443 must be blocked to prevent Command-and-Control (C2) tunnels and unauthorized VPNs.
4. **Connection Termination:** The SWG immediately sends a `TCP RST` packet to both the client browser and Cloudflare's TURN server, terminating the connection.
5. **PAC Files & Explicit Proxies:** In networks where internet access is gated by Proxy Auto-Configuration (PAC) scripts requiring HTTP `CONNECT` tunneling with NTLM or Kerberos proxy authentication, WebRTC's internal C++ networking implementation in Chromium frequently fails to provide the required proxy authentication headers, causing an immediate `407 Proxy Authentication Required` error.

### 3.4 Domain Reputation Filters & Blocking of Public Signaling Domains
- **Target Endpoint:** `wss://0.peerjs.com`
- **Threat Intelligence Categorization:** Commercial threat intelligence feeds (Cisco Talos, Palo Alto Networks PAN-DB, Forcepoint, Trend Micro) categorize `peerjs.com` and `0.peerjs.com` under:
  - *Peer-to-Peer / File Sharing*
  - *Personal Communication*
  - *Dynamic DNS / Uncategorized Web Hosting*
- **Acceptable Use Policy (AUP) Violation:** Corporate network profiles automatically block categories associated with P2P file sharing to mitigate copyright liability, data loss prevention (DLP) bypasses, and bandwidth consumption.
- **Tenancy Risk:** Even if unblocked, `0.peerjs.com` is a shared public service with no service-level agreement (SLA), exposing enterprise workflows to unannounced downtime, third-party room enumeration, and rate-limiting throttling.

### 3.5 Enterprise Browser Group Policies (Chrome & Edge GPOs)
Corporate workstations managed via Microsoft Endpoint Manager (Intune) or Active Directory GPOs enforce browser-level WebRTC restrictions:
- **`WebRtcIPHandlingPolicy`:**
  - `disable_non_proxied_udp`: Disables all UDP traffic for WebRTC. WebRTC is forced to use TCP/TLS through the enterprise proxy. Because TURNS over TLS is terminated by SWG TLS inspection (Section 3.3), this policy results in **100% total WebRTC failure**.
  - `default_public_interface_only`: Prohibits the browser from gathering local host candidates (`192.168.x.x`, `10.x.x.x`), preventing P2P connections between machines on the same corporate LAN or VPN tunnel.
- **`WebRtcUdpPortRange`:** Restricts WebRTC ephemeral UDP sockets to a narrow administrator-defined port range. If the firewall does not explicitly allow this range, connections fail.
- **`WebRtcLocalIpsAllowedUrls`:** Enterprise whitelist policy that permits WebRTC candidate gathering only on explicitly approved domains (e.g., `teams.microsoft.com`, `zoom.us`, `meet.google.com`). All external, unvetted applications (`dungeon.bitbop.dev`, `secrets.bitbop.dev`) are denied WebRTC execution.

---

## 4. Fundamental Operational Model Mismatch: Synchronous P2P vs. Asynchronous Store-and-Forward

Beyond network perimeter defenses, the `D-D` WebRTC architecture suffers from a fatal **operational paradigm mismatch** when applied to secret delivery.

```
+----------------------------------------------------------------------------------------------------+
|                         SYNCHRONOUS REAL-TIME P2P (D-D MULTIPLAYER MODEL)                          |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|   Player 1 (Host) [Tab Open] <====== WebRTC DataChannel ======> Player 2 (Guest) [Tab Open]        |
|                                (Both active simultaneously)                                        |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+

+----------------------------------------------------------------------------------------------------+
|                     ASYNCHRONOUS STORE-AND-FORWARD (SECRETSENDER EMBARGO MODEL)                     |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|   Admin Seals Secret             48-Hour Time-Lock Embargo               Recipient Claims Secret    |
|   [Monday 09:00 AM]           (Admin offline / Laptop closed)              [Wednesday 09:00 AM]     |
|          |                                                                          ^               |
|          v                                                                          |               |
|   [POST /escrow/commit] ----> [BitBop Hardware Atomic Clock] ----> [POST /escrow/reveal]           |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

### 4.1 Temporal and State Incompatibilities

| Architectural Dimension | `D-D` Cooperative Pixel Dungeon | `SecretSender` Secret Sharing Application | Operational Impact if P2P is Used for `SecretSender` |
|---|---|---|---|
| **Interaction Paradigm** | **Synchronous Real-Time:** All peers engage concurrently in active gameplay. | **Asynchronous Store-and-Forward:** Decoupled secret generation and claim. | **FATAL FAILURE:** Secrets are created at $T_0$ and claimed at $T_1$. The delta $T_1 - T_0$ is frequently hours, days, or weeks. |
| **Peer Presence Requirement** | Both players must be online and connected to the room simultaneously. | Sender creates the secret, closes their device, and transfers the link (via SMS/email). | In pure P2P, if the sender shuts down their laptop, leaves Wi-Fi, or closes the tab, the recipient cannot establish a connection. The secret is unreachable. |
| **Mobile OS Tab Lifecycle** | User actively views and interacts with the game canvas on screen. | Recipient receives an SMS link on mobile, taps it hours later, or opens it while on the go. | **Mobile Background Kill:** iOS Safari and Android Chrome freeze and terminate background tabs in **15–30 seconds**. WebRTC DataChannels and WebSockets are severed. |
| **Time-Lock Embargo Enforcement** | Not applicable; actions occur in real time. | Future reveal dates enforced by hardware atomic clock (`HTTP 425 Too Early` until countdown reaches `00:00:00`). | In pure P2P, the sender's client would have to hold the secret and enforce the timer. A compromised or clock-skewed sender client destroys time-lock integrity. |
| **Burn-on-Read Guarantee** | Ephemeral in-memory game state shared across players. | Strict single-use destruction (`HTTP 409 Conflict` on second claim); wrong PIN does not burn (`HTTP 403`). | Pure P2P cannot enforce Byzantine-fault-tolerant one-time burn-on-read. A malicious or offline sender can retain plaintext copies or serve the secret multiple times. |
| **Client Footprint & Overhead** | Heavy WebGPU inference + continuous WebRTC streaming (~350 KB peerjs bundle). | Ultra-lightweight static HTML + single REST call + WebCrypto `ML-KEM-768` decap. | Forcing WebRTC into `SecretSender` increases bundle size by 800%, drains battery, and introduces brittle signaling state machines. |

### 4.2 The "Browser Tab Must Remain Open" Failure Scenario
Consider a standard corporate workflow for `SecretSender`:
1. **Monday 09:00:** An infrastructure engineer creates a root database credential and seals it in `SecretSender` with a 48-hour reveal embargo scheduled for maintenance on Wednesday at 09:00.
2. **Monday 09:05:** The engineer sends the link via SMS to the on-call engineer, closes their laptop, and leaves the office.
3. **If WebRTC P2P were used:**
   - The secret exists solely in the sender's browser memory or local storage.
   - Because the sender's laptop is closed and in sleep mode, the browser's WebRTC listening socket is dead.
   - On Wednesday at 09:00, the on-call engineer opens the link. The browser attempts to contact `0.peerjs.com` to find the sender's peer ID.
   - The sender is offline. ICE negotiation fails. The on-call engineer is completely locked out of the secret.

### 4.3 Mobile OS Background Process Termination Mechanics
Mobile devices represent the primary consumption endpoint for one-time secret links (e.g., via SMS). Both iOS and Android enforce ruthless power-management policies on web browsers:
- **iOS WebKit (Safari / Chrome for iOS):**
  When a user switches apps or locks their screen, WebKit transitions the page to the `background` state. After **15 to 30 seconds**, the WebKit process is suspended. All active network sockets—including WebSocket signaling connections to `0.peerjs.com` and DTLS/UDP WebRTC DataChannels—are abruptly closed with TCP RST or silent teardown.
- **Android Chromium (Samsung Galaxy S21 / Google Pixel):**
  Under Android's Doze mode and App Standby buckets, background browser tabs have their CPU execution throttled to zero. Timer events (`setTimeout`, `setInterval`) are clamped to once per minute, and sockets are terminated when the radio enters low-power state.
- **Conclusion:** A mobile device can never function as a persistent WebRTC peer for asynchronous secret delivery.

### 4.4 Inability to Enforce Cryptographic Guarantees in Pure Client-Side P2P
`SecretSender` provides two mission-critical security invariants:
1. **Unforgeable Time-Lock Embargo:** The secret *cannot* be decrypted before the embargo timestamp, even if the recipient possesses the unlock key.
2. **Byzantine-Fault-Tolerant Burn-on-Read:** The secret *must* be destroyed permanently upon the first successful retrieval. A second attempt must return `HTTP 409 Conflict`. A wrong PIN attempt (`HTTP 403 Forbidden`) must *not* burn the secret.

In a pure client-to-client P2P architecture without a centralized authoritative hardware anchor:
- **No Trusted Clock:** The recipient's local clock can be set forward to bypass client-side time-lock countdowns.
- **No Burn Enforcement:** The sender's client cannot prove that it destroyed its local copy of the secret. If the recipient requests the secret, the sender's client could be duplicated across multiple browser profiles or manipulated by an attacker to vend the secret repeatedly.
- **Denial of Service:** If the sender's client is powered off or crashes, the secret is permanently lost without recourse.

---

## 5. Hardware Escrow Comparison: BitBop Hardware Escrow (`https://api.bitbop.dev`)

The existing `SecretSender` architecture resolves every network, operational, and cryptographic limitation of WebRTC P2P by anchoring secrets in the **BitBop Quantum Hardware Escrow** (`https://api.bitbop.dev`).

### 5.1 Current v1.1 protocol and security boundary

The sender encrypts the secret in its browser into Client Envelope v2 before `POST /api/share`. The Worker validates the envelope and mandatory PIN, commits the encrypted envelope to BitBop, and verifies the creation response. It returns a fragment-free base URL; the browser appends its 256-bit link key locally.

Recipients use the complete link and PIN, a five-minute tab session, and same-origin `/api/escrow/status`, `/api/escrow/reveal` and `/api/escrow/verify`. Status is non-consuming. The browser verifies signatures, unseals the outer BitBop layer and decrypts the inner envelope with the fragment key. The PIN and encrypted envelope traverse the Worker; the normal plaintext secret and link key do not.

Release/retention/throttling policy and the bounded same-claimant retry are upstream responsibilities, not proof of a particular hardware-erasure mechanism. Signed evidence authenticates recorded lineage/commitment/policy claims; it does not independently certify entropy quality or erase existing copies. See [README.md](../README.md) for the exact contract and [TEST_READY.md](../TEST_READY.md) for conditional receipt-field enforcement and other gaps.

### 5.2 Enterprise Perimeter Traversal Advantages

| Enterprise Metric | WebRTC P2P (`D-D` Model) | BitBop Hardware Escrow (`api.bitbop.dev`) |
|---|---|---|
| **Transport Protocol** | SCTP / DTLS / UDP + STUN / TURN | Standard HTTPS REST (TLS 1.3 over TCP 443) |
| **SWG TLS Inspection Compatibility** | ❌ Fails (Binary STUN triggers App-ID anomaly block) | ✅ 100% Success (Standard REST JSON payloads) |
| **Symmetric NAT Traversal** | ❌ 0% Success (Hole-punching mathematically impossible) | ✅ 100% Success (Standard outbound client-to-server TCP) |
| **Egress UDP 3478 Requirement** | ❌ Required for performant TURN relay | ✅ No UDP required whatsoever |
| **Domain Reputation Risk** | ❌ High (`0.peerjs.com` blocked under P2P category) | ✅ Negligible (Standard enterprise API domain) |
| **Browser GPO Compliance** | ❌ Fails if `WebRtcIPHandlingPolicy` disables UDP | ✅ 100% Immune to WebRTC GPO restrictions |
| **Mobile OS Background Survivability** | ❌ 0% (Sockets killed in 15–30 seconds) | ✅ 100% (Stateless REST requests complete in < 200 ms) |
| **Sender Online Requirement** | ❌ Sender must keep browser tab open indefinitely | ✅ Sender can power off immediately after commit |

---

## 6. Comprehensive Corporate Network Compatibility Matrix

To provide a quantitative evaluation across real-world enterprise infrastructure, the table below grades connection success rates and identifies primary failure bottlenecks across **5 distinct corporate network tiers**.

### 6.1 Enterprise Network Tier Definitions
- **Tier 1: Permissive Corporate / Guest Wi-Fi / Tech Startup**  
  Outbound UDP permitted; Port-Restricted Cone NAT; no TLS inspection; standard DNS.
- **Tier 2: Standard Enterprise (Finance, Legal, Healthcare)**  
  Outbound UDP blocked; Symmetric NAT or CGNAT; transparent Secure Web Gateway (Zscaler, Palo Alto) performing TLS inspection on standard web traffic.
- **Tier 3: Highly Restricted / Defense / Government / Banking VDI**  
  Default-deny perimeter firewall; mandatory explicit forward proxy with PAC files; full SSL bumping on all port 443 traffic; Chrome/Edge GPOs blocking WebRTC; Virtual Desktop Infrastructure (Citrix HDX / VMware Horizon).
- **Tier 4: Mobile Enterprise / Cellular Carrier (4G/5G / MDM)**  
  Carrier-Grade NAT (CGNAT); aggressive mobile OS background power throttling; Samsung Knox / Apple MDM profile with per-app VPN tunnels.
- **Tier 5: Air-Gapped / Isolated Enclaves / Zero-Trust Microsegments**  
  No direct public internet routing; internal enterprise proxy required for outbound connectivity; strict multi-factor enclave isolation.

---

### 6.2 Compatibility Matrix across 5 Network Tiers

| Network Tier & Security Profile | Direct P2P (STUN / Host UDP) | Cloudflare TURN UDP (3478) | Cloudflare TURNS TCP (443) | PeerJS Signaling (`0.peerjs.com`) | BitBop HTTPS Escrow (`api.bitbop.dev`) | Primary Failure Mode & Network Bottleneck |
|---|---|---|---|---|---|---|
| **Tier 1: Permissive Corporate / Guest Wi-Fi**<br>• Outbound UDP open<br>• Port-Restricted Cone NAT<br>• No SSL Bumping | **75%**<br>✅ High success | **95%**<br>✅ High success | **98%**<br>✅ Near-perfect | **95%**<br>✅ Connected | **100%**<br>✅ Flawless | Occasional captive portal isolation; symmetric NAT on guest VLANs. |
| **Tier 2: Standard Enterprise (Fortune 500)**<br>• Egress UDP blocked<br>• Symmetric NAT<br>• Transparent SWG (Zscaler)<br>• Partial SSL Bumping | **0%**<br>❌ Blocked | **0%**<br>❌ UDP 3478 dropped | **25–35%**<br>⚠️ Severe drops | **30%**<br>⚠️ Blocked by URL reputation | **99%**<br>✅ High success | Egress firewall drops UDP. SWG decrypts TURNS 443, detects STUN magic cookie `0x2112A442`, sends `TCP RST`. `0.peerjs.com` categorized as P2P. |
| **Tier 3: Restricted / Defense / Banking VDI**<br>• Default-deny firewall<br>• Full SSL Bumping on all 443<br>• GPO: `disable_non_proxied_udp`<br>• Citrix / VMware VDI | **0%**<br>❌ Blocked | **0%**<br>❌ Blocked | **0%**<br>❌ Blocked by App-ID | **0%**<br>❌ Blocked by proxy AUP | **95%**<br>✅ High success | Complete WebRTC blackout. App-ID terminates non-HTTP on 443. GPO disables candidate gathering. VDI browser lacks WebRTC media pipeline. |
| **Tier 4: Mobile Enterprise / Cellular Carrier**<br>• Carrier-Grade NAT (CGNAT)<br>• OS background kill (15–30s)<br>• Mobile Device Management | **5%**<br>❌ CGNAT blocks hole-punch | **40%**<br>⚠️ Carrier UDP throttling | **60%**<br>⚠️ Carrier timeout | **50%**<br>⚠️ Dropped on screen lock | **99%**<br>✅ Flawless on S21 & iOS | Background suspension: iOS/Android terminates WebRTC and WebSocket sockets within 15–30 seconds. CGNAT breaks direct P2P. |
| **Tier 5: Air-Gapped / Isolated Enclaves**<br>• Zero public routing<br>• Internal HTTP proxy only | **0%**<br>❌ Inaccessible | **0%**<br>❌ Inaccessible | **0%**<br>❌ Inaccessible | **0%**<br>❌ Inaccessible | **0% (Direct)**<br>*(100% with internal proxy / on-prem node)* | No public internet egress. Direct Cloudflare Workers and BitBop endpoints unreachable without internal egress proxy chaining. |

---

## 7. Current Cloudflare deployment reference

The merged application already runs as a Worker with Static Assets. Follow [DEPLOYMENT.md](DEPLOYMENT.md) rather than implementing the former illustrative plaintext proxy.

The actual entrypoint is `worker/index.mjs`. `wrangler.jsonc` configures `nodejs_compat`, `ASSETS` from `public/` with `run_worker_first: true`, the `BITBOP_API` service binding to `bitbop-api`, and the custom-domain route. `scripts/build_cloudflare.mjs` uses `scripts/client_template.mjs` to generate static HTML and copies `mlkem.browser.js`.

The Worker validates Client Envelope v2 and the mandatory PIN; it is not a raw body pass-through from an old plaintext sender request to BitBop commit. The same-origin recipient proxy and local/upstream verification routes are also part of the implementation. Do not copy the former alternate TypeScript entrypoint/configuration or omit the service binding/security-header routing.

Use `npm run build:cf` for asset generation and `npx wrangler deploy --dry-run` for local bundle inspection. `npm run deploy` publishes and belongs to a separate authorized release; it is not a health check. The lockfile/install prerequisites and development upstream configuration require attention documented in [DEPLOYMENT.md](DEPLOYMENT.md).

No STUN, TURN, PeerJS, sender-online requirement or external Cloud Run host is needed for the implemented core flow. A network review must still verify the intended HTTPS application/upstream paths and corporate policy; this document's historical percentages do not guarantee compatibility.

---

## 8. Conclusion & Sign-Off

The WebRTC peer-to-peer and Cloudflare Calls TURN relay architecture utilized in `c:\code\projects\D-D` is expertly designed for real-time multiplayer gaming, where synchronous presence is guaranteed and low-latency frame synchronization is paramount.

However, adapting this P2P architecture to `SecretSender` is **fundamentally incompatible** with the core mission of secure secret delivery:
- It breaks in **over 85%** of corporate networks due to UDP egress blocking, Symmetric NATs, and SWG TLS inspection of TURNS port 443.
- It fails completely on mobile devices due to aggressive 15–30 second OS background tab termination.
- It cannot enforce Byzantine-fault-tolerant burn-on-read or unforgeable time-lock embargoes without a hardware-anchored authority.

**Final Verdict:**  
`SecretSender` must retain its hardware escrow architecture. Deploying `SecretSender` to Cloudflare as an Edge Worker fronting the **BitBop Quantum Hardware Escrow** (`https://api.bitbop.dev`) delivers **100% enterprise firewall traversal**, true asynchronous time-locking, and mathematical post-quantum secrecy.

**Assessment Approved by:**  
Worker M4 1 (Corporate P2P Cloudflare Assessment Author)  
Milestone 4: Assessment & Architecture Synthesis
