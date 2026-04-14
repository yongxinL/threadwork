/**
 * lib/output-filter.js — Token-efficient command output filtering
 *
 * Applies four strategies to command output before embedding in agent context:
 *   1. Smart Filtering  — removes noise (passing tests, progress lines, boilerplate)
 *   2. Grouping         — aggregates similar items (errors by rule/file, failures by suite)
 *   3. Truncation       — caps output size, always appends omission counts
 *   4. Deduplication    — collapses repeated messages with occurrence counts
 *
 * Controlled via the `outputFilter` key in .threadwork/state/quality-config.json:
 *
 *   {
 *     "outputFilter": {
 *       "enabled": true,
 *       "maxFailures": 10,
 *       "maxErrorsPerGroup": 3,
 *       "maxLineLength": 200,
 *       "strategies": {
 *         "smartFiltering": true,
 *         "grouping": true,
 *         "truncation": true,
 *         "deduplication": true
 *       }
 *     }
 *   }
 *
 * Set `enabled: false` (or omit the key entirely) to disable all filtering and
 * pass raw output through unchanged.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const CONFIG_PATH = () => join(process.cwd(), '.threadwork', 'state', 'quality-config.json');

const DEFAULT_CONFIG = {
  enabled: true,
  maxFailures: 10,
  maxErrorsPerGroup: 3,
  maxLineLength: 200,
  strategies: {
    smartFiltering: true,
    grouping: true,
    truncation: true,
    deduplication: true
  }
};

/**
 * Read outputFilter config from .threadwork/state/quality-config.json.
 * Returns defaults (enabled: false) if the file or key is absent.
 * @returns {object}
 */
