/**
 * lib/quality-gate.js — Quality gate runner
 *
 * Runs lint, typecheck, tests, build, and security scan.
 * Auto-detects available tools; skips gracefully if absent.
 * Caches results per git commit SHA.
 */

import { execSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { readFilterConfig, filterTestOutput, filterLintOutput, filterTypecheckOutput } from './output-filter.js';

const CACHE_PATH = () => join(process.cwd(), '.threadwork', 'state', '.gate-cache.json');

function readCache() {
  const p = CACHE_PATH();
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}

function writeCache(data) {
  mkdirSync(join(process.cwd(), '.threadwork', 'state'), { recursive: true });
  writeFileSync(CACHE_PATH(), JSON.stringify(data, null, 2), 'utf8');
}

function getCurrentSha() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return 'no-git';
  }
}

/**
 * Run a shell command and return structured result.
 * @param {string} cmd
 * @param {string} [cwd]
 * @returns {{ passed: boolean, output: string, exitCode: number }}
 */
function runCmd(cmd, cwd) {
  const result = spawnSync(cmd, { shell: true, encoding: 'utf8', cwd: cwd ?? process.cwd() });
  const output = ((result.stdout ?? '') + (result.stderr ?? '')).trim();
  return {
    passed: result.status === 0,
    output,
    exitCode: result.status ?? 1
  };
}

/**
 * Check if a command binary is available.
 * @param {string} bin
 * @returns {boolean}
 */
function commandExists(bin) {
  const r = spawnSync('which', [bin], { encoding: 'utf8' });
  return r.status === 0;
}

// ── Individual Gates ──────────────────────────────────────────────────────────

/**
 * Run TypeScript type checking.
 * @returns {{ passed: boolean, errors: string[] }}
 */
export function runTypecheck() {
  if (!existsSync(join(process.cwd(), 'tsconfig.json'))) {
    return { passed: true, skipped: true, errors: [], reason: 'No tsconfig.json found' };
  }
  if (!commandExists('tsc')) {
    return { passed: true, skipped: true, errors: [], reason: 'tsc not installed' };
  }
  const result = runCmd('tsc --noEmit');
  const filterCfg = readFilterConfig();
  const errors = filterCfg.enabled
    ? filterTypecheckOutput(result.output, filterCfg)
    : result.output.split('\n').filter(l => l.includes('error TS')).map(l => l.trim());
  return { passed: result.passed, errors };
}

/**
 * Run linting. Auto-detects eslint, biome, or oxlint.
 * @returns {{ passed: boolean, errors: string[] }}
 */
export function runLint() {
  let cmd = null;

  if (existsSync(join(process.cwd(), '.eslintrc.js')) ||
      existsSync(join(process.cwd(), '.eslintrc.json')) ||
      existsSync(join(process.cwd(), 'eslint.config.js')) ||
      existsSync(join(process.cwd(), 'eslint.config.mjs'))) {
    cmd = 'npx eslint . --max-warnings 0 --format compact';
  } else if (existsSync(join(process.cwd(), 'biome.json'))) {
    cmd = 'npx biome check .';
  } else if (commandExists('oxlint')) {
    cmd = 'oxlint .';
  }

  if (!cmd) {
    return { passed: true, skipped: true, errors: [], reason: 'No linter configured' };
  }

  const result = runCmd(cmd);
  const filterCfg = readFilterConfig();
  const errors = filterCfg.enabled
    ? filterLintOutput(result.output, filterCfg)
    : result.output.split('\n').filter(l => l.includes('error') || l.includes('Error')).map(l => l.trim()).filter(Boolean);
  return { passed: result.passed, errors };
}

/**
 * Run tests.
 * @param {string} [filter] Optional test filter pattern
 * @returns {{ passed: boolean, failures: string[], coverage: number|null }}
 */
