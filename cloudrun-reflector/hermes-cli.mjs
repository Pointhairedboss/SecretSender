#!/usr/bin/env node
/**
 * Interactive Hermes Agent REPL & Tool Runner inside Google Cloud Run
 * Connects directly to Google Cloud Vertex AI (gemini-3.8-flash / gemini-3.5-flash-lite)
 * configured in /app/hermes.yaml using the Cloud Run GCP Metadata Server OAuth token,
 * with built-in tool execution (bash terminal + Playwright headless Chromium).
 */

import readline from 'node:readline';
import { execSync } from 'node:child_process';

const PORT = process.env.PORT || 8080;
const API_URL = `http://127.0.0.1:${PORT}/v1/chat/completions`;
let currentModel = process.env.HERMES_MODEL || 'gemini-3.8-flash';

const history = [
  {
    role: 'system',
    content:
      'You are Hermes Agent running inside an ephemeral Google Cloud Run container (australia-southeast1) with Playwright Chromium, bash, curl, and Node.js installed. When the user asks you to run a command or inspect something, you can call the `run_bash` tool.',
  },
];

const tools = [
  {
    type: 'function',
    function: {
      name: 'run_bash',
      description: 'Execute a bash command inside the Google Cloud Run container and return stdout/stderr.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to run' },
        },
        required: ['command'],
      },
    },
  },
];

async function sendTurn(userText) {
  history.push({ role: 'user', content: userText });

  for (let step = 0; step < 6; step++) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: currentModel,
        messages: history,
        tools,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`\x1b[31m[Vertex Error]\x1b[0m ${ data?.error?.message || JSON.stringify(data) }`);
      return;
    }

    const msg = data?.choices?.[0]?.message;
    if (!msg) return;
    history.push(msg);

    if (msg.content) {
      console.log(`\n\x1b[1;32mHermes (${currentModel}):\x1b[0m ${msg.content}\n`);
    }

    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        if (tc.function?.name === 'run_bash') {
          let cmd = '';
          try {
            cmd = JSON.parse(tc.function.arguments || '{}').command || '';
          } catch {}
          console.log(`\x1b[33m  ⚙️  [tool: run_bash] $ ${cmd}\x1b[0m`);
          let out = '';
          try {
            out = execSync(cmd, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
          } catch (e) {
            out = `Exit ${e.status || 1}: ${(e.stdout || '') + (e.stderr || e.message || '')}`;
          }
          const trimmed = String(out).slice(0, 4000);
          if (trimmed.trim()) {
            console.log(`\x1b[90m${trimmed.trim()}\x1b[0m`);
          }
          history.push({
            role: 'tool',
            name: 'run_bash',
            content: trimmed || '(completed with no output)',
          });
        }
      }
      continue;
    }
    break;
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '\x1b[1;33mhermes>\x1b[0m ',
});

console.log('\x1b[36mCommands: /model <gemini-3.8-flash|gemini-3.5-flash-lite> | /bash (drop to shell) | /exit\x1b[0m\n');
rl.prompt();

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    rl.prompt();
    return;
  }
  if (trimmed === '/exit' || trimmed === '/bash' || trimmed === 'exit') {
    rl.close();
    process.exit(0);
  }
  if (trimmed.startsWith('/model')) {
    const parts = trimmed.split(/\s+/);
    if (parts[1]) {
      currentModel = parts[1];
      console.log(`\x1b[32mSwitched Vertex AI model to: ${currentModel}\x1b[0m`);
    } else {
      console.log(`Current model: ${currentModel}`);
    }
    rl.prompt();
    return;
  }
  try {
    await sendTurn(trimmed);
  } catch (err) {
    console.error(`\x1b[31mError:\x1b[0m ${err.message}`);
  }
  rl.prompt();
});