export function readFilterConfig() {
  if (!existsSync(CONFIG_PATH())) return { ...DEFAULT_CONFIG };
  try {
    const data = JSON.parse(readFileSync(CONFIG_PATH(), 'utf8'));
    const cfg = data.outputFilter ?? {};
    return {
      ...DEFAULT_CONFIG,
      ...cfg,
      strategies: { ...DEFAULT_CONFIG.strategies, ...(cfg.strategies ?? {}) }
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncateLine(str, max) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}

// ── Strategy 1+2+3+4: Test output ────────────────────────────────────────────

/**
 * Filter test runner output (node --test / TAP, Jest, Vitest).
 *
 * Strategy breakdown:
 *   Smart Filtering  — strips passing test lines (✔, ok N, PASS suites)
 *   Grouping         — collects multi-line failure blocks into single entries
 *   Truncation       — keeps first `maxFailures`, appends "+ N more" count
 *   Deduplication    — collapses blocks with identical failure headers
 *
 * @param {string} output  Raw test runner stdout+stderr
 * @param {object} config  From readFilterConfig()
 * @returns {string[]}     Compact failure strings, one per failure
 */
export function filterTestOutput(output, config) {
  const {
    maxFailures = 10,
    maxLineLength = 200,
    strategies = {}
  } = config;

  const useSmartFilter  = strategies.smartFiltering  !== false;
  const useGrouping     = strategies.grouping        !== false;
  const useTruncation   = strategies.truncation      !== false;
  const useDedup        = strategies.deduplication   !== false;

  const lines = output.split('\n');
  const failures = [];   // { header, details[], count }
  let currentBlock = null;
  let passingCount = 0;

  // Patterns that signal a passing line or TAP boilerplate — safe to drop
  const PASSING_RE  = /^(✔|ok \d+[\s-]|TAP version|# pass\b|# tests\b|# pending\b|# todo\b|passing\s+\()/;
  const SKIP_RE     = /^(PASS\s|# Subtest:|▶ finished|▶ \w)/;
  // Patterns that signal the start of a failure block
  const FAILURE_RE  = /^(✗|not ok \d+|× |FAIL\s|^\s+●\s|✕ |▶.+\([\d.]+ms\)\s*\n.*not ok)/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // ── Smart Filtering: skip passing / boilerplate ──────────────────────────
    if (useSmartFilter) {
      if (PASSING_RE.test(line) || SKIP_RE.test(line)) {
        passingCount++;
        if (currentBlock) { failures.push(currentBlock); currentBlock = null; }
        continue;
      }
    }

    // ── Grouping: detect failure block start ─────────────────────────────────
    if (FAILURE_RE.test(line)) {
      if (currentBlock) failures.push(currentBlock);
      currentBlock = { header: line, details: [] };
      continue;
    }

    // ── Grouping: collect indented detail lines that follow a failure ─────────
    if (currentBlock && (rawLine.startsWith('  ') || rawLine.startsWith('\t'))) {
      if (currentBlock.details.length < 5) {
        currentBlock.details.push(line);
      }
      continue;
    }

    // Non-indented line ends the current failure block
    if (currentBlock) { failures.push(currentBlock); currentBlock = null; }
  }
  if (currentBlock) failures.push(currentBlock);

  if (failures.length === 0) return [];

  // ── Deduplication: collapse identical failure headers ────────────────────────
  let processed;
  if (useDedup) {
    const seen = new Map();
    for (const f of failures) {
      if (seen.has(f.header)) {
        seen.get(f.header).count++;
      } else {
        seen.set(f.header, { ...f, count: 1 });
      }
    }
    processed = [...seen.values()];
  } else {
    processed = failures.map(f => ({ ...f, count: 1 }));
  }

  // ── Truncation: keep first maxFailures ───────────────────────────────────────
  const truncated = useTruncation ? processed.slice(0, maxFailures) : processed;
  const omitted   = processed.length - truncated.length;

  // Format: each failure → one compact string with the first detail for context
  const result = truncated.map(f => {
    const countStr    = f.count > 1 ? ` (×${f.count})` : '';
    const firstDetail = f.details[0] ? ` — ${f.details[0]}` : '';
    return truncateLine(`${f.header}${countStr}${firstDetail}`, maxLineLength);
  });

  if (omitted > 0)      result.push(`... +${omitted} more failures`);
  if (passingCount > 0) result.push(`(${passingCount} passing lines hidden)`);

  return result;
}

// ── Strategy 1+2+3+4: Lint output ────────────────────────────────────────────

/**
 * Filter linter output (ESLint compact, Biome, oxlint).
 *
 * Strategy breakdown:
 *   Smart Filtering  — strips summary lines ("N problems"), pure-warning lines when errors exist
 *   Grouping         — aggregates violations by rule name
 *   Truncation       — keeps first `maxFailures` rule groups, `maxErrorsPerGroup` locations each
 *   Deduplication    — collapses identical file+line pairs within a rule
 *
 * @param {string} output  Raw linter stdout+stderr
 * @param {object} config  From readFilterConfig()
 * @returns {string[]}     One string per rule group, e.g. "no-unused-vars (3): file.js:42, other.js:8 +1 more"
 */
export function filterLintOutput(output, config) {
  const {
    maxFailures = 20,
    maxErrorsPerGroup = 3,
    maxLineLength = 200,
    strategies = {}
  } = config;

  const useSmartFilter = strategies.smartFiltering !== false;
  const useGrouping    = strategies.grouping       !== false;
  const useTruncation  = strategies.truncation     !== false;
  const useDedup       = strategies.deduplication  !== false;

  // Noise lines to drop
  const NOISE_RE = /^(\d+ problems?|✖ \d+|⚠ \d+|Found \d+ error|No lint errors|✔ No issues|warning\s+\d+|error\s+\d+\s+warning)/i;

  const violations = [];

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    // Smart Filtering: drop summary / decoration lines
    if (useSmartFilter && NOISE_RE.test(line)) continue;

    // ESLint compact format: "/path/file.js: line 42, col 3, Error - msg (rule-name)"
    const eslintMatch = line.match(/^(.+?):\s*line\s*(\d+),\s*col\s*\d+,\s*(Error|Warning)\s*-\s*(.+?)\s*\(([^)]+)\)$/);
    if (eslintMatch) {
      violations.push({
        file:     eslintMatch[1].split('/').slice(-2).join('/'),
        line:     eslintMatch[2],
        severity: eslintMatch[3],
        message:  eslintMatch[4],
        rule:     eslintMatch[5]
      });
      continue;
    }

    // Generic error line fallback — keep if it contains "error"
    if (/error/i.test(line)) {
      violations.push({ file: '', line: '', severity: 'Error', message: truncateLine(line, maxLineLength), rule: 'unknown' });
    }
  }

  if (violations.length === 0) return [];

  // ── Grouping: aggregate by rule ──────────────────────────────────────────────
  if (useGrouping) {
    const byRule = new Map();
    for (const v of violations) {
      if (!byRule.has(v.rule)) byRule.set(v.rule, []);
      byRule.get(v.rule).push(v);
    }

    const ruleEntries = [...byRule.entries()];
    const shown = useTruncation ? ruleEntries.slice(0, maxFailures) : ruleEntries;
    const omittedRules = ruleEntries.length - shown.length;
    const result = [];

    for (const [rule, vList] of shown) {
      // Deduplication: unique file:line locations within the rule
      const locations = vList.map(v => v.file ? `${v.file}:${v.line}` : v.message);
      const unique = useDedup ? [...new Set(locations)] : locations;
      const shownLocs = unique.slice(0, maxErrorsPerGroup);
      const omittedLocs = unique.length - shownLocs.length;

      let entry = `${rule} (${vList.length}): ${shownLocs.join(', ')}`;
      if (omittedLocs > 0) entry += ` +${omittedLocs} more`;
      result.push(truncateLine(entry, maxLineLength));
    }

    if (omittedRules > 0) result.push(`... +${omittedRules} more rules`);
    return result;
  }

  // No grouping — flat deduplicated list
  let flat = violations.map(v =>
    v.file ? `${v.file}:${v.line} — ${v.message} (${v.rule})` : v.message
  );
  if (useDedup) flat = [...new Set(flat)];
  const truncated = useTruncation ? flat.slice(0, maxFailures) : flat;
  const omitted   = flat.length - truncated.length;
  const result    = truncated.map(l => truncateLine(l, maxLineLength));
  if (omitted > 0) result.push(`... +${omitted} more errors`);
  return result;
}

// ── Strategy 1+2+3+4: TypeScript output ──────────────────────────────────────

/**
 * Filter TypeScript compiler output (tsc --noEmit).
 *
 * Strategy breakdown:
 *   Smart Filtering  — only keeps lines matching "error TSxxxx" format
 *   Grouping         — aggregates errors by source file
 *   Truncation       — keeps first `maxFailures` files, `maxErrorsPerGroup` errors each
 *   Deduplication    — collapses the same error code appearing on multiple lines in one file
 *
 * @param {string} output  Raw tsc stdout+stderr
 * @param {object} config  From readFilterConfig()
 * @returns {string[]}     One string per file group, e.g. "src/auth.ts: TS2339:42, TS2345:67 — Property does not exist"
 */
export function filterTypecheckOutput(output, config) {
  const {
    maxFailures = 20,
    maxErrorsPerGroup = 3,
    maxLineLength = 200,
    strategies = {}
  } = config;

  const useGrouping   = strategies.grouping      !== false;
  const useTruncation = strategies.truncation    !== false;
  const useDedup      = strategies.deduplication !== false;

  const errors = [];

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    // TSC format: "src/file.ts(42,5): error TS2339: Property 'x' does not exist on type 'Y'"
    const match = line.match(/^(.+?)\((\d+),\d+\):\s*error\s+(TS\d+):\s*(.+)$/);
    if (match) {
      errors.push({
        file:    match[1].split('/').slice(-2).join('/'),
        line:    match[2],
        code:    match[3],
        message: match[4].trim()
      });
    }
  }

  if (errors.length === 0) return [];

  // ── Grouping: aggregate by file ──────────────────────────────────────────────
  if (useGrouping) {
    const byFile = new Map();
    for (const e of errors) {
      if (!byFile.has(e.file)) byFile.set(e.file, []);
      byFile.get(e.file).push(e);
    }

    const fileEntries = [...byFile.entries()];
    const shown = useTruncation ? fileEntries.slice(0, maxFailures) : fileEntries;
    const omittedFiles = fileEntries.length - shown.length;
    const result = [];

    for (const [file, eList] of shown) {
      // Deduplication: collapse same error code at different lines
      const codes = useDedup
        ? [...new Set(eList.map(e => `${e.code}:${e.line}`))]
        : eList.map(e => `${e.code}:${e.line}`);

      const shownCodes  = codes.slice(0, maxErrorsPerGroup);
      const omittedCodes = codes.length - shownCodes.length;
      let entry = `${file}: ${shownCodes.join(', ')}`;
      if (omittedCodes > 0) entry += ` +${omittedCodes} more`;

      // Append first error message as human-readable context
      const firstMsg = eList[0]?.message;
      if (firstMsg) entry += ` — ${firstMsg.slice(0, 80)}`;
      result.push(truncateLine(entry, maxLineLength));
    }

    if (omittedFiles > 0) result.push(`... +${omittedFiles} more files`);
    return result;
  }

  // No grouping — flat list
  let flat = errors.map(e => `${e.file}:${e.line} ${e.code}: ${e.message}`);
  if (useDedup) flat = [...new Set(flat)];
  const truncated = useTruncation ? flat.slice(0, maxFailures) : flat;
  const omitted   = flat.length - truncated.length;
  const result    = truncated.map(l => truncateLine(l, maxLineLength));
  if (omitted > 0) result.push(`... +${omitted} more errors`);
  return result;
}