export function runTests(filter) {
  const pkg = join(process.cwd(), 'package.json');
  if (!existsSync(pkg)) {
    return { passed: true, skipped: true, failures: [], coverage: null, reason: 'No package.json found' };
  }

  let cmd = filter
    ? `npm test -- --testPathPattern=${JSON.stringify(filter)} --passWithNoTests`
    : 'npm test -- --passWithNoTests';

  // Detect test runner
  try {
    const pkgData = JSON.parse(readFileSync(pkg, 'utf8'));
    const scripts = pkgData.scripts ?? {};
    if (!scripts.test) {
      return { passed: true, skipped: true, failures: [], coverage: null, reason: 'No test script in package.json' };
    }
    if (pkgData.devDependencies?.jest || pkgData.dependencies?.jest) {
      cmd = filter
        ? `npx jest ${JSON.stringify(filter)} --passWithNoTests`
        : 'npx jest --passWithNoTests';
    } else if (pkgData.devDependencies?.vitest || pkgData.dependencies?.vitest) {
      cmd = filter ? `npx vitest run ${JSON.stringify(filter)}` : 'npx vitest run';
    }
  } catch { /* use npm test fallback */ }

  const result = runCmd(cmd);
  const filterCfg = readFilterConfig();
  const failures = filterCfg.enabled
    ? filterTestOutput(result.output, filterCfg)
    : result.output.split('\n').filter(l => l.includes('FAIL') || l.includes('✗') || l.includes('× ')).map(l => l.trim());

  // Try to extract coverage from output
  const coverageMatch = result.output.match(/(\d+(?:\.\d+)?)\s*%\s*(?:branch|statement|line|coverage)/i);
  const coverage = coverageMatch ? parseFloat(coverageMatch[1]) : null;

  return { passed: result.passed, failures, coverage };
}

/**
 * Run build check.
 * @returns {{ passed: boolean, errors: string[] }}
 */
export function runBuild() {
  const pkg = join(process.cwd(), 'package.json');
  if (!existsSync(pkg)) {
    return { passed: true, skipped: true, errors: [], reason: 'No package.json found' };
  }
  try {
    const pkgData = JSON.parse(readFileSync(pkg, 'utf8'));
    if (!pkgData.scripts?.build) {
      return { passed: true, skipped: true, errors: [], reason: 'No build script in package.json' };
    }
  } catch { /* continue */ }

  const result = runCmd('npm run build');
  const errors = result.output
    .split('\n')
    .filter(l => l.includes('error') || l.includes('Error') || l.includes('ERROR'))
    .map(l => l.trim())
    .filter(Boolean);
  return { passed: result.passed, errors };
}

/**
 * Run security scan via npm audit.
 * @returns {{ passed: boolean, vulnerabilities: string[] }}
 */
export function runSecurityScan() {
  if (!existsSync(join(process.cwd(), 'package-lock.json')) &&
      !existsSync(join(process.cwd(), 'yarn.lock')) &&
      !existsSync(join(process.cwd(), 'pnpm-lock.yaml'))) {
    return { passed: true, skipped: true, vulnerabilities: [], reason: 'No lock file found' };
  }
  const result = runCmd('npm audit --audit-level high --json');
  let vulnerabilities = [];
  try {
    const data = JSON.parse(result.output);
    const vulns = data.vulnerabilities ?? {};
    vulnerabilities = Object.keys(vulns)
      .filter(k => ['high', 'critical'].includes(vulns[k].severity))
      .map(k => `${k} (${vulns[k].severity})`);
  } catch { /* audit output may not be JSON if errors */ }
  return { passed: result.passed, vulnerabilities };
}

// ── Spec Compliance Gate (v0.3.2) ─────────────────────────────────────────────


/**
 * Run spec compliance gate: evaluate rules from all specs + optional structural tests.
 * @param {{ specsDir?: string, projectRoot?: string }} [options]
 * @returns {{ gate: string, passed: boolean, violations: object[], structuralFailures: object[], skipped: boolean }}
 */
