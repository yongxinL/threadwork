/**
 * lib/knowledge-notes.js — Agent-discovered knowledge capture and lifecycle
 *
 * Manages implementation notes discovered by agents during task execution.
 * Notes are captured via the knowledge_note virtual tool, injected into
 * subsequent sessions, and auto-promoted to spec proposals after surviving
 * two or more sessions.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ── Constants ─────────────────────────────────────────────────────────────────

const SESSIONS_TO_PROMOTE = 2;       // Sessions survived before auto-promote
const PROMOTE_CONFIDENCE = 0.5;      // Confidence for auto-promoted proposals
const NOTES_FILE = 'knowledge-notes.json';

const VALID_CATEGORIES = new Set(['setup', 'api', 'edge_case', 'testing', 'workflow']);

// ── File helpers ──────────────────────────────────────────────────────────────

function notesPath() {
  return join(process.cwd(), '.threadwork', 'state', NOTES_FILE);
}

function ensureStateDir() {
  mkdirSync(join(process.cwd(), '.threadwork', 'state'), { recursive: true });
}

function readNotesFile() {
  const p = notesPath();
  if (!existsSync(p)) return [];
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    return data.notes ?? data ?? [];
  } catch {
    return [];
  }
}

function writeNotesFile(notes) {
  ensureStateDir();
  writeFileSync(notesPath(), JSON.stringify({
    _version: '1',
    _updated: new Date().toISOString(),
    notes
  }, null, 2), 'utf8');
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Add a new knowledge note captured by an agent.
 * @param {{ category: string, scope: string, summary: string, evidence?: string, critical?: boolean }} note
 * @returns {string} noteId
 */
export function addNote(note) {
  const notes = readNotesFile();
  const category = VALID_CATEGORIES.has(note.category) ? note.category : 'workflow';
  const noteId = `KN-${Date.now()}`;

  const newNote = {
    noteId,
    category,
    scope: note.scope ?? '',
    summary: note.summary ?? '',
    evidence: note.evidence ?? '',
    critical: note.critical === true,
    sessionsSurvived: 0,
    capturedAt: new Date().toISOString(),
    promotedAt: null
  };

  notes.push(newNote);
  writeNotesFile(notes);
  return noteId;
}

/**
 * Read all knowledge notes.
 * @returns {object[]}
 */
export function readNotes() {
  return readNotesFile();
}

/**
 * Get notes whose scope matches a given path or directory.
 * Scope is a directory path or glob — notes are included if the given
 * scope starts with the note's scope or vice versa.
 * @param {string} scope File path or directory
 * @returns {object[]}
 */
export function getNotesForScope(scope) {
  const notes = readNotesFile();
  if (!scope) return notes;

  return notes.filter(note => {
    if (!note.scope) return true; // global notes apply everywhere
    const noteScope = note.scope.replace(/\/$/, '');
    const queryScope = scope.replace(/\/$/, '');
    if (noteScope === '') return true;

    // Handle glob patterns in note scope (e.g. "src/lib/**")
    if (noteScope.includes('*')) {
      const base = noteScope.split('*')[0].replace(/\/$/, '');
      return !base || queryScope.startsWith(base);
    }

    return queryScope.startsWith(noteScope) ||
      noteScope.startsWith(queryScope) ||
      queryScope.includes(noteScope) ||
      noteScope.includes(queryScope);
  });
}

/**
 * Get notes marked as critical.
 * @returns {object[]}
 */
export function getCriticalNotes() {
  return readNotesFile().filter(n => n.critical === true);
}

/**
 * Increment the sessionsSurvived counter on all existing notes.
 * Called at session start.
 */
export function incrementSessionsSurvived() {
  const notes = readNotesFile();
  let changed = false;
  for (const note of notes) {
    if (note.promotedAt) continue; // Already promoted
    note.sessionsSurvived = (note.sessionsSurvived ?? 0) + 1;
    changed = true;
  }
  if (changed) writeNotesFile(notes);
}

/**
 * Promote eligible notes to spec proposals.
 * Notes with sessionsSurvived >= SESSIONS_TO_PROMOTE are promoted at confidence 0.5.
 * Requires spec-engine for proposal writing — handled via dynamic import.
 * @returns {number} Number of notes promoted
 */
export async function promoteEligibleNotes() {
  const notes = readNotesFile();
  const promotedNotes = [];

  const eligible = notes.filter(n =>
    !n.promotedAt &&
    (n.sessionsSurvived ?? 0) >= SESSIONS_TO_PROMOTE
  );

  if (eligible.length === 0) return [];

  try {
    const { proposeSpecUpdate } = await import('./spec-engine.js');

    for (const note of eligible) {
      try {
        const domain = categoryToDomain(note.category);
        const specName = `${domain}/knowledge-${note.noteId.toLowerCase()}`;
        const content = buildProposalContent(note);

        proposeSpecUpdate(specName, content, `Auto-promoted knowledge note: ${note.summary}`, {
          source: 'knowledge-note',
          learningSignal: `kn-promote:${note.noteId}`,
          initialConfidence: PROMOTE_CONFIDENCE
        });

        note.promotedAt = new Date().toISOString();
        promotedNotes.push(note);
      } catch { /* never crash */ }
    }
  } catch { /* spec-engine not available */ }

  if (promotedNotes.length > 0) writeNotesFile(notes);
  return promotedNotes;
}

/**
 * Build a formatted block of knowledge notes for inclusion in the routing map.
 * Filters by scope, shows critical notes first.
 * @param {string} [scope] Optional scope filter
 * @returns {string}
 */
export function buildKnowledgeNotesBlock(scope) {
  const allNotes = readNotesFile();
  // Critical notes always appear regardless of scope
  const critical = allNotes.filter(n => n.critical);
  const scopeNotes = scope ? getNotesForScope(scope) : allNotes;
  const regular = scopeNotes.filter(n => !n.critical);

  if (critical.length === 0 && regular.length === 0) return '';

  const lines = [];

  if (critical.length > 0) {
    lines.push('Implementation notes for this scope:');
    for (const note of critical.slice(0, 5)) {
      const date = note.capturedAt ? note.capturedAt.slice(0, 10) : 'unknown';
      lines.push(`  ⚠ [${note.noteId}${note.scope ? ' ' + note.scope : ''}] — ${note.summary} (verified ${date})`);
    }
  }

  if (regular.length > 0 && lines.length === 0) {
    lines.push('Implementation notes for this scope:');
    for (const note of regular.slice(0, 3)) {
      lines.push(`  ℹ [${note.noteId}] — ${note.summary}`);
    }
  }

  return lines.join('\n');
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function categoryToDomain(category) {
  switch (category) {
    case 'setup': return 'backend';
    case 'api': return 'backend';
    case 'edge_case': return 'testing';
    case 'testing': return 'testing';
    case 'workflow': return 'backend';
    default: return 'backend';
  }
}

function buildProposalContent(note) {
  return [
    `# Knowledge Note: ${note.summary}`,
    '',
    `**Category**: ${note.category}`,
    `**Scope**: ${note.scope || 'global'}`,
    `**Survived**: ${note.sessionsSurvived} sessions`,
    '',
    `## Summary`,
    note.summary,
    '',
    note.evidence ? `## Evidence\n${note.evidence}` : ''
  ].filter(l => l !== undefined).join('\n');
}
