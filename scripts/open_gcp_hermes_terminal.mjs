/**
 * BitBop Local Session Launchpad & $0.00 Persistent Context Controller (127.0.0.1:8889)
 *
 * Key Guarantees:
 *   1. $0.00 Local-to-Cloud Session Persistence:
 *      - Every card's conversation history (`history[]`, tool outputs, active model, and title)
 *        is synced from the Cloud Run container to `logs/hermes-sessions/<cardId>.json` on your PC.
 *      - When you Pause a card (`⏸ Pause ($0)`), close the browser, or let Cloud Run scale to zero,
 *        your context stays safely stored on local disk at $0.00/hr.
 *      - When you click `▶ Resume` (even days later on a brand-new container instance), the local
 *        proxy automatically pushes `<cardId>.json` to `POST /api/session-state` on Cloud Run before
 *        the terminal connects — restoring full LLM memory and replaying your recent turns!
 *   2. DOM-Preserving Card Lifecycle:
 *      - Spawning, expanding, pausing, renaming, or closing a Card modifies ONLY that card's DOM node,
 *        so other open cards are never reloaded or cleared.
 */

import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.resolve(__dirname, '..', 'logs', 'hermes-sessions');
const INDEX_FILE = path.join(SESSIONS_DIR, 'cards-index.json');
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const LOCAL_PORT = Number(process.env.LOCAL_PROXY_PORT || 8889);
const IDLE_TIMEOUT_MS = Number(process.env.IDLE_TIMEOUT_MS || 15 * 60 * 1000);
const GCLOUD_BIN =
  process.env.GCLOUD_BIN ||
  `${process.env.LOCALAPPDATA}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd`;