export async function runSpecCompliance(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const specsDir = options.specsDir ?? join(process.cwd(), '.threadwork', 'specs');

  try {
    // Dynamically import to avoid circular dependencies
    const { evaluateRules } = await import('./rule-evaluator.js');

    let rules = [];
    try {
      const { loadRulesFromSpecs } = await import('./spec-engine.js');
      rules = loadRulesFromSpecs(specsDir);
    } catch { /* spec-engine may not have this function yet */ }

    const ruleResult = evaluateRules(rules, projectRoot);
    const structResult = await runStructuralTests(projectRoot);

    return {
      gate: 'spec-compliance',
      passed: ruleResult.passed && structResult.passed,
      violations: ruleResult.violations,
      structuralFailures: structResult.errors,
      skipped: rules.length === 0 && structResult.tests === 0
    };
  } catch {
    return {
      gate: 'spec-compliance',
      passed: true,
      violations: [],
      structuralFailures: [],
      skipped: true
    };
  }
}

/**
 * Run structural tests from .threadwork/structural-tests/*.js
 * @param {string} projectRoot
 * @returns {{ passed: boolean, errors: object[], tests: number }}
 */
export async function runStructuralTests(projectRoot) {
  const testsDir = join(projectRoot ?? process.cwd(), '.threadwork', 'structural-tests');

  if (!existsSync(testsDir)) {
    return { passed: true, errors: [], tests: 0 };
  }

  const testFiles = readdirSync(testsDir).filter(f => f.endsWith('.js'));
  if (testFiles.length === 0) return { passed: true, errors: [], tests: 0 };

  let allPassed = true;
  const errors = [];

  for (const file of testFiles) {
    try {
      const mod = await import(join(testsDir, file));
      if (typeof mod.check === 'function') {
        const result = await mod.check(projectRoot ?? process.cwd());
        if (!result?.passed) {
          allPassed = false;
          errors.push({
            test: mod.name ?? file,
            specId: mod.specId ?? 'custom',
            errors: result?.errors ?? ['structural test failed']
          });
        }
      }
    } catch (err) {
      // Skip malformed test files
      errors.push({ test: file, specId: 'custom', errors: [err.message] });
      allPassed = false;
    }
  }

  return { passed: allPassed, errors, tests: testFiles.length };
}

// ── Doc Freshness Gate (v0.3.2) ───────────────────────────────────────────────

/**
 * Run the doc-freshness gate.
 * @returns {{ gate: string, passed: boolean, issues: object[], skipped: boolean }}
 */
export async function runDocFreshness() {
  const specsDir = join(process.cwd(), '.threadwork', 'specs');

  if (!existsSync(specsDir)) {
    return { gate: 'doc-freshness', passed: true, issues: [], skipped: true };
  }

  try {
    const { checkDocFreshness } = await import('./doc-freshness.js');
    const result = checkDocFreshness(specsDir, process.cwd());
    return {
      gate: 'doc-freshness',
      passed: result.passed,
      issues: result.issues,
      skipped: false
    };
  } catch {
    return { gate: 'doc-freshness', passed: true, issues: [], skipped: true };
  }
}

// ── Smoke Test Gate (v0.3.2) ──────────────────────────────────────────────────

/**
 * Run a smoke test: auto-detect start script, start app, wait for ready signal.
 * Times out after 15 seconds.
 * @returns {{ gate: string, passed: boolean, errors: string[], skipped?: boolean, reason?: string }}
 */
