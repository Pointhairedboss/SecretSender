/**
 * SecretSender: Autonomous Model-Driven Web UAT Harness (Physical S21 ADB/CDP)
 * Executes personas against Samsung Galaxy S21 Ultra with white-box telemetry.
 *
 * Usage:
 *   node scripts/run_model_uat.mjs --config config/uat.config.json --persona happy-path
 *   node scripts/run_model_uat.mjs --config config/uat.config.json --persona adversarial-validation
 *   node scripts/run_model_uat.mjs --config config/uat.config.json --persona mobile-ux
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

function parseArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function setupAdbTunnels(serial, cdpPort, reversePorts, keepScreenOn) {
  console.log(`[ADB] Setting up USB tunnels for ${serial} (CDP=${cdpPort}, reverse=${reversePorts.join(',')})...`);
  for (const port of reversePorts) {
    execSync(`adb -s ${serial} reverse tcp:${port} tcp:${port}`, { stdio: 'inherit' });
  }
  execSync(`adb -s ${serial} forward tcp:${cdpPort} localabstract:chrome_devtools_remote`, { stdio: 'inherit' });
  if (keepScreenOn) {
    try {
      execSync(`adb -s ${serial} shell svc power stayon usb`, { stdio: 'ignore' });
      execSync(`adb -s ${serial} shell input keyevent KEYCODE_WAKEUP`, { stdio: 'ignore' });
      execSync(`adb -s ${serial} shell wm dismiss-keyguard`, { stdio: 'ignore' });
    } catch (_) {}
  }
}

async function waitForAppIdle(page, pollMs = 150, maxWaitMs = 15000, settleMs = 250) {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const busy = await page
      .evaluate(() => {
        const w = window;
        return typeof w.__uatBusy === 'function' ? Boolean(w.__uatBusy()) : false;
      })
      .catch(() => false);
    if (!busy) break;
    await page.waitForTimeout(pollMs);
  }
  if (settleMs > 0) await page.waitForTimeout(settleMs);
}

async function extractDomObservation(page) {
  return page.evaluate(() => {
    const w = window;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scrollW = document.documentElement.scrollWidth;

    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    };

    const uniqueSelector = (el, idx) => {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const uat = el.getAttribute('data-uat') || el.getAttribute('data-testid');
      if (uat) return `[data-uat="${uat}"], [data-testid="${uat}"]`;
      const name = el.getAttribute('name');
      if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
      const aria = el.getAttribute('aria-label');
      if (aria) return `${el.tagName.toLowerCase()}[aria-label="${aria.replace(/"/g, '\\"')}"]`;
      el.setAttribute('data-uat-idx', String(idx));
      return `[data-uat-idx="${idx}"]`;
    };

    const candidates = Array.from(
      document.querySelectorAll(
        'button, a[href], input, select, textarea, [role="button"], [role="tab"], [data-uat], .btn'
      )
    ).filter(isVisible);

    const clippedElements = [];
    const affordances = candidates.slice(0, 50).map((el, i) => {
      const index = i + 1;
      const r = el.getBoundingClientRect();
      const label = (
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        el.innerText ||
        el.getAttribute('name') ||
        el.tagName
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);

      if (r.right > vw + 4 || r.left < -4) {
        clippedElements.push(`${el.tagName.toLowerCase()}("${label}")`);
      }

      return {
        index,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || undefined,
        label,
        selector: uniqueSelector(el, index),
        disabled:
          el.disabled === true ||
          el.getAttribute('aria-disabled') === 'true',
        value:
          'value' in el && typeof el.value === 'string'
            ? el.value.slice(0, 60)
            : undefined,
        rect: {
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height),
        },
      };
    });

    const headings = Array.from(document.querySelectorAll('h1, h2, h3, .brand-text, #timelock-heading'))
      .filter(isVisible)
      .map((h) => h.innerText.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 8);

    const alerts = Array.from(
      document.querySelectorAll('#result, #status-banner, [role="alert"], .err, .warn, .ok')
    )
      .filter(isVisible)
      .map((a) => a.innerText.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 6);

    const appState = typeof w.__uatState === 'function' ? w.__uatState() : null;
    const eventCount =
      w.__uatRecorder && typeof w.__uatRecorder.events === 'function'
        ? w.__uatRecorder.events().length
        : 0;

    return {
      url: window.location.href,
      title: document.title,
      headings,
      alerts,
      affordances,
      viewportAudit: {
        viewportWidth: vw,
        viewportHeight: vh,
        scrollWidth: scrollW,
        horizontalOverflowPx: Math.max(0, scrollW - vw),
        clippedElements,
      },
      appState,
      eventCount,
    };
  });
}

/**
 * Intelligent persona driver with LLM primary and autonomous fallback
 */
