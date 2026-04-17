/**
 * lib/journal.js — Session journal read/write
 *
 * Journals are daily markdown files capturing what happened in each session.
 * Format: .threadwork/workspace/journals/YYYY-MM-DD-N.md
 * Rolling 30-day window; older entries archived to .threadwork/workspace/archive/
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync } from 'fs';
import { join } from 'path';

const ARCHIVE_DAYS = 30;

function journalsDir() {
  return join(process.cwd(), '.threadwork', 'workspace', 'journals');
}

function archiveDir() {
  return join(process.cwd(), '.threadwork', 'workspace', 'archive');
}

function ensureDirs() {
  mkdirSync(journalsDir(), { recursive: true });
  mkdirSync(archiveDir(), { recursive: true });
}

/**
 * Get today's date string in YYYY-MM-DD format.
 * @returns {string}
 */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Get the next available journal filename for today.
 * e.g., 2025-08-01-1.md, 2025-08-01-2.md, ...
 * @returns {string}
 */
function nextJournalFilename() {
  ensureDirs();
  const today = todayStr();
  const existing = readdirSync(journalsDir())
    .filter(f => f.startsWith(today) && f.endsWith('.md'));
  const n = existing.length + 1;
  return `${today}-${n}.md`;
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Write a structured journal entry for the current session.
 * @param {object} sessionData
 * @param {string} sessionData.phase
 * @param {string} sessionData.milestone
 * @param {string[]} sessionData.completedTasks
 * @param {string} sessionData.activeTask
 * @param {string[]} sessionData.keyDecisions
 * @param {string[]} sessionData.filesModified
 * @param {{ estimated: number, actual: number }} sessionData.tokenUsage
 * @param {string} sessionData.nextRecommendedAction
 * @returns {string} Path to written journal file
 */
export function writeJournal(sessionData) {
  ensureDirs();
  const filename = nextJournalFilename();
  const filepath = join(journalsDir(), filename);

  const {
    phase = 'unknown',
    milestone = 'unknown',
    completedTasks = [],
    activeTask = 'none',
    keyDecisions = [],
    filesModified = [],
    tokenUsage = { estimated: 0, actual: 0 },
    nextRecommendedAction = ''
  } = sessionData;

  const now = new Date().toISOString();
  const lines = [
    `# Session Journal — ${now.slice(0, 16).replace('T', ' ')} UTC`,
    '',
    `**Phase**: ${phase} | **Milestone**: ${milestone}`,
    '',
    '## Completed This Session',
    completedTasks.length > 0
      ? completedTasks.map(t => `- ${t}`).join('\n')
      : '_None_',
    '',
    '## In Progress',
    `- ${activeTask}`,
    '',
    '## Key Decisions',
    keyDecisions.length > 0
      ? keyDecisions.map(d => `- ${d}`).join('\n')
      : '_None recorded_',
    '',
    '## Files Modified',
    filesModified.length > 0
      ? filesModified.map(f => `- ${f}`).join('\n')
      : '_None_',
    '',
    '## Token Usage',
    `- Estimated: ${tokenUsage.estimated?.toLocaleString() ?? 0}`,
    `- Actual: ${tokenUsage.actual?.toLocaleString() ?? 0}`,
    '',
    '## Next Recommended Action',
    nextRecommendedAction || '_Not specified_',
    ''
  ];

  writeFileSync(filepath, lines.join('\n'), 'utf8');
  archiveOldJournals();
  return filepath;
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Read the most recent journal file as a string.
 * @returns {string|null}
 */
export function readLatestJournal() {
  if (!existsSync(journalsDir())) return null;
  const files = readdirSync(journalsDir())
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  return readFileSync(join(journalsDir(), files[0]), 'utf8');
}

/**
 * Full-text search across all journal files.
 * @param {string} query Search term
 * @returns {Array<{ file: string, excerpt: string, date: string }>}
 */
export function searchJournals(query) {
  if (!existsSync(journalsDir())) return [];
  const q = query.toLowerCase();
  const results = [];

  const files = readdirSync(journalsDir())
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse();

  for (const file of files) {
    const content = readFileSync(join(journalsDir(), file), 'utf8');
    if (content.toLowerCase().includes(q)) {
      // Extract the line containing the query as excerpt
      const lines = content.split('\n');
      const matchLine = lines.find(l => l.toLowerCase().includes(q)) ?? '';
      results.push({
        file,
        date: file.slice(0, 10),
        excerpt: matchLine.trim().slice(0, 120)
      });
    }
    if (results.length >= 20) break;
  }

  return results;
}

// ── Archiving ─────────────────────────────────────────────────────────────────

/**
 * Move journal files older than ARCHIVE_DAYS to the archive directory.
 */
function archiveOldJournals() {
  if (!existsSync(journalsDir())) return;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - ARCHIVE_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  for (const file of readdirSync(journalsDir())) {
    if (!file.endsWith('.md')) continue;
    const dateStr = file.slice(0, 10);
    if (dateStr < cutoffStr) {
      mkdirSync(archiveDir(), { recursive: true });
      renameSync(join(journalsDir(), file), join(archiveDir(), file));
    }
  }
}