export async function runSmokeTest() {
  const pkg = join(process.cwd(), 'package.json');
  if (!existsSync(pkg)) {
    return { gate: 'smoke-test', passed: true, skipped: true, errors: [], reason: 'No package.json' };
  }

  let startCmd = null;
  try {
    const pkgData = JSON.parse(readFileSync(pkg, 'utf8'));
    const scripts = pkgData.scripts ?? {};
    // Look for a start/dev script
    startCmd = scripts.start ?? scripts.dev ?? scripts.serve ?? null;
  } catch { /* continue */ }

  if (!startCmd) {
    return { gate: 'smoke-test', passed: true, skipped: true, errors: [], reason: 'No start/dev script in package.json' };
  }

  // For CLI tools: check if main command exits cleanly with --help or --version
  const isCliLike = startCmd.includes('node') || startCmd.includes('bin');
  if (isCliLike) {
    const cliResult = runCmd(`${startCmd.split(' ')[0]} --version 2>/dev/null || ${startCmd.split(' ')[0]} --help 2>/dev/null`);
    return {
      gate: 'smoke-test',
      passed: cliResult.passed,
      errors: cliResult.passed ? [] : [cliResult.output.slice(0, 200)],
      skipped: false
    };
  }

  // For web apps: just check that build doesn't fail (full start would require a running server)
  return { gate: 'smoke-test', passed: true, skipped: true, errors: [], reason: 'Web app start not tested in Ralph Loop (use verify-phase)' };
}

/**
 * Run endpoint verification from plan XML verification blocks.
 * @param {string} [planXml] Optional XML to parse for verification blocks
 * @returns {{ gate: string, passed: boolean, results: object[], skipped?: boolean }}
 */
