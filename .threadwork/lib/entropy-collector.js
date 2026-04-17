/**
 * lib/entropy-collector.js — Wave-level entropy collection support
 *
 * Supports the tw-entropy-collector background agent.
 * Handles: wave-completion detection, git diff extraction,
 * taste invariant loading, entropy report management.
 *
 * The entropy collector scans for cross-output inconsistencies that
 * pass individual quality gates but degrade when accumulated across waves.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

function stateDir() {
  return join(process.cwd(), '.threadwork', 'state');
}

function phasesDir() {
  return join(stateDir(), 'phases');
}

function phaseDir(phaseId) {
  return join(phasesDir(), `phase-${phaseId}`);
}

function entropyReportPath(waveId, phaseId) {
  return join(phaseDir(phaseId), `entropy-report-wave-${waveId}.json`);
}

function specsDir() {
  return join(process.cwd(), '.threadwork', 'specs');
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

// ── Wave Completion Detection ──────────────────────────────────────────────────

/**
 * Check if all tasks in the current wave are DONE or SKIPPED.
 * Reads the execution-log.json for the given phase.
 *
 * @param {object} executionLog - Parsed execution-log.json content
 * @returns {boolean}
 */
export function isWaveComplete(executionLog) {
  if (!executionLog || !executionLog.tasks) return false;
  const tasks = executionLog.tasks ?? [];
  if (tasks.length === 0) return false;
  return tasks.every(t => t.status === 'DONE' || t.status === 'SKIPPED');
}

/**
 * Read the execution log for a given phase.
 * @param {number|string} phaseId
 * @returns {object|null}
 */
export function readExecutionLog(phaseId) {
  const logPath = join(phaseDir(phaseId), 'execution-log.json');
  if (!existsSync(logPath)) return null;
  try { return JSON.parse(readFileSync(logPath, 'utf8')); } catch { return null; }
}

// ── Git Diff Extraction ────────────────────────────────────────────────────────

/**
 * Get the git diff of all files changed in a specific wave.
 * Uses the wave's start/end commits from the execution log, or falls back to HEAD diff.
 *
 * @param {number|string} waveId
 * @param {number|string} phaseId
 * @returns {string} Git diff output (empty string if unavailable)
 */
export function getWaveDiff(waveId, phaseId) {
  try {
    const execLog = readExecutionLog(phaseId);
    const waveMeta = execLog?.waves?.[`wave-${waveId}`];

    if (waveMeta?.startSha && waveMeta?.endSha) {
      return execSync(
        `git diff ${waveMeta.startSha}..${waveMeta.endSha}`,
        { encoding: 'utf8', stdio: 'pipe' }
      ).trim();
    }

    // Fallback: diff against the last 10 commits
    return execSync(
      'git diff HEAD~10..HEAD --stat',
      { encoding: 'utf8', stdio: 'pipe' }
    ).trim();
  } catch {
    return '';
  }
}

/**
 * Get list of files changed in a wave (file paths only, not diff content).
 * @param {number|string} waveId
 * @param {number|string} phaseId
 * @returns {string[]}
 */
export function getWaveChangedFiles(waveId, phaseId) {
  try {
    const execLog = readExecutionLog(phaseId);
    const waveMeta = execLog?.waves?.[`wave-${waveId}`];

    if (waveMeta?.startSha && waveMeta?.endSha) {
      return execSync(
        `git diff --name-only ${waveMeta.startSha}..${waveMeta.endSha}`,
        { encoding: 'utf8', stdio: 'pipe' }
      ).trim().split('\n').filter(Boolean);
    }

    return execSync(
      'git diff --name-only HEAD~10..HEAD',
      { encoding: 'utf8', stdio: 'pipe' }
    ).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// ── Taste Invariants ──────────────────────────────────────────────────────────

/**
 * Load all spec files tagged as taste-invariant in their frontmatter.
 * These are the standards used by the entropy collector for comparison.
 *
 * @returns {Array<{ domain: string, name: string, content: string }>}
 */
export function loadTasteInvariants() {
  const invariants = [];

  for (const domain of ['frontend', 'backend', 'testing']) {
    const dir = join(specsDir(), domain);
    if (!existsSync(dir)) continue;

    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      try {
        const filePath = join(dir, file);
        const content = readFileSync(filePath, 'utf8');

        // Simple frontmatter parse — check for taste_invariant or taste-invariant tag
        const isTasteInvariant =
          content.includes('taste_invariant: true') ||
          content.includes('taste-invariant: true') ||
          content.includes('taste_invariant:true') ||
          (content.includes('tags:') && content.includes('taste-invariant'));

        if (isTasteInvariant) {
          invariants.push({ domain, name: file.replace('.md', ''), content });
        }
      } catch { /* skip malformed */ }
    }
  }

  return invariants;
}

// ── Entropy Report ─────────────────────────────────────────────────────────────

/**
 * Write an entropy report for a completed wave.
 * @param {number|string} waveId
 * @param {number|string} phaseId
 * @param {object} report - The entropy report data
 */
export function writeEntropyReport(waveId, phaseId, report) {
  ensureDir(phaseDir(phaseId));
  const fullReport = {
    wave: waveId,
    phase: phaseId,
    timestamp: new Date().toISOString(),
    ...report
  };
  writeFileSync(entropyReportPath(waveId, phaseId), JSON.stringify(fullReport, null, 2), 'utf8');
}

/**
 * Read a specific entropy report.
 * @param {number|string} waveId
 * @param {number|string} phaseId
 * @returns {object|null}
 */
export function readEntropyReport(waveId, phaseId) {
  const p = entropyReportPath(waveId, phaseId);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/**
 * List all entropy reports for a phase, sorted by wave number.
 * @param {number|string} phaseId
 * @returns {Array<{ waveId: string, path: string, summary: object }>}
 */
export function listEntropyReports(phaseId) {
  const dir = phaseDir(phaseId);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter(f => f.startsWith('entropy-report-wave-') && f.endsWith('.json'))
    .sort()
    .map(f => {
      const waveId = f.replace('entropy-report-wave-', '').replace('.json', '');
      const path = join(dir, f);
      let summary = { wave: waveId };
      try {
        const data = JSON.parse(readFileSync(path, 'utf8'));
        summary = {
          wave: data.wave ?? waveId,
          issuesCount: data.issues?.length ?? 0,
          autoFixed: data.auto_fixed ?? 0,
          queuedForNextWave: data.queued_for_next_wave ?? 0,
          timestamp: data.timestamp
        };
      } catch { /* use default summary */ }
      return { waveId, path, summary };
    });
}

/**
 * Get a brief summary of an entropy report.
 * @param {number|string} waveId
 * @param {number|string} phaseId
 * @returns {{ issues_count: number, auto_fixed: number, queued: number } | null}
 */
export function getEntropyReportSummary(waveId, phaseId) {
  const report = readEntropyReport(waveId, phaseId);
  if (!report) return null;
  return {
    issues_count: report.issues?.length ?? 0,
    auto_fixed: report.auto_fixed ?? 0,
    queued: report.queued_for_next_wave ?? 0
  };
}
