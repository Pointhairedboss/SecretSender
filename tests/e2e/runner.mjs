#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TIERS = [
  { id: 1, name: 'Tier 1: Core Feature Coverage', file: 'tier1_features.test.mjs' },
  { id: 2, name: 'Tier 2: Boundary Value Analysis & Edge Cases', file: 'tier2_boundaries.test.mjs' },
  { id: 3, name: 'Tier 3: Cross-Feature Pairwise Combinations', file: 'tier3_combinations.test.mjs' },
  { id: 4, name: 'Tier 4: Real-World Application Scenarios', file: 'tier4_scenarios.test.mjs' },
];

function parseArgs() {
  const args = process.argv.slice(2);
  let requestedTier = null;
  for (const arg of args) {
    const m = arg.match(/^--tier=(\d+)$/);
    if (m) {
      requestedTier = Number(m[1]);
    }
  }
  return { requestedTier };
}

async function runTier(tier) {
  const filePath = path.join(__dirname, tier.file);
  const startTime = Date.now();

  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', filePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      // Extract pass/fail counts from TAP output
      const passMatch = stdout.match(/# pass (\d+)/);
      const failMatch = stdout.match(/# fail (\d+)/);
      const testsMatch = stdout.match(/# tests (\d+)/);

      const tests = testsMatch ? Number(testsMatch[1]) : 0;
      const pass = passMatch ? Number(passMatch[1]) : 0;
      const fail = failMatch ? Number(failMatch[1]) : (code === 0 ? 0 : 1);

      resolve({
        id: tier.id,
        name: tier.name,
        file: tier.file,
        code,
        durationMs,
        tests,
        pass,
        fail,
        stdout,
        stderr,
      });
    });
  });
}

async function main() {
  const { requestedTier } = parseArgs();
  const tiersToRun = requestedTier
    ? TIERS.filter((t) => t.id === requestedTier)
    : TIERS;

  if (tiersToRun.length === 0) {
    console.error(`Unknown tier specified: ${requestedTier}. Available: 1, 2, 3, 4.`);
    process.exit(1);
  }

  console.log('================================================================');
  console.log('       SecretSender E2E Opaque-Box Test Suite Runner             ');
  console.log('================================================================');
  console.log(`Execution Mode: ${requestedTier ? `Single Tier (${requestedTier})` : 'Full 4-Tier Regression Suite'}`);
  console.log(`Node Runtime  : ${process.version}`);
  console.log(`Target Suite  : ${tiersToRun.map((t) => `T${t.id}`).join(', ')}`);
  console.log('----------------------------------------------------------------\n');

  const suiteStartTime = Date.now();
  const results = [];
  let totalTests = 0;
  let totalPass = 0;
  let totalFail = 0;

  for (const tier of tiersToRun) {
    process.stdout.write(`[RUNNING] ${tier.name} (${tier.file})... `);
    const res = await runTier(tier);
    results.push(res);
    totalTests += res.tests;
    totalPass += res.pass;
    totalFail += res.fail;

    if (res.code === 0 && res.fail === 0) {
      console.log(`PASS (${res.pass}/${res.tests} tests, ${res.durationMs}ms)`);
    } else {
      console.log(`FAIL (${res.fail} failed, ${res.pass} passed)`);
      if (res.stderr) console.error(res.stderr);
      if (res.stdout) console.log(res.stdout);
    }
  }

  const totalDuration = Date.now() - suiteStartTime;

  console.log('\n================================================================');
  console.log('                     TEST EXECUTION SUMMARY                     ');
  console.log('================================================================');
  for (const r of results) {
    const status = r.code === 0 && r.fail === 0 ? '✔ PASS' : '✖ FAIL';
    console.log(
      ` ${status}  [Tier ${r.id}] ${r.name.padEnd(46)} ${String(r.pass).padStart(2)}/${String(r.tests).padEnd(2)} tests (${(r.durationMs + 'ms').padStart(7)})`
    );
  }
  console.log('----------------------------------------------------------------');
  console.log(` Total Suites  : ${results.length}`);
  console.log(` Total Tests   : ${totalTests}`);
  console.log(` Passed Tests  : ${totalPass}`);
  console.log(` Failed Tests  : ${totalFail}`);
  console.log(` Total Time    : ${(totalDuration / 1000).toFixed(2)}s`);
  console.log('================================================================');

  if (totalFail > 0) {
    console.error('\n✖ TEST SUITE FAILED: One or more assertions did not satisfy contract.');
    process.exit(1);
  } else {
    console.log('\n✔ TEST SUITE PASSED: 100% of opaque-box contract assertions verified.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
