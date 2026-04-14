#!/usr/bin/env node
/**
 * scripts/setup.js — Threadwork setup and health verification
 *
 * Run after cloning or after a package upgrade:
 *
 *   npm run setup
 *
 * Checks performed:
 *   1. Node.js version (>= 18 required)
 *   2. npm install — install / verify dependencies
 *   3. Syntax check — node --check on all hooks and lib files
 *   4. Hook registration — verify hooks appear in ~/.claude/settings.json
 *   5. Unit tests — npm test
 *
 * Exit code 0 = all checks passed.
 * Exit code 1 = one or more checks failed (details printed above summary).
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Helpers ───────────────────────────────────────────────────────────────────

const PASS = '✓';
const FAIL = '✗';
const SKIP = '–';

const results = [];

function record(label, passed, detail = '') {
  results.push({ label, passed, detail });
}

function run(cmd, opts = {}) {
  return spawnSync(cmd, { shell: true, encoding: 'utf8', cwd: ROOT, ...opts });
}

function banner(text) {
  console.log(`\n── ${text} ${'─'.repeat(Math.max(0, 50 - text.length))}`);
}

// ── Check 1: Node.js version ──────────────────────────────────────────────────

banner('1. Node.js version');
const [major] = process.versions.node.split('.').map(Number);
const nodeOk = major >= 18;
console.log(`   node ${process.versions.node} — ${nodeOk ? 'ok (>= 18 required)' : 'FAIL — upgrade to Node.js 18 or later'}`);
record('Node.js >= 18', nodeOk, process.versions.node);

// ── Check 2: npm install ──────────────────────────────────────────────────────

banner('2. npm install');
const installResult = run('npm install');
const installOk = installResult.status === 0;
if (installOk) {
  console.log('   dependencies installed');
} else {
  console.error(installResult.stderr || installResult.stdout);
}
record('npm install', installOk);

// ── Check 3: Syntax check ─────────────────────────────────────────────────────

banner('3. Syntax check (node --check)');

const fileSets = [
  { label: 'hooks/', glob: 'hooks/*.js' },
  { label: 'lib/', glob: 'lib/*.js' },
  { label: 'bin/', glob: 'bin/*.js' },
  { label: 'install/', glob: 'install/*.js' }
];

let syntaxFailed = [];
for (const { label, glob } of fileSets) {
  const r = run(`node --check ${glob}`);
  if (r.status !== 0) {
    syntaxFailed.push(`${label}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
    console.error(`   ${FAIL} ${label} — syntax error`);
    console.error(`     ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
  } else {
    console.log(`   ${PASS} ${label}`);
  }
}
const syntaxOk = syntaxFailed.length === 0;
record('Syntax check', syntaxOk, syntaxFailed.join('; ') || 'all files clean');

// ── Check 4: Hook registration in ~/.claude/settings.json ────────────────────

banner('4. Hook registration (~/.claude/settings.json)');

const settingsPath = join(homedir(), '.claude', 'settings.json');
const EXPECTED_HOOKS = [
  'session-start.js',
  'pre-tool-use.js',
  'post-tool-use.js',
  'subagent-stop.js'
];

let hookResults = [];

if (!existsSync(settingsPath)) {
  console.log(`   ${SKIP} ${settingsPath} not found — run 'threadwork init' first`);
  record('Hook registration', null, 'settings.json not found — not yet initialized');
} else {
  let settings = {};
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    console.error(`   ${FAIL} Could not parse ${settingsPath}`);
    record('Hook registration', false, 'Could not parse settings.json');
  }

  if (settings) {
    const allHooks = Object.values(settings.hooks ?? {})
      .flat()
      .flatMap(h => (h.hooks ?? []).map(hh => hh.command ?? ''));

    for (const hook of EXPECTED_HOOKS) {
      const found = allHooks.some(cmd => cmd.includes(hook));
      hookResults.push({ hook, found });
      console.log(`   ${found ? PASS : FAIL} ${hook}`);
    }

    const allFound = hookResults.every(r => r.found);
    const missing = hookResults.filter(r => !r.found).map(r => r.hook);
    record(
      'Hook registration',
      allFound,
      allFound ? 'all 4 hooks registered' : `missing: ${missing.join(', ')}`
    );

    if (!allFound) {
      console.log(`\n   Run 'threadwork init' to register missing hooks.`);
    }
  }
}

// ── Check 5: Unit tests ────────────────────────────────────────────────────────

banner('5. Unit tests (npm test)');
const testResult = run('npm test');
const testOk = testResult.status === 0;

// Print last 10 lines of test output (pass summary or first failure)
const testLines = (testResult.stdout || testResult.stderr || '').trim().split('\n');
const summaryLines = testLines.slice(-10);
summaryLines.forEach(l => console.log(`   ${l}`));

record('Unit tests', testOk, testOk ? 'all tests passed' : 'tests failed — see output above');

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════');
console.log('  Setup Summary');
console.log('══════════════════════════════════════════════════');

let anyFailed = false;
for (const r of results) {
  const icon = r.passed === null ? SKIP : r.passed ? PASS : FAIL;
  const status = r.passed === null ? 'SKIP' : r.passed ? 'PASS' : 'FAIL';
  console.log(`  ${icon} [${status}] ${r.label}`);
  if (r.detail && (!r.passed || r.passed === null)) {
    console.log(`         ${r.detail}`);
  }
  if (r.passed === false) anyFailed = true;
}

console.log('══════════════════════════════════════════════════\n');

if (anyFailed) {
  console.error('Setup incomplete — fix the issues above and re-run: npm run setup\n');
  process.exit(1);
} else {
  console.log('Setup complete. Start a Claude Code session and run /tw:new-project.\n');
  process.exit(0);
}
