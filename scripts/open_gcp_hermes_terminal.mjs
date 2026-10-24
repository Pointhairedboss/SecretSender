/**
 * BitBop Local Session Launchpad & Google Cloud IAM Controller (127.0.0.1:8889)
 *
 * Key Guarantees:
 *   1. DOM-Preserving Card Lifecycle: Spawning, expanding, pausing, or closing a Session Card
 *      modifies ONLY that card's DOM node (`appendChild` / `remove`), so existing `<iframe class="pty-frame">`
 *      instances are NEVER reloaded or cleared when you open additional cards.
 *   2. Per-Card Isolated WebSocket PTYs: Each card's `/terminal/?session=card-N` iframe tags its own
 *      WebSocket (`window.__ttydWs` + `/terminal/ws?session=card-N`), so macro buttons, Pause, and Close
 *      operate strictly on that single card without affecting any other open cards.
 *   3. Zero Idle Cost When Sleeping: With 0 live cards, 0 connections exist to Cloud Run ($0.00/hr).
 */

import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { execSync } from 'node:child_process';

const CLOUD_RUN_HOST = process.env.CLOUD_RUN_HOST || 'uat-agent-reflector-vwn34fypca-ts.a.run.app';
const LOCAL_PORT = Number(process.env.LOCAL_PROXY_PORT || 8889);
const IDLE_TIMEOUT_MS = Number(process.env.IDLE_TIMEOUT_MS || 15 * 60 * 1000); // 15 minutes default
const GCLOUD_BIN =
  process.env.GCLOUD_BIN ||
  `${process.env.LOCALAPPDATA}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd`;

let cachedToken = '';
let tokenExpiryMs = 0;

// Map<sockId, { sockId, cardId, client, upstream, createdAt }>
const activeSockets = new Map();
let nextSocketId = 1;

function getIdentityToken() {
  if (cachedToken && Date.now() < tokenExpiryMs) {
    return cachedToken;
  }
  cachedToken = execSync(`"${GCLOUD_BIN}" auth print-identity-token`, { encoding: 'utf8' }).trim();
  tokenExpiryMs = Date.now() + 30 * 60 * 1000;
  return cachedToken;
}

function renderLaunchpadHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BitBop Cloud Agent Launchpad — Session Card Controller</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600;700&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #0F1012;
      --surface-low: #0B0C0E;
      --card: #16181D;
      --card-hi: #1B1E24;
      --border: #262932;
      --gold: #FFD600;
      --gold-hover: #FFE14D;
      --emerald: #10B981;
      --red: #F87171;
      --cyan: #38BDF8;
      --text: #F1F5F9;
      --muted: #94A3B8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: 'Inter', system-ui, sans-serif;
      padding: 20px 24px 48px;
      background-image: radial-gradient(rgba(255, 214, 0, 0.05) 1px, transparent 1px);
      background-size: 24px 24px;
    }
    .wrap { max-width: 1440px; margin: 0 auto; }

    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 14px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 20px;
    }
    .brand h1 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 1.25rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin: 0;
      color: var(--gold);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .brand p {
      margin: 4px 0 0;
      font-size: 0.8rem;
      color: var(--muted);
      font-family: 'JetBrains Mono', monospace;
    }
    .telemetry-pills {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }
    .pill {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.76rem;
      padding: 6px 12px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface-low);
      color: var(--muted);
    }
    .pill.zero {
      border-color: rgba(16, 185, 129, 0.45);
      background: rgba(16, 185, 129, 0.1);
      color: var(--emerald);
    }
    .pill.active {
      border-color: rgba(255, 214, 0, 0.55);
      background: rgba(255, 214, 0, 0.12);
      color: var(--gold);
    }

    .launcher-deck {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      margin-bottom: 22px;
      padding: 14px 18px;
      background: var(--surface-low);
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    .launcher-label {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      margin-right: 6px;
    }
    .btn {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 9px 15px;
      border-radius: 8px;
      border: 1px solid var(--gold);
      background: var(--gold);
      color: #1A1600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn:hover { background: var(--gold-hover); }
    .btn.secondary {
      background: var(--card-hi);
      color: var(--text);
      border-color: var(--border);
    }
    .btn.secondary:hover {
      border-color: var(--gold);
      color: var(--gold);
    }
    .btn.danger {
      background: rgba(248, 113, 113, 0.12);
      color: var(--red);
      border-color: rgba(248, 113, 113, 0.45);
      margin-left: auto;
    }
    .btn.danger:hover {
      background: rgba(248, 113, 113, 0.24);
    }

    .sessions-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(620px, 1fr));
      gap: 18px;
    }
    .session-card {
      background: var(--card);
      border: 1.5px solid var(--gold);
      border-radius: 12px;
      padding: 14px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
      display: flex;
      flex-direction: column;
      transition: border-color 0.2s ease;
    }
    .session-card.paused {
      border-color: var(--border);
      opacity: 0.88;
    }
    .session-card.expanded {
      grid-column: 1 / -1;
    }
    .card-hdr {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }
    .card-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 0.95rem;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--gold);
    }
    .status-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--emerald);
      box-shadow: 0 0 8px var(--emerald);
    }
    .status-dot.paused {
      background: var(--muted);
      box-shadow: none;
    }
    .card-meta {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.73rem;
      color: var(--muted);
    }
    .card-controls {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .chip {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.72rem;
      padding: 5px 10px;
      border-radius: 6px;
      background: var(--surface-low);
      color: var(--text);
      border: 1px solid var(--border);
      cursor: pointer;
    }
    .chip:hover {
      border-color: var(--gold);
      color: var(--gold);
    }
    .chip.gold {
      background: rgba(255, 214, 0, 0.14);
      border-color: var(--gold);
      color: var(--gold);
      font-weight: 600;
    }
    .chip.kill {
      background: rgba(248, 113, 113, 0.12);
      border-color: rgba(248, 113, 113, 0.4);
      color: var(--red);
    }
    .chip.kill:hover {
      background: rgba(248, 113, 113, 0.25);
    }
    .macro-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
    }
    iframe.pty-frame {
      width: 100%;
      height: 460px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #0B0C0E;
    }
    .session-card.expanded iframe.pty-frame {
      height: 660px;
    }
    .paused-placeholder {
      height: 220px;
      border: 1px dashed var(--border);
      border-radius: 8px;
      background: var(--surface-low);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: var(--muted);
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.82rem;
    }
    .empty-state {
      grid-column: 1 / -1;
      background: var(--card);
      border: 1px dashed var(--border);
      border-radius: 12px;
      padding: 48px 24px;
      text-align: center;
    }
    .empty-state h3 {
      font-family: 'Space Grotesk', sans-serif;
      text-transform: uppercase;
      color: var(--emerald);
      margin: 0 0 8px;
      font-size: 1.05rem;
    }
    .empty-state p {
      color: var(--muted);
      font-size: 0.86rem;
      max-width: 580px;
      margin: 0 auto 20px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div class="brand">
        <h1>⚡ BitBop Ephemeral Cloud Agent Launchpad</h1>
        <p>Local Session Controller (127.0.0.1:${LOCAL_PORT}) → IAM Tunnel (gavinrknight@gmail.com) → ${CLOUD_RUN_HOST}</p>
      </div>
      <div class="telemetry-pills">
        <div id="pill-state" class="pill zero">● SLEEPING (0 Active Cloud Sessions · $0.00/hr)</div>
        <div id="pill-sockets" class="pill">Open PTY Sockets: 0 / 10 per container</div>
        <div class="pill">Idle Cut-off: 15m</div>
      </div>
    </div>

    <div class="launcher-deck">
      <span class="launcher-label">Spawn Session Card:</span>
      <button class="btn" onclick="spawnSession({ title: 'Hermes Interactive Terminal', initCmd: '' })">
        + New Hermes Terminal Card
      </button>
      <button class="btn secondary" onclick="spawnSession({ title: 'BitBop Security & TLS Audit', initCmd: '/audit' })">
        + 🛡️ Audit *.bitbop.dev Card
      </button>
      <button class="btn secondary" onclick="spawnSession({ title: 'Fast Flash-Lite Terminal', initCmd: '/model gemini-3.5-flash-lite' })">
        + 🚀 Flash-Lite Card
      </button>
      <button class="btn secondary" onclick="spawnSession({ title: 'Container Linux Bash Shell', initCmd: '/bash' })">
        + 🐚 Raw Bash Card
      </button>
      <button class="btn danger" onclick="killAllSessions()">
        🛑 Kill All Cards (Scale to $0)
      </button>
    </div>

    <div id="sessions-grid" class="sessions-grid"></div>
  </div>

  <script>
    let sessions = [];
    let seq = 1;

    function formatDuration(sec) {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }

    function buildLiveBodyHtml(s) {
      return \`
        <div class="macro-bar">
          <button class="chip gold" onclick="injectCommand('\${s.id}', '/audit')">🛡️ /audit *.bitbop.dev</button>
          <button class="chip" onclick="injectCommand('\${s.id}', 'Inspect DNS CAA,SPF,DMARC and TLS 1.3 ciphers for bitbop.dev and secrets.bitbop.dev')">🔍 DNS & TLS 1.3</button>
          <button class="chip" onclick="injectCommand('\${s.id}', '/model gemini-3.8-flash')">⚡ gemini-3.8-flash</button>
          <button class="chip" onclick="injectCommand('\${s.id}', '/model gemini-3.5-flash-lite')">🚀 gemini-3.5-flash-lite</button>
          <button class="chip" onclick="injectCommand('\${s.id}', '/config')">📄 /config</button>
          <button class="chip" onclick="injectCommand('\${s.id}', '/reset')">🔄 /reset</button>
          <button class="chip" onclick="injectCommand('\${s.id}', '/bash')">🐚 /bash</button>
        </div>
        <iframe id="iframe-\${s.id}" class="pty-frame" src="/terminal/?session=\${s.id}" allow="clipboard-read; clipboard-write"></iframe>
      \`;
    }

    function buildPausedBodyHtml(s) {
      return \`
        <div class="paused-placeholder">
          <div>⏸ Session Card #\${s.num} is paused — WebSocket closed (0 CPU billed).</div>
          <button class="btn" onclick="togglePause('\${s.id}')">▶ Resume Terminal Card</button>
        </div>
      \`;
    }

    function syncEmptyState() {
      const grid = document.getElementById('sessions-grid');
      const emptyEl = document.getElementById('empty-state-box');
      if (sessions.length === 0) {
        if (!emptyEl) {
          grid.innerHTML = \`
            <div id="empty-state-box" class="empty-state">
              <h3>● Zero Active Cloud Sessions — Cloud Run Scaled to $0.00/hr</h3>
              <p>
                This Launchpad runs locally on <code>127.0.0.1:${LOCAL_PORT}</code> and costs nothing while open.
                Click <strong>+ New Hermes Terminal Card</strong> above whenever you want to wake an ephemeral
                Google Cloud Run session, and close or pause the card when done.
              </p>
              <button class="btn" onclick="spawnSession({ title: 'Hermes Interactive Terminal' })">
                + Launch Hermes Terminal Card Now
              </button>
            </div>
          \`;
        }
      } else if (emptyEl) {
        emptyEl.remove();
      }
    }

    function spawnSession(opts = {}) {
      const id = 'card-' + (seq++);
      const session = {
        id,
        num: seq - 1,
        title: opts.title || 'Hermes Terminal',
        status: 'live',
        expanded: false,
        createdAt: Date.now(),
        initCmd: opts.initCmd || ''
      };
      sessions.push(session);
      syncEmptyState();

      // Append ONLY the new card DOM element so existing card iframes are NEVER touched or reloaded!
      const grid = document.getElementById('sessions-grid');
      const cardEl = document.createElement('div');
      cardEl.className = 'session-card';
      cardEl.id = 'wrap-' + session.id;
      cardEl.innerHTML = \`
        <div class="card-hdr">
          <div class="card-title">
            <span id="dot-\${session.id}" class="status-dot"></span>
            <span>CARD #\${session.num} · \${session.title}</span>
            <span class="card-meta" id="timer-\${session.id}">LIVE (00:00)</span>
          </div>
          <div class="card-controls">
            <button id="btn-exp-\${session.id}" class="chip" onclick="toggleExpand('\${session.id}')">⛶ Full Width</button>
            <button id="btn-pause-\${session.id}" class="chip" onclick="togglePause('\${session.id}')">⏸ Pause ($0)</button>
            <button class="chip kill" onclick="closeSession('\${session.id}')">✖ Close Card</button>
          </div>
        </div>
        <div id="body-\${session.id}">
          \${buildLiveBodyHtml(session)}
        </div>
      \`;
      grid.appendChild(cardEl);

      if (session.initCmd) {
        setTimeout(() => {
          injectCommand(id, session.initCmd);
        }, 2300);
      }
      setTimeout(refreshStatus, 400);
    }

    async function togglePause(id) {
      const s = sessions.find(x => x.id === id);
      if (!s) return;
      s.status = s.status === 'live' ? 'paused' : 'live';
      const wrap = document.getElementById('wrap-' + id);
      const dot = document.getElementById('dot-' + id);
      const timer = document.getElementById('timer-' + id);
      const btnPause = document.getElementById('btn-pause-' + id);
      const body = document.getElementById('body-' + id);

      if (s.status === 'paused') {
        if (wrap) wrap.classList.add('paused');
        if (dot) dot.classList.add('paused');
        if (timer) timer.textContent = 'PAUSED ($0/hr)';
        if (btnPause) btnPause.textContent = '▶ Resume';
        if (body) body.innerHTML = buildPausedBodyHtml(s);
        await fetch('/local/kill-card', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId: id })
        });
      } else {
        s.createdAt = Date.now();
        if (wrap) wrap.classList.remove('paused');
        if (dot) dot.classList.remove('paused');
        if (timer) timer.textContent = 'LIVE (00:00)';
        if (btnPause) btnPause.textContent = '⏸ Pause ($0)';
        if (body) body.innerHTML = buildLiveBodyHtml(s);
      }
      setTimeout(refreshStatus, 400);
    }

    function toggleExpand(id) {
      const s = sessions.find(x => x.id === id);
      if (!s) return;
      s.expanded = !s.expanded;
      const wrap = document.getElementById('wrap-' + id);
      const btnExp = document.getElementById('btn-exp-' + id);
      if (wrap) wrap.classList.toggle('expanded', s.expanded);
      if (btnExp) btnExp.textContent = s.expanded ? '🗗 Side-by-Side' : '⛶ Full Width';
    }

    async function closeSession(id) {
      sessions = sessions.filter(x => x.id !== id);
      const wrap = document.getElementById('wrap-' + id);
      if (wrap) wrap.remove();
      syncEmptyState();
      await fetch('/local/kill-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: id })
      });
      refreshStatus();
    }

    async function killAllSessions() {
      sessions = [];
      const grid = document.getElementById('sessions-grid');
      grid.innerHTML = '';
      syncEmptyState();
      await fetch('/local/kill-all', { method: 'POST' });
      refreshStatus();
    }

    async function injectCommand(cardId, cmd) {
      try {
        const iframe = document.getElementById('iframe-' + cardId);
        // 1. Prefer direct per-card WebSocket frame injection into that card's own ttyd instance
        if (iframe && iframe.contentWindow && iframe.contentWindow.__ttydWs) {
          const ws = iframe.contentWindow.__ttydWs;
          if (ws.readyState === 1) {
            const bytes = new TextEncoder().encode('0' + cmd + '\\r');
            ws.send(bytes);
            iframe.contentWindow.focus();
            return;
          }
        }
        // 2. Fallback: ask local proxy to write into that card's tracked socket
        await fetch('/local/inject-card', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId, command: cmd })
        });
        if (iframe && iframe.contentWindow) iframe.contentWindow.focus();
      } catch (e) {
        console.error('Inject failed:', e);
      }
    }

    async function refreshStatus() {
      try {
        const r = await fetch('/local/status');
        const d = await r.json();
        const pillState = document.getElementById('pill-state');
        const pillSockets = document.getElementById('pill-sockets');
        const liveCards = sessions.filter(x => x.status === 'live').length;
        const count = d.active_sockets || 0;

        pillSockets.textContent = 'Open PTY Sockets: ' + count + ' / 10 per container';
        if (count === 0 && liveCards === 0) {
          pillState.className = 'pill zero';
          pillState.textContent = '● SLEEPING (0 Active Cloud Sessions · $0.00/hr)';
        } else {
          const activeCount = Math.max(count, liveCards);
          const containers = Math.max(1, Math.ceil(activeCount / 10));
          const rate = (containers * 0.19).toFixed(2);
          pillState.className = 'pill active';
          pillState.textContent = '⚡ LIVE (' + liveCards + ' Card' + (liveCards === 1 ? '' : 's') + ' · ' + count + ' PTY · ' + containers + ' GCP Container · ~$' + rate + '/hr)';
        }

        for (const s of sessions) {
          const el = document.getElementById('timer-' + s.id);
          if (el && s.status === 'live') {
            const up = Math.floor((Date.now() - s.createdAt) / 1000);
            el.textContent = 'LIVE (' + formatDuration(up) + ')';
          }
        }
      } catch {}
    }

    spawnSession({ title: 'Hermes Interactive Terminal' });
    setInterval(refreshStatus, 2000);
  </script>
</body>
</html>`;
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', `http://127.0.0.1:${LOCAL_PORT}`);

  // 1. Local Launchpad UI & Session Control API
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/launchpad')) {
    const html = renderLaunchpadHtml();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
    return;
  }

  if (req.method === 'GET' && u.pathname === '/local/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(
      JSON.stringify({
        ok: true,
        active_sockets: activeSockets.size,
        cards: Array.from(activeSockets.values()).map((s) => ({ sockId: s.sockId, cardId: s.cardId })),
        cloud_run_host: CLOUD_RUN_HOST,
        idle_timeout_ms: IDLE_TIMEOUT_MS,
      })
    );
    return;
  }

  if (req.method === 'POST' && u.pathname === '/local/kill-card') {
    const body = await readJsonBody(req);
    const targetCard = String(body.cardId || '');
    let closed = 0;
    for (const [sockId, entry] of activeSockets.entries()) {
      if (entry.cardId === targetCard) {
        try {
          entry.upstream.destroy();
          entry.client.destroy();
          closed++;
        } catch {}
        activeSockets.delete(sockId);
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, cardId: targetCard, closed_sockets: closed }));
    return;
  }

  if (req.method === 'POST' && u.pathname === '/local/kill-all') {
    let closed = 0;
    for (const [, entry] of activeSockets.entries()) {
      try {
        entry.upstream.destroy();
        entry.client.destroy();
        closed++;
      } catch {}
    }
    activeSockets.clear();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, closed_sockets: closed }));
    return;
  }

  // 2. Proxy Cloud Run endpoints (/terminal/*, /api/*, /reflect, /v1/*) with Google IAM Bearer Token
  let token = '';
  try {
    token = getIdentityToken();
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Failed to obtain Google IAM token: ${err.message}`);
    return;
  }

  // Strip accept-encoding on /terminal/ HTML so we can inject the per-card WebSocket hook script cleanly
  const isTerminalHtml = u.pathname === '/terminal/';
  const headers = { ...req.headers, host: CLOUD_RUN_HOST, Authorization: `Bearer ${token}` };
  if (isTerminalHtml) {
    delete headers['accept-encoding'];
  }

  const upstreamPath = u.pathname === '/cloud-console' ? '/' : req.url;
  const proxyReq = https.request(
    {
      hostname: CLOUD_RUN_HOST,
      port: 443,
      path: upstreamPath,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      if (isTerminalHtml && (proxyRes.statusCode || 200) === 200) {
        const chunks = [];
        proxyRes.on('data', (c) => chunks.push(c));
        proxyRes.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf8');
          const sessionParam = u.searchParams.get('session') || '';
          const hookScript = `<script>
            (function() {
              const OrigWS = window.WebSocket;
              const sessionTag = ${JSON.stringify(sessionParam)};
              window.WebSocket = function(url, protocols) {
                let taggedUrl = url;
                if (sessionTag && String(url).includes('/terminal/ws')) {
                  taggedUrl = String(url) + (String(url).includes('?') ? '&' : '?') + 'session=' + encodeURIComponent(sessionTag);
                }
                const ws = protocols ? new OrigWS(taggedUrl, protocols) : new OrigWS(taggedUrl);
                window.__ttydWs = ws;
                return ws;
              };
              window.WebSocket.prototype = OrigWS.prototype;
              Object.assign(window.WebSocket, OrigWS);
            })();
          </script>`;
          html = html.replace('<head>', '<head>' + hookScript);
          const outBuf = Buffer.from(html, 'utf8');
          const resHeaders = { ...proxyRes.headers, 'content-length': String(outBuf.length) };
          res.writeHead(200, resHeaders);
          res.end(outBuf);
        });
        return;
      }
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`Upstream Cloud Run error: ${err.message}`);
  });
  req.pipe(proxyReq);
});

server.on('upgrade', (req, clientSocket, head) => {
  let token = '';
  try {
    token = getIdentityToken();
  } catch {
    clientSocket.destroy();
    return;
  }

  const u = new URL(req.url || '/', `http://127.0.0.1:${LOCAL_PORT}`);
  const cardId = u.searchParams.get('session') || `anon-${nextSocketId}`;
  // Strip ?session=... before forwarding to ttyd so ttyd sees exact `/terminal/ws`
  const upstreamUrl = u.pathname;

  const sockId = nextSocketId++;
  const upstream = tls.connect(
    {
      host: CLOUD_RUN_HOST,
      port: 443,
      servername: CLOUD_RUN_HOST,
    },
    () => {
      let raw = `${req.method} ${upstreamUrl} HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i];
        const v = req.rawHeaders[i + 1];
        if (k.toLowerCase() === 'host') continue;
        if (k.toLowerCase() === 'origin') {
          raw += `Origin: https://${CLOUD_RUN_HOST}\r\n`;
          continue;
        }
        raw += `${k}: ${v}\r\n`;
      }
      raw += `Host: ${CLOUD_RUN_HOST}\r\n`;
      raw += `Authorization: Bearer ${token}\r\n\r\n`;
      upstream.write(raw);
      if (head && head.length) upstream.write(head);
      clientSocket.pipe(upstream).pipe(clientSocket);

      activeSockets.set(sockId, { sockId, cardId, client: clientSocket, upstream, createdAt: Date.now() });

      let idleTimer = setTimeout(() => {
        console.log(`[Idle-Guard] Closing inactive PTY socket #${sockId} (${cardId}) after 15m of no input.`);
        upstream.destroy();
        clientSocket.destroy();
      }, IDLE_TIMEOUT_MS);

      clientSocket.on('data', () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          console.log(`[Idle-Guard] Closing inactive PTY socket #${sockId} (${cardId}) after 15m of no input.`);
          upstream.destroy();
          clientSocket.destroy();
        }, IDLE_TIMEOUT_MS);
      });

      const cleanup = () => {
        clearTimeout(idleTimer);
        activeSockets.delete(sockId);
      };
      clientSocket.on('close', cleanup);
      upstream.on('close', cleanup);
    }
  );

  upstream.on('error', () => {
    activeSockets.delete(sockId);
    clientSocket.destroy();
  });
  clientSocket.on('error', () => {
    activeSockets.delete(sockId);
    upstream.destroy();
  });
});

const targetPath = process.argv[2] || '/';
const targetUrl = `http://127.0.0.1:${LOCAL_PORT}${targetPath}`;

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.log(`Launchpad already running on http://127.0.0.1:${LOCAL_PORT} — opening browser...`);
    try {
      execSync(`start "" "${targetUrl}"`, { stdio: 'ignore' });
    } catch {}
    process.exit(0);
  }
  console.error('Launchpad server error:', err);
  process.exit(1);
});

server.listen(LOCAL_PORT, '127.0.0.1', () => {
  console.log(`========================================================================`);
  console.log(`  BitBop Local Session Launchpad -> https://${CLOUD_RUN_HOST}`);
  console.log(`  Launchpad URL      : ${targetUrl}`);
  console.log(`  IAM Principal      : gavinrknight@gmail.com (roles/run.invoker)`);
  console.log(`  Session Control    : Spawn, Pause, or Kill cards from the web UI`);
  console.log(`  Idle Protection    : Auto-disconnects idle cards after 15m`);
  console.log(`========================================================================`);
  try {
    execSync(`start "" "${targetUrl}"`, { stdio: 'ignore' });
  } catch {}
});