export async function runEndpointVerification(planXml) {
  if (!planXml) {
    return { gate: 'endpoint-verification', passed: true, results: [], skipped: true };
  }

  // Parse HTTP check blocks from plan XML: <http_check url="..." expected_status="200" />
  const checks = [];
  const httpMatches = [...(planXml.matchAll(/<http_check\s+([^/>]+)\/?>/g))];
  for (const m of httpMatches) {
    const attrs = m[1];
    const urlMatch = attrs.match(/url=["']([^"']+)["']/);
    const statusMatch = attrs.match(/expected_status=["']?(\d+)["']?/);
    if (urlMatch) {
      checks.push({
        url: urlMatch[1],
        expectedStatus: parseInt(statusMatch?.[1] ?? '200', 10)
      });
    }
  }

  if (checks.length === 0) {
    return { gate: 'endpoint-verification', passed: true, results: [], skipped: true };
  }

  const results = [];
  let allPassed = true;

  for (const check of checks) {
    try {
      const r = runCmd(`curl -s -o /dev/null -w "%{http_code}" --max-time 5 ${JSON.stringify(check.url)}`);
      const statusCode = parseInt(r.output.trim(), 10);
      const passed = statusCode === check.expectedStatus;
      results.push({ url: check.url, expected: check.expectedStatus, actual: statusCode, passed });
      if (!passed) allPassed = false;
    } catch {
      results.push({ url: check.url, expected: check.expectedStatus, actual: 0, passed: false });
      allPassed = false;
    }
  }

  return { gate: 'endpoint-verification', passed: allPassed, results };
}

// ── Failure Classification (v0.3.2) ───────────────────────────────────────────

/**
 * Classify a gate failure to drive classification-aware retry strategy.
 *
 * Types:
 *   code_bug — agent made a fixable mistake → retry normally
 *   knowledge_gap — agent didn't know about X → inject missing spec + propose at 0.5
 *   missing_capability — agent needed unavailable tool → log gap, don't waste retries
 *   architectural_violation — agent broke undocumented rule → propose rule at 0.5
 *
 * @param {object} gateResults Output from runAll() with .results array
 * @param {object} [specEngine] Module with wasSpecFetchedThisSession(), findRelatedSpec()
 * @returns {{ type: string, confidence: number, evidence: string, recommendation: string }}
 */
export function classifyFailure(gateResults, specEngine) {
  const results = gateResults?.results ?? [];
  const failed = results.filter(r => !r.passed && !r.skipped);

  if (failed.length === 0) {
    return {
      type: 'code_bug',
      confidence: 0.3,
      evidence: 'No specific failure details available',
      recommendation: 'Retry with careful attention to the error output'
    };
  }

  const primary = failed[0];
  const errors = primary.errors ?? primary.failures ?? primary.violations ?? [];
  const firstError = (errors[0] ?? '').toString();

  // Priority 1: spec-compliance violation → architectural_violation
  if (primary.gate === 'spec-compliance' && (primary.violations ?? []).length > 0) {
    const violation = primary.violations[0];
    return {
      type: 'architectural_violation',
      confidence: 0.5,
      evidence: `Spec rule violated: ${violation.message ?? firstError}`,
      recommendation: `Fix the spec rule violation in ${violation.files?.[0] ?? 'the affected file'}. The rule is defined in ${violation.specId}.`
    };
  }

  // Priority 2: check if error relates to a spec that exists but wasn't fetched → knowledge_gap
  if (specEngine?.findRelatedSpec) {
    try {
      const relatedSpec = specEngine.findRelatedSpec(firstError);
      if (relatedSpec) {
        // Extract spec ID from the related spec string
        const specIdMatch = relatedSpec.match(/SPEC:[a-zA-Z0-9_-]+-\d+/);
        const specId = specIdMatch?.[0];

        if (specId && specEngine.wasSpecFetchedThisSession) {
          const wasFetched = specEngine.wasSpecFetchedThisSession(specId);
          if (!wasFetched) {
            return {
              type: 'knowledge_gap',
              confidence: 0.5,
              evidence: `Error relates to ${relatedSpec} but agent did not fetch that spec`,
              recommendation: `Fetch ${specId} before retrying — it contains relevant guidance for this error`,
              relatedSpecId: specId
            };
          }
        }
      }
    } catch { /* never crash */ }
  }

  // Priority 3: check if error suggests missing tool/resource → missing_capability
  const missingCapabilityPatterns = [
    /command not found/i,
    /no such file or directory.*bin/i,
    /cannot find module/i,
    /ENOENT.*node_modules/i,
    /not installed/i,
    /permission denied.*bin/i,
    /spawn.*ENOENT/i
  ];
  if (missingCapabilityPatterns.some(p => p.test(firstError))) {
    return {
      type: 'missing_capability',
      confidence: 0,
      evidence: `Missing tool or resource: ${firstError.slice(0, 200)}`,
      recommendation: 'Log as capability gap. Do not retry — the required tool/resource is not available in this environment.'
    };
  }

  // Default → code_bug
  return {
    type: 'code_bug',
    confidence: 0.3,
    evidence: `${primary.gate} failure: ${firstError.slice(0, 200)}`,
    recommendation: 'Review the error and fix the code — this appears to be a standard implementation error'
  };
}

// ── Utility Scanner (v0.3.2) ──────────────────────────────────────────────────

/**
 * Scan common utility directories for exported function/class names.
 * Used by tw-reviewer to check for duplication.
 * @returns {{ functions: string[], classes: string[] }}
 */
export function scanExistingUtilities() {
  const utilDirs = ['src/lib', 'src/utils', 'src/helpers', 'lib', 'utils'];
  const functions = [];
  const classes = [];
  const root = process.cwd();

  for (const dir of utilDirs) {
    const absDir = join(root, dir);
    if (!existsSync(absDir)) continue;

    try {
      const files = readdirSync(absDir).filter(f =>
        f.endsWith('.js') || f.endsWith('.ts') || f.endsWith('.mjs')
      );

      for (const file of files) {
        try {
          const content = readFileSync(join(absDir, file), 'utf8');

          // Extract exported function names
          const funcMatches = [...content.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)];
          funcMatches.forEach(m => functions.push(`${dir}/${file}:${m[1]}`));

          // Extract exported const arrow functions
          const arrowMatches = [...content.matchAll(/^export\s+const\s+(\w+)\s*=/gm)];
          arrowMatches.forEach(m => functions.push(`${dir}/${file}:${m[1]}`));

          // Extract exported class names
          const classMatches = [...content.matchAll(/^export\s+class\s+(\w+)/gm)];
          classMatches.forEach(m => classes.push(`${dir}/${file}:${m[1]}`));
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  return { functions, classes };
}

// ── Remediation Block ─────────────────────────────────────────────────────────

/**
 * Build a structured remediation block from quality gate failures.
 * Transforms every rejection into a teaching event: primary violation,
 * relevant spec reference, and a concrete fix template.
 *
 * @param {object} gateResults - Output from runAll() (with .results array)
 * @param {object} [specEngine] - Instance with findRelatedSpec(msg) method
 * @param {string} [skillTier] - 'beginner', 'advanced', or 'ninja'
 * @returns {{ primary_violation: string, relevant_spec: string, fix_template: string, learning_signal: string }}
 */
export function buildRemediationBlock(gateResults, specEngine, skillTier = 'advanced') {
  const results = gateResults?.results ?? [];

  // Priority: typecheck > lint > tests > spec-compliance > doc-freshness > smoke-test > build > security
  const priority = ['typecheck', 'lint', 'tests', 'spec-compliance', 'doc-freshness', 'smoke-test', 'build', 'security'];
  const failed = priority
    .map(gate => results.find(r => r.gate === gate && !r.passed && !r.skipped))
    .filter(Boolean);

  if (failed.length === 0) {
    return {
      primary_violation: 'Unknown failure',
      relevant_spec: 'None identified',
      fix_template: 'Review the quality gate output above for details.',
      learning_signal: 'Unclassified gate failure'
    };
  }

  const primary = failed[0];
  const errors = primary.errors ?? primary.failures ?? primary.vulnerabilities ?? [];
  const firstError = errors[0] ?? primary.output ?? 'No error details available';

  // Parse error by gate type to build a concrete fix template
  let primaryViolation = '';
  let fixTemplate = '';
  let learningSignal = '';

  if (primary.gate === 'typecheck') {
    // Parse: "src/auth.ts(42,5): error TS2339: Property 'token' does not exist on type 'User'"
    const match = firstError.match(/^([^(]+)\((\d+),\d+\):\s*error\s*(TS\d+):\s*(.+)/);
    if (match) {
      primaryViolation = `TypeScript error ${match[3]}: ${match[4].trim()}`;
      fixTemplate = skillTier === 'ninja'
        ? `${match[1]}:${match[2]} — ${match[4].trim()}`
        : skillTier === 'beginner'
          ? `TypeScript found a type error at ${match[1]} line ${match[2]}.\n` +
            `Error: ${match[4].trim()}\n` +
            `Fix: Verify the type definition for the value you are accessing. ` +
            `Check the relevant type interface and ensure all properties exist before use.`
          : `Fix ${match[3]} at ${match[1]}:${match[2]}: ${match[4].trim()}`;
      learningSignal = `TypeScript ${match[3]} — ${match[4].split('.')[0].trim()}`;
    } else {
      primaryViolation = `TypeScript type error: ${firstError.slice(0, 120)}`;
      fixTemplate = skillTier === 'ninja'
        ? firstError.slice(0, 120)
        : `Resolve the TypeScript type error: ${firstError.slice(0, 200)}`;
      learningSignal = 'TypeScript type error pattern';
    }
  } else if (primary.gate === 'lint') {
    // Parse ESLint compact: "path/to/file.ts: line 10, col 5, Error - message (rule-name)"
    const match = firstError.match(/^(.+?):\s*line\s*(\d+).*?Error\s*-\s*(.+?)\s*\((.+?)\)$/);
    if (match) {
      primaryViolation = `Lint error (${match[4]}): ${match[3]}`;
      fixTemplate = skillTier === 'ninja'
        ? `${match[1]}:${match[2]} — ${match[3]} [${match[4]}]`
        : skillTier === 'beginner'
          ? `ESLint found a rule violation in ${match[1]} at line ${match[2]}.\n` +
            `Rule: ${match[4]}\nMessage: ${match[3]}\n` +
            `Fix: Address the linting rule violation. Run \`npx eslint ${match[1]} --fix\` for auto-fixable issues.`
          : `Fix lint rule ${match[4]} at ${match[1]}:${match[2]}: ${match[3]}`;
      learningSignal = `ESLint rule violation: ${match[4]}`;
    } else {
      primaryViolation = `Lint error: ${firstError.slice(0, 120)}`;
      fixTemplate = skillTier === 'ninja'
        ? firstError.slice(0, 120)
        : `Resolve the lint error: ${firstError.slice(0, 200)}`;
      learningSignal = 'Lint violation pattern';
    }
  } else if (primary.gate === 'tests') {
    // Parse test failure name
    const testNameMatch = firstError.match(/[✗×]\s*(.+)/);
    const testName = testNameMatch ? testNameMatch[1].trim() : firstError.slice(0, 80);
    primaryViolation = `Test failure: ${testName}`;
    fixTemplate = skillTier === 'ninja'
      ? `Test failed: ${testName}`
      : skillTier === 'beginner'
        ? `A test is failing: "${testName}"\n` +
          `Fix: Run the test in isolation to see the full error, check expected vs actual values, ` +
          `and ensure your implementation matches the test's contract.`
        : `Failing test: "${testName}" — check expected vs actual values and fix the implementation.`;
    learningSignal = `Test failure: ${testName.split('>')[0].trim()}`;
  } else if (primary.gate === 'spec-compliance') {
    const violations = primary.violations ?? [];
    const firstViolation = violations[0];
    if (firstViolation) {
      primaryViolation = `${firstViolation.specId} rule violated: ${firstViolation.message}`;
      fixTemplate = skillTier === 'ninja'
        ? `${firstViolation.ruleType}: ${firstViolation.evidence?.slice(0, 120) ?? firstViolation.message}`
        : `Fix spec rule violation:\n  Spec: ${firstViolation.specId}\n  Rule type: ${firstViolation.ruleType}\n  ${firstViolation.message}\n  Evidence: ${firstViolation.evidence?.slice(0, 200) ?? 'See files: ' + (firstViolation.files ?? []).join(', ')}`;
      learningSignal = `spec-rule:${firstViolation.specId}:${firstViolation.ruleType}`;
    } else if ((primary.structuralFailures ?? []).length > 0) {
      const sf = primary.structuralFailures[0];
      primaryViolation = `Structural test failed: ${sf.test ?? 'unknown'}`;
      fixTemplate = `Fix structural test "${sf.test ?? 'unknown'}": ${(sf.errors ?? []).join('; ')}`;
      learningSignal = `structural-test:${sf.test ?? 'unknown'}`;
    } else {
      primaryViolation = 'Spec compliance check failed';
      fixTemplate = 'Review spec rules and ensure code satisfies all machine-checkable constraints';
      learningSignal = 'spec-compliance failure';
    }
  } else if (primary.gate === 'doc-freshness') {
    const issues = primary.issues ?? [];
    const blockingIssues = issues.filter(i => i.severity === 'error');
    const firstIssue = blockingIssues[0] ?? issues[0];
    if (firstIssue) {
      primaryViolation = `Doc-freshness issue (${firstIssue.type}): ${firstIssue.message}`;
      fixTemplate = `Resolve the stale spec reference:\n  Type: ${firstIssue.type}\n  Spec: ${firstIssue.specId ?? 'unknown'}\n  ${firstIssue.message}`;
      learningSignal = `doc-freshness:${firstIssue.type}:${firstIssue.specId ?? 'unknown'}`;
    } else {
      primaryViolation = 'Doc freshness gate failed';
      fixTemplate = 'Update or fix stale spec references detected by the doc-freshness gate';
      learningSignal = 'doc-freshness failure';
    }
  } else {
    primaryViolation = `${primary.gate} failure: ${firstError.slice(0, 120)}`;
    fixTemplate = `Resolve the ${primary.gate} failure: ${firstError.slice(0, 200)}`;
    learningSignal = `${primary.gate} failure pattern`;
  }

  // Find related spec via spec engine keyword search
  let relevantSpec = 'None identified';
  if (specEngine && typeof specEngine.findRelatedSpec === 'function') {
    try {
      const found = specEngine.findRelatedSpec(firstError);
      if (found) relevantSpec = found;
    } catch { /* never crash */ }
  }

  return {
    primary_violation: primaryViolation,
    relevant_spec: relevantSpec,
    fix_template: fixTemplate,
    learning_signal: learningSignal
  };
}

// ── Run All ───────────────────────────────────────────────────────────────────

/**
 * Run all configured quality gates.
 * @param {{ build?: boolean, skipCache?: boolean }} [options]
 * @returns {{ passed: boolean, results: object[] }}
 */
export async function runAll(options = {}) {
  const sha = getCurrentSha();
  const cacheKey = `${sha}-${options.build ? 'build' : 'nobuild'}`;

  if (!options.skipCache) {
    const cache = readCache();
    if (cache[cacheKey]) {
      return { ...cache[cacheKey], cached: true };
    }
  }

  // Load quality config
  const configPath = join(process.cwd(), '.threadwork', 'state', 'quality-config.json');
  let config = {
    typecheck: { enabled: true, blocking: true },
    lint: { enabled: true, blocking: true },
    tests: { enabled: true, blocking: true },
    'spec-compliance': { enabled: true, blocking: true },
    'doc-freshness': { enabled: true, blocking: true },
    'smoke-test': { enabled: false, blocking: false },
    build: { enabled: false, blocking: false },
    security: { enabled: true, blocking: false }
  };
  if (existsSync(configPath)) {
    try { config = { ...config, ...JSON.parse(readFileSync(configPath, 'utf8')) }; } catch { /* use defaults */ }
  }

  const results = [];
  let allPassed = true;

  if (config.typecheck?.enabled !== false) {
    const r = runTypecheck();
    results.push({ gate: 'typecheck', ...r });
    if (!r.passed && !r.skipped && config.typecheck?.blocking !== false) allPassed = false;
  }

  if (config.lint?.enabled !== false) {
    const r = runLint();
    results.push({ gate: 'lint', ...r });
    if (!r.passed && !r.skipped && config.lint?.blocking !== false) allPassed = false;
  }

  if (config.tests?.enabled !== false) {
    const r = runTests();
    results.push({ gate: 'tests', ...r });
    if (!r.passed && !r.skipped && config.tests?.blocking !== false) allPassed = false;
  }

  // Spec compliance gate (v0.3.2)
  if (config['spec-compliance']?.enabled !== false) {
    const r = await runSpecCompliance({ projectRoot: process.cwd() });
    results.push(r);
    if (!r.passed && !r.skipped && config['spec-compliance']?.blocking !== false) allPassed = false;
  }

  // Doc freshness gate (v0.3.2)
  if (config['doc-freshness']?.enabled !== false) {
    const r = await runDocFreshness();
    results.push(r);
    if (!r.passed && !r.skipped && config['doc-freshness']?.blocking !== false) allPassed = false;
  }

  // Smoke test gate (v0.3.2) — only in Ralph Loop for applicable profiles
  if (config['smoke-test']?.enabled) {
    const r = await runSmokeTest();
    results.push(r);
    if (!r.passed && !r.skipped && config['smoke-test']?.blocking !== false) allPassed = false;
  }

  if ((options.build || config.build?.enabled) && config.build?.enabled !== false) {
    const r = runBuild();
    results.push({ gate: 'build', ...r });
    if (!r.passed && !r.skipped && config.build?.blocking !== false) allPassed = false;
  }

  if (config.security?.enabled !== false) {
    const r = runSecurityScan();
    results.push({ gate: 'security', ...r });
    if (!r.passed && !r.skipped && config.security?.blocking !== false) allPassed = false;
  }

  const outcome = { passed: allPassed, results, ranAt: new Date().toISOString() };

  // Cache result
  const cache = readCache();
  cache[cacheKey] = outcome;
  writeCache(cache);

  return outcome;
}