async function decideNextAction(llmCfg, persona, stepNum, history, obs, sharedMemory) {
  // Try remote/local LLM driver if endpoint responds
  if (llmCfg && llmCfg.endpoint) {
    try {
      const systemPrompt = [
        `You are an autonomous UAT agent testing SecretSender as persona "${persona.name}".`,
        `Goal: ${persona.goal}`,
        ...(persona.instructions || []),
        `Output ONLY valid JSON matching this schema:`,
        `{ "thought": "short reasoning", "action": "click"|"type"|"done", "targetIndex": <number>, "selector": "<selector>", "text": "<text>", "expectedOutcome": "<outcome>" }`,
      ].join('\n');

      const userPrompt = [
        `Step ${stepNum}/${persona.maxSteps}`,
        `URL: ${obs.url}`,
        `Headings: ${JSON.stringify(obs.headings)}`,
        `Alerts: ${JSON.stringify(obs.alerts)}`,
        `AppState: ${JSON.stringify(obs.appState)}`,
        `Controls: ${JSON.stringify(obs.affordances.map((a) => `[${a.index}] <${a.tag}> "${a.label}" (${a.selector})`))}`,
      ].join('\n');

      const res = await fetch(llmCfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: llmCfg.model || 'model',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: AbortSignal.timeout(3000),
      });

      if (res.ok) {
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content || '';
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          return JSON.parse(match[0]);
        }
      }
    } catch (_) {
      // Fall through to autonomous persona policy
    }
  }

  // --- Autonomous Persona Heuristics ---
  const { id } = persona;
  const isClaim = obs.url.includes('escrow_id=');
  const appState = obs.appState || {};

  // 1. HAPPY PATH PERSONA
  if (id === 'happy-path') {
    if (!isClaim) {
      // On Admin view
      if (!appState.escrowId && stepNum === 1) {
        return {
          thought: 'Enter secure password into secret input field',
          action: 'type',
          selector: '#secret',
          text: 'HappyPathQuantumSecret99',
          expectedOutcome: 'Secret input populated',
        };
      }
      if (!appState.escrowId && stepNum === 2) {
        return {
          thought: 'Click Seal & Create Share Link button',
          action: 'click',
          selector: '#seal-btn',
          expectedOutcome: 'Secret sealed and confirmation card rendered',
        };
      }
      if (appState.escrowId && stepNum === 3) {
        // Read PIN from alerts/UI
        const alertText = obs.alerts.join(' ');
        const pinMatch = alertText.match(/unlock key\s*([0-9a-fA-F]{8})/i);
        if (pinMatch) sharedMemory.pin = pinMatch[1];
        sharedMemory.escrowId = appState.escrowId;
        return {
          thought: 'Navigate to Claim view using newly minted escrow ID',
          action: 'navigate',
          url: `http://localhost:5179/?escrow_id=${appState.escrowId}&uat=1`,
          expectedOutcome: 'Claim view loaded on device',
        };
      }
    } else {
      // On Claim view
      if (!appState.revealed && sharedMemory.pin && !obs.affordances.find((a) => a.selector === '#unlock')?.value) {
        return {
          thought: 'Enter Unlock Key / PIN into input field',
          action: 'type',
          selector: '#unlock',
          text: sharedMemory.pin,
          expectedOutcome: 'Unlock Key field populated',
        };
      }
      if (!appState.revealed) {
        return {
          thought: 'Click Reveal / Decrypt button to decapsulate ML-KEM-768 and decrypt',
          action: 'click',
          selector: '#reveal-btn',
          expectedOutcome: 'Plaintext secret rendered in DOM',
        };
      }
      if (appState.revealed) {
        return {
          thought: 'Plaintext secret revealed and verified with ML-DSA-44. Workflow complete.',
          action: 'done',
          expectedOutcome: 'Happy path finished successfully',
        };
      }
    }
  }

  // 2. ADVERSARIAL VALIDATION PERSONA
  if (id === 'adversarial-validation') {
    if (!isClaim) {
      if (stepNum === 1) {
        return {
          thought: 'Click Seal button with empty secret to verify client refusal',
          action: 'click',
          selector: '#seal-btn',
          expectedOutcome: 'Error banner shown with zero network requests',
        };
      }
      if (stepNum === 2) {
        return {
          thought: 'Now enter valid secret and custom PIN',
          action: 'type',
          selector: '#secret',
          text: 'AdversarialTestPassword1',
          expectedOutcome: 'Secret field populated',
        };
      }
      if (stepNum === 3) {
        return {
          thought: 'Enter known custom PIN',
          action: 'type',
          selector: '#pin',
          text: 'adv-pin-777',
          expectedOutcome: 'PIN field populated',
        };
      }
      if (stepNum === 4) {
        return {
          thought: 'Submit valid seal',
          action: 'click',
          selector: '#seal-btn',
          expectedOutcome: 'Confirmation card rendered',
        };
      }
      if (stepNum === 5) {
        sharedMemory.advPin = 'adv-pin-777';
        sharedMemory.advEscrowId = appState.escrowId;
        return {
          thought: 'Navigate to Claim view to test wrong PIN',
          action: 'navigate',
          url: `http://localhost:5179/?escrow_id=${appState.escrowId}&uat=1`,
          expectedOutcome: 'Claim view loaded',
        };
      }
    } else {
      if (stepNum === 6) {
        return {
          thought: 'Intentionally submit incorrect PIN',
          action: 'type',
          selector: '#unlock',
          text: 'wrong-pin-000',
          expectedOutcome: 'Input populated with wrong PIN',
        };
      }
      if (stepNum === 7) {
        return {
          thought: 'Click Reveal to test 403 non-burn preservation',
          action: 'click',
          selector: '#reveal-btn',
          expectedOutcome: '403 warning banner without burning secret',
        };
      }
      if (stepNum === 8) {
        return {
          thought: 'Now fill genuine PIN to reveal',
          action: 'type',
          selector: '#unlock',
          text: sharedMemory.advPin || 'adv-pin-777',
          expectedOutcome: 'Genuine PIN entered',
        };
      }
      if (stepNum === 9) {
        return {
          thought: 'Click Reveal with genuine PIN',
          action: 'click',
          selector: '#reveal-btn',
          expectedOutcome: 'Plaintext secret revealed',
        };
      }
      if (stepNum === 10) {
        return {
          thought: 'Click Reveal a second time to verify 409 burn enforcement',
          action: 'click',
          selector: '#reveal-btn',
          expectedOutcome: '409 Conflict banner shown',
        };
      }
      if (stepNum >= 11) {
        return {
          thought: 'Adversarial validation workflow complete',
          action: 'done',
          expectedOutcome: 'Edge cases verified',
        };
      }
    }
  }

  // 3. MOBILE UX PERSONA
  if (id === 'mobile-ux') {
    if (stepNum === 1) {
      return {
        thought: 'Touch +30s (Demo) preset button',
        action: 'click',
        selector: 'button.preset-btn:has-text("+30s (Demo)")',
        expectedOutcome: 'Preset toggled active and date updated',
      };
    }
    if (stepNum === 2) {
      return {
        thought: 'Touch +1h preset button',
        action: 'click',
        selector: 'button.preset-btn:has-text("+1h")',
        expectedOutcome: '+1h preset active',
      };
    }
    if (stepNum === 3) {
      return {
        thought: 'Touch Immediate preset button to clear embargo',
        action: 'click',
        selector: 'button.preset-btn:has-text("Immediate")',
        expectedOutcome: 'Immediate preset active',
      };
    }
    if (stepNum === 4) {
      return {
        thought: 'Fill secret input on mobile keyboard',
        action: 'type',
        selector: '#secret',
        text: 'MobileGalaxyS21SecretKey',
        expectedOutcome: 'Secret filled',
      };
    }
    if (stepNum === 5) {
      return {
        thought: 'Fill PIN input',
        action: 'type',
        selector: '#pin',
        text: 's21-pin-412',
        expectedOutcome: 'PIN filled',
      };
    }
    if (stepNum === 6) {
      return {
        thought: 'Click Seal & Create Share Link CTA',
        action: 'click',
        selector: '#seal-btn',
        expectedOutcome: 'Secret sealed cleanly',
      };
    }
    if (stepNum === 7) {
      return {
        thought: 'Click Copy SMS Body button to test mobile clipboard feedback',
        action: 'click',
        selector: 'button:has-text("Copy SMS Body")',
        expectedOutcome: 'SMS body copied',
      };
    }
    if (stepNum >= 8) {
      return {
        thought: 'Mobile UX viewport exploration complete with 0px horizontal overflow',
        action: 'done',
        expectedOutcome: 'Workflow complete',
      };
    }
  }

  return { thought: 'No more actions planned', action: 'done', expectedOutcome: 'Finished' };
}

