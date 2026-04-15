/**
 * install/log.js — threadwork log command
 *
 * Reads structured log entries from:
 *   .threadwork/state/hook-log.json   — written by hooks (session-start, pre/post-tool-use, subagent-stop)
 *   .threadwork/logs/threadwork.log   — written by lib/ modules via lib/logger.js
 *
 * Merges both sources, sorts by timestamp, and displays with level-aware formatting.
 *
 * Usage (via bin/threadwork.js):
 *   threadwork log                     Show last 50 INFO+ entries
 *   threadwork log --level warn        Show WARN and ERROR only
 *   threadwork log --level error       Show ERROR only
 *   threadwork log --level debug       Show all levels including DEBUG
 *   threadwork log --tail 100          Show last 100 entries
 *   threadwork log --since 1h          Show entries from the last hour
 *   threadwork log --since 30m         Show entries from the last 30 minutes
 *   threadwork log --follow            Live-tail (polls every 500ms, Ctrl+C to stop)
 *   threadwork log --json              Raw JSONL output (pipe-friendly)
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ── Level ordering ────────────────────────────────────────────────────────────
const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, WARNING: 2, ERROR: 3 };

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const USE_COLOR = process.stdout.isTTY && process.env.NO_COLOR === undefined;

function c(code, text) { return USE_COLOR ? `\x1b[${code}m${text}\x1b[0m` : text; }

const COLOR = {
  dim:    t => c('2', t),
  gray:   t => c('90', t),
  yellow: t => c('33', t),
  red:    t => c('31', t),
  bold:   t => c('1', t),
};

const LEVEL_FMT = {
  DEBUG:   t => COLOR.gray(t),
  INFO:    t => t,
  WARN:    t => COLOR.yellow(t),
  WARNING: t => COLOR.yellow(t),
  ERROR:   t => COLOR.red(COLOR.bold(t)),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse JSONL from a file; silently skips malformed lines.
 */
function readJsonlFile(path) {
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

/**
 * Parse --since argument to a Date.
 * Accepts: "1h", "30m", "2h", or any Date-parseable string.
 */
function parseSince(since) {
  if (!since) return null;
  const match = since.match(/^(\d+)([hm])$/i);
  if (match) {
    const n = parseInt(match[1], 10);
    const ms = match[2].toLowerCase() === 'h' ? n * 3600000 : n * 60000;
    return new Date(Date.now() - ms);
  }
  const d = new Date(since);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Get the display name for a log entry (component for lib/ logs, hook for hook logs).
 */
function getSource(entry) {
  return (entry.component ?? entry.hook ?? 'threadwork').padEnd(18);
}

/**
 * Format a log entry for human-readable terminal output.
 */
function formatEntry(entry) {
  const lvl = (entry.level ?? 'INFO').toUpperCase();
  const fmt = LEVEL_FMT[lvl] ?? (t => t);
  const ts   = COLOR.dim(formatTs(entry.timestamp));
  const levelLabel = lvl === 'WARNING' ? 'WARN' : lvl;
  const level = fmt(levelLabel.padEnd(5));
  const src  = COLOR.dim(getSource(entry));
  const msg  = fmt(entry.message ?? '');
  const meta = entry.meta ? '  ' + COLOR.dim(JSON.stringify(entry.meta)) : '';
  return `${ts}  ${level}  ${src}  ${msg}${meta}`;
}

function formatTs(iso) {
  if (!iso) return '                   ';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  // "2026-04-15 10:23:45" (local time, 19 chars)
  return d.toLocaleString('sv-SE', { hour12: false }).replace('T', ' ').slice(0, 19);
}

// ── Core data loading ─────────────────────────────────────────────────────────

function loadEntries(cwd, minLevelNum, sinceDate) {
  const hookLogPath = join(cwd, '.threadwork', 'state', 'hook-log.json');
  const libLogPath  = join(cwd, '.threadwork', 'logs', 'threadwork.log');

  const all = [...readJsonlFile(hookLogPath), ...readJsonlFile(libLogPath)];
  all.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));

  return all.filter(e => {
    const lvl = (e.level ?? 'INFO').toUpperCase();
    if ((LEVELS[lvl] ?? 1) < minLevelNum) return false;
    if (sinceDate && new Date(e.timestamp) < sinceDate) return false;
    return true;
  });
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runLog(options = {}) {
  const {
    level  = 'info',
    tail,
    follow = false,
    since,
    json:  useJson = false,
  } = options;

  const cwd = process.cwd();

  if (!existsSync(join(cwd, '.threadwork'))) {
    console.log("Threadwork is not initialized in this project. Run 'threadwork init' first.");
    return;
  }

  const minLevelNum = LEVELS[(level ?? 'info').toUpperCase()] ?? 1;
  const sinceDate   = parseSince(since);
  const tailN       = tail ? parseInt(tail, 10) : 50;

  function printEntry(e) {
    console.log(useJson ? JSON.stringify(e) : formatEntry(e));
  }

  // ── Static mode ─────────────────────────────────────────────────────────────
  if (!follow) {
    const entries = loadEntries(cwd, minLevelNum, sinceDate);
    const toShow  = tailN > 0 ? entries.slice(-tailN) : entries;

    if (toShow.length === 0) {
      console.log('No log entries found for the current filter.');
      if (minLevelNum > 0) {
        console.log(`  Tip: use --level debug to see all entries, or --since 1h to widen the time window.`);
      }
      return;
    }

    if (entries.length > tailN && tailN > 0 && !useJson) {
      console.log(COLOR.dim(`(showing last ${tailN} of ${entries.length} matching entries — use --tail N for more)`));
    }

    for (const e of toShow) printEntry(e);
    return;
  }

  // ── Follow mode ──────────────────────────────────────────────────────────────
  let entries = loadEntries(cwd, minLevelNum, sinceDate);
  let shown   = tailN > 0 ? Math.max(0, entries.length - tailN) : 0;

  // Print initial tail
  for (const e of entries.slice(shown)) printEntry(e);
  shown = entries.length;

  if (!useJson) {
    process.stderr.write(COLOR.dim('\nFollowing log — Ctrl+C to stop\n'));
  }

  const interval = setInterval(() => {
    const fresh = loadEntries(cwd, minLevelNum, sinceDate);
    if (fresh.length > shown) {
      for (const e of fresh.slice(shown)) printEntry(e);
      shown = fresh.length;
    }
  }, 500);

  process.on('SIGINT', () => { clearInterval(interval); process.exit(0); });
}