function resolveCloudRunHost() {
  if (process.env.CLOUD_RUN_HOST) return process.env.CLOUD_RUN_HOST;
  try {
    const rawUrl = execSync(
      `"${GCLOUD_BIN}" run services describe uat-agent-reflector --region=australia-southeast1 --format="value(status.url)"`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    if (rawUrl) return new URL(rawUrl).host;
  } catch {}
  return '';
}

function resolveIamPrincipal() {
  if (process.env.GCP_IAM_PRINCIPAL) return process.env.GCP_IAM_PRINCIPAL;
  try {
    return execSync(`"${GCLOUD_BIN}" config get-value account`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {}
  return 'authenticated-operator';
}

const CLOUD_RUN_HOST = resolveCloudRunHost();
const IAM_PRINCIPAL = resolveIamPrincipal();

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

function getCardSessionPath(cardId) {
  const safe = String(cardId || 'card-1').replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(SESSIONS_DIR, `${safe}.json`);
}

function readLocalCardState(cardId) {
  try {
    const p = getCardSessionPath(cardId);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch {}
  return null;
}

function writeLocalCardState(cardId, state) {
  try {
    if (!state || typeof state !== 'object') return;
    fs.writeFileSync(getCardSessionPath(cardId), JSON.stringify(state, null, 2), 'utf8');
  } catch {}
}

function readCardsIndex() {
  try {
    if (fs.existsSync(INDEX_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function writeCardsIndex(cards) {
  try {
    fs.writeFileSync(INDEX_FILE, JSON.stringify(cards, null, 2), 'utf8');
  } catch {}
}

function cloudRunJsonRequest(method, reqPath, bodyObj = null) {
  return new Promise((resolve) => {
    let token = '';
    try {
      token = getIdentityToken();
    } catch {
      resolve(null);
      return;
    }
    const payload = bodyObj ? Buffer.from(JSON.stringify(bodyObj), 'utf8') : null;
    const req = https.request(
      {
        hostname: CLOUD_RUN_HOST,
        port: 443,
        path: reqPath,
        method,
        headers: {
          Host: CLOUD_RUN_HOST,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': String(payload.length) } : {}),
        },
        timeout: 6000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(data ? JSON.parse(data) : null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function pushLocalSessionToCloudRun(cardId) {
  const localState = readLocalCardState(cardId);
  await cloudRunJsonRequest('POST', '/api/session-state', {
    cardId,
    state: localState,
  });
}

async function pullCloudRunSessionsToDisk() {
  if (activeSockets.size === 0) return;
  const data = await cloudRunJsonRequest('GET', '/api/session-state');
  if (data && data.ok && data.sessions && typeof data.sessions === 'object') {
    for (const [cardId, state] of Object.entries(data.sessions)) {
      if (state && Array.isArray(state.history) && state.history.length > 1) {
        writeLocalCardState(cardId, state);
      }
    }
  }
}

// Background sync: mirror active Cloud Run session histories to local disk every 3 seconds
setInterval(() => {
  pullCloudRunSessionsToDisk().catch(() => {});
}, 3000);

function renderLaunchpadHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BitBop Cloud Agent Launchpad — Persistent Session Controller</title>
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
      font-size: 0.78rem;
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
      font-size: 0.75rem;
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
      opacity: 0.92;
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
      flex-wrap: wrap;
      gap: 8px;
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
      font-size: 0.72rem;
      color: var(--muted);
    }
    .saved-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.7rem;
      padding: 3px 8px;
      border-radius: 4px;
      background: rgba(16, 185, 129, 0.14);
      border: 1px solid rgba(16, 185, 129, 0.4);
      color: var(--emerald);
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
      padding: 20px;
      text-align: center;
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
        <p>Persistent Local Session Store (logs/hermes-sessions/) · IAM Locked (${IAM_PRINCIPAL}) → ${CLOUD_RUN_HOST}</p>
      </div>
      <div class="telemetry-pills">
        <div id="pill-state" class="pill zero">● SLEEPING (0 Active Cloud Sessions · $0.00/hr)</div>
        <div id="pill-sockets" class="pill">Open PTY Sockets: 0 / 10 per container</div>
        <div class="pill">💾 Persistence: $0.00 Local Disk Sync</div>
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
      <button class="btn danger" onclick="pauseAllSessions()">
        ⏸ Pause All Cards (Save Context & Scale to $0)
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

    function saveIndexToServer() {
      const clean = sessions.map(s => ({
        id: s.id,
        num: s.num,
        title: s.title,
        status: s.status,
        expanded: Boolean(s.expanded),
        turnCount: s.turnCount || 0
      }));
      fetch('/local/save-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards: clean })
      }).catch(() => {});
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
        <iframe id="iframe-\${s.id}" class="pty-frame" src="/terminal/?session=\${s.id}&arg=\${s.id}" allow="clipboard-read; clipboard-write"></iframe>
      \`;
    }

    function buildPausedBodyHtml(s) {
      const msgCount = s.turnCount || 0;
      return \`
        <div class="paused-placeholder">
          <div>⏸ <strong>\${s.title} (\${s.id})</strong> is paused — Cloud Run WebSocket closed ($0.00/hr).</div>
          <div style="color:var(--emerald);">💾 Saved Context on Local Disk: <strong>\${msgCount} conversation messages</strong> (will auto-hydrate into Cloud Run on Resume).</div>
          <button class="btn" onclick="togglePause('\${s.id}')">▶ Resume Saved Session Card</button>
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
                This Launchpad runs locally on <code>127.0.0.1:${LOCAL_PORT}</code> and persists your session histories
                in <code>logs/hermes-sessions/</code> at $0.00 cost. Click <strong>+ New Hermes Terminal Card</strong>
                above to launch a card.
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

    function mountCardDom(session) {
      const grid = document.getElementById('sessions-grid');
      const isLive = session.status === 'live';
      const cardEl = document.createElement('div');
      cardEl.className = 'session-card' + (isLive ? '' : ' paused') + (session.expanded ? ' expanded' : '');
      cardEl.id = 'wrap-' + session.id;
      cardEl.innerHTML = \`
        <div class="card-hdr">
          <div class="card-title">
            <span id="dot-\${session.id}" class="status-dot \${isLive ? '' : 'paused'}"></span>
            <span id="title-\${session.id}">CARD #\${session.num} · \${session.title}</span>
            <span class="saved-badge" id="saved-\${session.id}">💾 \${session.turnCount || 0} msgs saved</span>
            <span class="card-meta" id="timer-\${session.id}">\${isLive ? 'LIVE (00:00)' : 'PAUSED ($0/hr)'}</span>
          </div>
          <div class="card-controls">
            <button class="chip" onclick="renameCard('\${session.id}')">✏️ Rename</button>
            <button id="btn-exp-\${session.id}" class="chip" onclick="toggleExpand('\${session.id}')">\${session.expanded ? '🗗 Side-by-Side' : '⛶ Full Width'}</button>
            <button id="btn-pause-\${session.id}" class="chip" onclick="togglePause('\${session.id}')">\${isLive ? '⏸ Pause ($0)' : '▶ Resume'}</button>
            <button class="chip kill" onclick="closeSession('\${session.id}')">🗑️ Delete Card</button>
          </div>
        </div>
        <div id="body-\${session.id}">
          \${isLive ? buildLiveBodyHtml(session) : buildPausedBodyHtml(session)}
        </div>
      \`;
      grid.appendChild(cardEl);
    }

    function spawnSession(opts = {}) {
      const num = seq++;
      const id = opts.id || ('card-' + num);
      const session = {
        id,
        num: opts.num || num,
        title: opts.title || 'Hermes Terminal',
        status: opts.status || 'live',
        expanded: Boolean(opts.expanded),
        createdAt: Date.now(),
        turnCount: opts.turnCount || 0,
        initCmd: opts.initCmd || ''
      };
      sessions.push(session);
      syncEmptyState();
      mountCardDom(session);
      saveIndexToServer();

      if (session.status === 'live' && session.initCmd) {
        setTimeout(() => {
          injectCommand(id, session.initCmd);
        }, 2300);
      }
      setTimeout(refreshStatus, 400);
    }

    function renameCard(id) {
      const s = sessions.find(x => x.id === id);
      if (!s) return;
      const next = prompt('Rename Session Card #' + s.num + ':', s.title);
      if (next && next.trim()) {
        s.title = next.trim();
        const el = document.getElementById('title-' + id);
        if (el) el.textContent = 'CARD #' + s.num + ' · ' + s.title;
        saveIndexToServer();
      }
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
        await fetch('/local/kill-card', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId: id })
        });
        if (wrap) wrap.classList.add('paused');
        if (dot) dot.classList.add('paused');
        if (timer) timer.textContent = 'PAUSED ($0/hr)';
        if (btnPause) btnPause.textContent = '▶ Resume';
        if (body) body.innerHTML = buildPausedBodyHtml(s);
      } else {
        s.createdAt = Date.now();
        if (wrap) wrap.classList.remove('paused');
        if (dot) dot.classList.remove('paused');
        if (timer) timer.textContent = 'LIVE (00:00)';
        if (btnPause) btnPause.textContent = '⏸ Pause ($0)';
        if (body) body.innerHTML = buildLiveBodyHtml(s);
      }
      saveIndexToServer();
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
      saveIndexToServer();
    }

    async function closeSession(id) {
      sessions = sessions.filter(x => x.id !== id);
      const wrap = document.getElementById('wrap-' + id);
      if (wrap) wrap.remove();
      syncEmptyState();
      saveIndexToServer();
      await fetch('/local/kill-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: id, deleteDisk: true })
      });
      refreshStatus();
    }

    async function pauseAllSessions() {
      for (const s of sessions) {
        if (s.status === 'live') {
          s.status = 'paused';
          const wrap = document.getElementById('wrap-' + s.id);
          const dot = document.getElementById('dot-' + s.id);
          const timer = document.getElementById('timer-' + s.id);
          const btnPause = document.getElementById('btn-pause-' + s.id);
          const body = document.getElementById('body-' + s.id);
          if (wrap) wrap.classList.add('paused');
          if (dot) dot.classList.add('paused');
          if (timer) timer.textContent = 'PAUSED ($0/hr)';
          if (btnPause) btnPause.textContent = '▶ Resume';
          if (body) body.innerHTML = buildPausedBodyHtml(s);
        }
      }
      saveIndexToServer();
      await fetch('/local/kill-all', { method: 'POST' });
      refreshStatus();
    }

    async function injectCommand(cardId, cmd) {
      try {
        const iframe = document.getElementById('iframe-' + cardId);
        if (iframe && iframe.contentWindow && iframe.contentWindow.__ttydWs) {
          const ws = iframe.contentWindow.__ttydWs;
          if (ws.readyState === 1) {
            const bytes = new TextEncoder().encode('0' + cmd + '\\r');
            ws.send(bytes);
            iframe.contentWindow.focus();
            return;
          }
        }
        await fetch('/api/terminal-inject', {
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

        const savedCounts = d.saved_counts || {};
        for (const s of sessions) {
          if (typeof savedCounts[s.id] === 'number') {
            s.turnCount = savedCounts[s.id];
            const savedEl = document.getElementById('saved-' + s.id);
            if (savedEl) savedEl.textContent = '💾 ' + s.turnCount + ' msgs saved';
          }
          const el = document.getElementById('timer-' + s.id);
          if (el && s.status === 'live') {
            const up = Math.floor((Date.now() - s.createdAt) / 1000);
            el.textContent = 'LIVE (' + formatDuration(up) + ')';
          }
        }
      } catch {}
    }

    async function bootLaunchpad() {
      try {
        const r = await fetch('/local/status');
        const d = await r.json();
        const savedCards = Array.isArray(d.saved_index) ? d.saved_index : [];
        const savedCounts = d.saved_counts || {};
        if (savedCards.length > 0) {
          for (const sc of savedCards) {
            if (sc.num >= seq) seq = sc.num + 1;
            spawnSession({
              id: sc.id,
              num: sc.num,
              title: sc.title,
              status: sc.status || 'live',
              expanded: sc.expanded,
              turnCount: savedCounts[sc.id] || sc.turnCount || 0
            });
          }
          return;
        }
      } catch {}
      spawnSession({ title: 'Hermes Interactive Terminal' });
    }

    bootLaunchpad();
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

function getAllSavedCounts() {
  const counts = {};
  try {
    const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json') && f !== 'cards-index.json');
    for (const f of files) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
        const id = f.replace(/\.json$/, '');
        if (parsed && Array.isArray(parsed.history)) {
          counts[id] = parsed.history.filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content)).length;
        }
      } catch {}
    }
  } catch {}
  return counts;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', `http://127.0.0.1:${LOCAL_PORT}`);

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
        saved_index: readCardsIndex(),
        saved_counts: getAllSavedCounts(),
        cloud_run_host: CLOUD_RUN_HOST,
        idle_timeout_ms: IDLE_TIMEOUT_MS,
      })
    );
    return;
  }

  if (req.method === 'POST' && u.pathname === '/local/save-index') {
    const body = await readJsonBody(req);
    if (Array.isArray(body.cards)) {
      writeCardsIndex(body.cards);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && u.pathname === '/local/kill-card') {
    const body = await readJsonBody(req);
    const targetCard = String(body.cardId || '');
    // Sync latest state from Cloud Run to disk before closing socket!
    await pullCloudRunSessionsToDisk().catch(() => {});
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
    if (body.deleteDisk && targetCard) {
      try {
        const p = getCardSessionPath(targetCard);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, cardId: targetCard, closed_sockets: closed }));
    return;
  }

  if (req.method === 'POST' && u.pathname === '/local/kill-all') {
    await pullCloudRunSessionsToDisk().catch(() => {});
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

  let token = '';
  try {
    token = getIdentityToken();
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Failed to obtain Google IAM token: ${err.message}`);
    return;
  }

  const isTerminalHtml = u.pathname === '/terminal/';
  const sessionParam = u.searchParams.get('session') || u.searchParams.get('arg') || '';

  // Hydrate Cloud Run container with local saved session state BEFORE opening `/terminal/`!
  if (isTerminalHtml && sessionParam) {
    await pushLocalSessionToCloudRun(sessionParam).catch(() => {});
  }

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

server.on('upgrade', async (req, clientSocket, head) => {
  let token = '';
  try {
    token = getIdentityToken();
  } catch {
    clientSocket.destroy();
    return;
  }

  const u = new URL(req.url || '/', `http://127.0.0.1:${LOCAL_PORT}`);
  const cardId = u.searchParams.get('session') || `card-1`;

  // Ensure Cloud Run container has this card's persisted session state right before WebSocket PTY spawns
  await pushLocalSessionToCloudRun(cardId).catch(() => {});

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
        console.log(`[Idle-Guard] Saving context & closing inactive PTY socket #${sockId} (${cardId}) after 15m.`);
        pullCloudRunSessionsToDisk().finally(() => {
          upstream.destroy();
          clientSocket.destroy();
        });
      }, IDLE_TIMEOUT_MS);

      clientSocket.on('data', () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          console.log(`[Idle-Guard] Saving context & closing inactive PTY socket #${sockId} (${cardId}) after 15m.`);
          pullCloudRunSessionsToDisk().finally(() => {
            upstream.destroy();
            clientSocket.destroy();
          });
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
  console.log(`  Persistent Store   : ${SESSIONS_DIR}`);
  console.log(`  IAM Principal      : ${IAM_PRINCIPAL} (roles/run.invoker)`);
  console.log(`  Idle Protection    : Auto-saves & disconnects idle cards after 15m`);
  console.log(`========================================================================`);
  try {
    execSync(`start "" "${targetUrl}"`, { stdio: 'ignore' });
  } catch {}
});
