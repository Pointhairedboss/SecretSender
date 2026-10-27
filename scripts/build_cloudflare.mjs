import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHtml } from './client_template.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

fs.mkdirSync(publicDir, { recursive: true });

// 1. Write static index.html from server.mjs buildHtml()
const htmlPath = path.join(publicDir, 'index.html');
fs.writeFileSync(htmlPath, buildHtml(), 'utf8');

// 2. Copy mlkem.browser.js into public/ for Cloudflare Static Assets
const srcMlkem = path.join(rootDir, 'mlkem.browser.js');
const dstMlkem = path.join(publicDir, 'mlkem.browser.js');
fs.copyFileSync(srcMlkem, dstMlkem);

console.log('[build:cf] Wrote public/index.html and public/mlkem.browser.js for Cloudflare Static Assets');