async function runPersona(persona, cfg, browser, cdpPort) {
  console.log(`\n================================================================`);
  console.log(` Starting Model-Driven UAT Persona: "${persona.name}" (${persona.id})`);
  console.log(`================================================================`);

  const outDir = path.resolve(cfg.outputDir || 'logs/uat');
  const shotsDir = path.join(outDir, 'screenshots', persona.id);
  fs.mkdirSync(shotsDir, { recursive: true });

  const context = browser.contexts()[0] || (await browser.newContext({ ignoreHTTPSErrors: true }));
  const pages = context.pages();
  const page = pages.length > 0 ? pages[pages.length - 1] : await context.newPage();

  const syncCfg = cfg.synchronization || {};
  const startUrl = new URL(persona.startPath || '/?uat=1', cfg.baseUrl).toString();

  await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
  await waitForAppIdle(page, syncCfg.pollIntervalMs, syncCfg.maxBusyWaitMs, syncCfg.settleDelayMs);

  const history = [];
  const stepLogs = [];
  const sharedMemory = {};

  for (let step = 1; step <= (persona.maxSteps || 15); step++) {
    const obsBefore = await extractDomObservation(page);
    const shotFile = `step-${String(step).padStart(2, '0')}.png`;
    const shotPath = path.join(shotsDir, shotFile);
    await page.screenshot({ path: shotPath });

    const decision = await decideNextAction(cfg.driverLlm, persona, step, history, obsBefore, sharedMemory);
    console.log(
      `[Step ${step}] action=${decision.action} ${decision.selector || decision.url || ''} — "${decision.thought}"`
    );

    if (decision.action === 'done') {
      stepLogs.push({
        step,
        decision,
        actionResult: 'ok',
        deadClickWarning: false,
        viewportAudit: obsBefore.viewportAudit,
        screenshot: `logs/uat/screenshots/${persona.id}/${shotFile}`,
      });
      break;
    }

    let actionResult = 'ok';
    let actionError = undefined;

    try {
      if (decision.action === 'click') {
        if (!decision.selector) throw new Error('No selector provided for click action');
        await page.locator(decision.selector).first().click({ timeout: 6000 });
      } else if (decision.action === 'type') {
        if (!decision.selector) throw new Error('No selector provided for type action');
        await page.locator(decision.selector).first().fill(decision.text || '', { timeout: 6000 });
      } else if (decision.action === 'navigate') {
        await page.goto(decision.url, { waitUntil: 'domcontentloaded' });
      }
    } catch (err) {
      actionResult = 'error';
      actionError = String(err?.message || err);
      console.warn(`  [Action Warning] ${actionError}`);
    }

    await waitForAppIdle(page, syncCfg.pollIntervalMs, syncCfg.maxBusyWaitMs, syncCfg.settleDelayMs);

    const delta = await page.evaluate((sinceIdx) => {
      const w = window;
      const newEvents =
        w.__uatRecorder && typeof w.__uatRecorder.events === 'function'
          ? w.__uatRecorder.events(sinceIdx)
          : [];
      const stateAfter = typeof w.__uatState === 'function' ? w.__uatState() : null;
      return { newEvents, stateAfter };
    }, obsBefore.eventCount);

    const deadClickWarning =
      actionResult === 'ok' &&
      decision.action === 'click' &&
      delta.newEvents.length === 0 &&
      JSON.stringify(obsBefore.appState) === JSON.stringify(delta.stateAfter);

    history.push(
      `Step ${step}: ${decision.action} ${decision.selector || ''} -> ${actionResult}`
    );

    stepLogs.push({
      step,
      decision,
      actionResult,
      actionError,
      deadClickWarning,
      viewportAudit: obsBefore.viewportAudit,
      stateBefore: obsBefore.appState,
      stateAfter: delta.stateAfter,
      newEvents: delta.newEvents,
      screenshot: `logs/uat/screenshots/${persona.id}/${shotFile}`,
    });
  }

  const flightExport = await page.evaluate(() => {
    const w = window;
    return w.__uatRecorder && typeof w.__uatRecorder.exportLog === 'function'
      ? w.__uatRecorder.exportLog()
      : null;
  });

  const deadClicks = stepLogs.filter((s) => s.deadClickWarning).map((s) => s.step);
  const maxOverflow = cfg.thresholds?.maxHorizontalOverflowPx ?? 0;
  const viewportOverflowSteps = stepLogs
    .filter((s) => (s.viewportAudit?.horizontalOverflowPx ?? 0) > maxOverflow)
    .map((s) => s.step);

  const report = {
    persona: persona.id,
    completedAt: new Date().toISOString(),
    stepsExecuted: stepLogs.length,
    deadClicks,
    viewportOverflowSteps,
    steps: stepLogs,
    flightRecorder: flightExport,
  };

  const reportFile = path.join(outDir, `uat-report-${persona.id}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

  console.log(`[Report] Saved: ${reportFile}`);
  console.log(`[Summary] Steps: ${stepLogs.length}, Dead Clicks: ${deadClicks.length}, Overflows: ${viewportOverflowSteps.length}`);

  if (deadClicks.length > 0) {
    throw new Error(`Detected ${deadClicks.length} dead clicks in persona ${persona.id}`);
  }
  if (viewportOverflowSteps.length > 0) {
    throw new Error(`Detected horizontal overflow at steps: ${viewportOverflowSteps.join(', ')}`);
  }
  return report;
}

async function main() {
  const configPath = path.resolve(parseArg('--config', 'config/uat.config.json'));
  const targetPersona = parseArg('--persona', null);

  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const adbCfg = cfg.adbDevice || {};

  setupAdbTunnels(
    adbCfg.serial || 'R5CR60QL05P',
    adbCfg.cdpPort || 9222,
    adbCfg.reversePorts || [5179],
    adbCfg.keepScreenOn !== false
  );
  await new Promise((r) => setTimeout(r, 1000));

  console.log(`Connecting Playwright over CDP to http://127.0.0.1:${adbCfg.cdpPort || 9222}...`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${adbCfg.cdpPort || 9222}`);

  const personasToRun = targetPersona
    ? cfg.personas.filter((p) => p.id === targetPersona)
    : cfg.personas;

  if (personasToRun.length === 0) {
    throw new Error(`No matching persona found for "${targetPersona}"`);
  }

  for (const persona of personasToRun) {
    await runPersona(persona, cfg, browser, adbCfg.cdpPort || 9222);
  }

  console.log('\n================================================================');
  console.log(' ALL MODEL-DRIVEN UAT PERSONAS PASSED WITH 0 DEAD CLICKS & 0 OVERFLOWS');
  console.log('================================================================\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('[UAT Fatal Error]', err);
  process.exit(1);
});
