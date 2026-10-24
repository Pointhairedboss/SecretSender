/**
 * Local Loopback (127.0.0.1) Google Cloud IAM Authenticated Proxy for the Ephemeral Cloud Agent & Hermes Terminal
 *
 * Why this exists:
 *   The Cloud Run service (`https://uat-agent-reflector-vwn34fypca-ts.a.run.app`) is locked down with
 *   `--no-allow-unauthenticated` (Google Cloud IAM `roles/run.invoker` granted ONLY to `gavinrknight@gmail.com`).
 *   Anyone else on the internet receives `HTTP 403 Forbidden` at Google's edge load balancer before the
 *   container even wakes up.
 *
 *   When you click the Desktop shortcut, this lightweight local proxy binds strictly to `127.0.0.1:8889`,
 *   attaches your short-lived Google IAM Identity Token (`gcloud auth print-identity-token`) to every HTTP
 *   and WebSocket (`/terminal/ws`) request, and opens your browser directly into the live Hermes Cloud Terminal.
 */

import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { execSync } from 'node:child_process';

const CLOUD_RUN_HOST = process.env.CLOUD_RUN_HOST || 'uat-agent-reflector-vwn34fypca-ts.a.run.app';
const LOCAL_PORT = Number(process.env.LOCAL_PROXY_PORT || 8889);
const GCLOUD_BIN =
  process.env.GCLOUD_BIN ||
  `${process.env.LOCALAPPDATA}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd`;

let cachedToken = '';
let tokenExpiryMs = 0;

function getIdentityToken() {
  if (cachedToken && Date.now() < tokenExpiryMs) {
    return cachedToken;
  }
  cachedToken = execSync(`"${GCLOUD_BIN}" auth print-identity-token`, { encoding: 'utf8' }).trim();
  tokenExpiryMs = Date.now() + 30 * 60 * 1000; // Refresh every 30 minutes
  return cachedToken;
}

const server = http.createServer((req, res) => {
  let token = '';
  try {
    token = getIdentityToken();
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Failed to obtain Google IAM token: ${err.message}`);
    return;
  }

  const headers = { ...req.headers, host: CLOUD_RUN_HOST, Authorization: `Bearer ${token}` };
  const proxyReq = https.request(
    {
      hostname: CLOUD_RUN_HOST,
      port: 443,
      path: req.url,
      method: req.method,
      headers,
    },
    (proxyRes) => {
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

  const upstream = tls.connect(
    {
      host: CLOUD_RUN_HOST,
      port: 443,
      servername: CLOUD_RUN_HOST,
    },
    () => {
      let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
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
    }
  );

  upstream.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstream.destroy());
});

const targetPath = process.argv[2] || '/';
server.listen(LOCAL_PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${LOCAL_PORT}${targetPath}`;
  console.log(`========================================================================`);
  console.log(`  Google Cloud IAM Authenticated Tunnel -> https://${CLOUD_RUN_HOST}`);
  console.log(`  Local Loopback URL : ${url}`);
  console.log(`  IAM Principal      : gavinrknight@gmail.com (roles/run.invoker)`);
  console.log(`  Close this window when finished to scale Cloud Run back to $0.`);
  console.log(`========================================================================`);
  try {
    execSync(`start "" "${url}"`, { stdio: 'ignore' });
  } catch {}
});
