/**
 * lib/logger.js — Centralized structured logger for Threadwork lib/ modules
 *
 * Writes JSONL entries to .threadwork/logs/threadwork.log
 * Same format as hook-log.json so the viewer merges them seamlessly.
 *
 * Hooks use their own inline logHook() for reliability (zero imports).
 * This module is for lib/ code that benefits from structured logging.
 *
 * Usage:
 *   import { log, debug, info, warn, error } from './logger.js';
 *   info('spec-engine', 'Loaded 6 specs', { specIds: ['SPEC:be-001'] });
 *   warn('quality-gate', 'Coverage below threshold', { actual: 72, required: 80 });
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

export const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, WARNING: 2, ERROR: 3 };

function getLogDir(cwd = process.cwd()) {
  return join(cwd, '.threadwork', 'logs');
}

function getLogPath(cwd = process.cwd()) {
  return join(getLogDir(cwd), 'threadwork.log');
}

function getHookLogPath(cwd = process.cwd()) {
  return join(cwd, '.threadwork', 'state', 'hook-log.json');
}

/**
 * Write a structured log entry.
 *
 * @param {'DEBUG'|'INFO'|'WARN'|'ERROR'} level
 * @param {string} component  e.g. 'quality-gate', 'spec-engine', 'harvest'
 * @param {string} message
 * @param {object|null} meta  Optional structured data attached to the entry
 */
export function log(level, component, message, meta = null) {
  try {
    const logDir = getLogDir();
    mkdirSync(logDir, { recursive: true });
    const entry = { timestamp: new Date().toISOString(), level, component, message };
    if (meta !== null && meta !== undefined) entry.meta = meta;
    appendFileSync(getLogPath(), JSON.stringify(entry) + '\n', 'utf8');
  } catch { /* never throw — log failures must not crash the caller */ }
}

/** Convenience shorthands */
export const debug = (component, message, meta) => log('DEBUG', component, message, meta);
export const info  = (component, message, meta) => log('INFO',  component, message, meta);
export const warn  = (component, message, meta) => log('WARN',  component, message, meta);
export const error = (component, message, meta) => log('ERROR', component, message, meta);

// ── Log reading ───────────────────────────────────────────────────────────────

/**
 * Parse JSONL lines from a file; silently skips malformed lines.
 * @param {string} filePath
 * @returns {object[]}
 */
function readJsonlFile(filePath) {
  if (!existsSync(filePath)) return [];
  try {
    return readFileSync(filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

/**
 * Read all log entries from hook-log.json (hooks) and logs/threadwork.log (lib/ modules),
 * merged and sorted by timestamp.
 *
 * @param {{ minLevel?: string, since?: Date|null, tail?: number }} opts
 * @returns {object[]}  Each entry: { timestamp, level, component|hook, message, meta? }
 */
export function readAllLogs(opts = {}) {
  const { minLevel = 'DEBUG', since = null, tail = 0 } = opts;
  const minLevelNum = LEVELS[(minLevel ?? 'DEBUG').toUpperCase()] ?? 0;

  const all = [
    ...readJsonlFile(getHookLogPath()),
    ...readJsonlFile(getLogPath()),
  ];

  all.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));

  const filtered = all.filter(e => {
    const lvl = (e.level ?? 'INFO').toUpperCase();
    if ((LEVELS[lvl] ?? 1) < minLevelNum) return false;
    if (since && new Date(e.timestamp) < since) return false;
    return true;
  });

  return tail > 0 ? filtered.slice(-tail) : filtered;
}
