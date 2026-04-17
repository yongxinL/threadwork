/**
 * lib/state.js — Deterministic state management
 *
 * Pure JS file I/O over .threadwork/state/*.json.
 * No spawning processes, no Claude involvement.
 * All functions synchronous or async file operations only.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const STATE_VERSION = '1';

/** @returns {string} Absolute path to .threadwork/state */
function stateDir() {
  return join(process.cwd(), '.threadwork', 'state');
}

/** @returns {string} Absolute path to a state file */
function statePath(filename) {
  return join(stateDir(), filename);
}

/**
 * Ensure the .threadwork/state directory exists.
 */
function ensureStateDir() {
  const dir = stateDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Read and parse a JSON state file. Returns null if file does not exist.
 * @param {string} filename
 * @returns {object|null}
 */
function readJson(filename) {
  const p = statePath(filename);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    throw new Error(`Corrupted state file: ${p}. Delete it and run 'threadwork init' again.`);
  }
}

/**
 * Write a JSON state file with version + timestamp metadata.
 * @param {string} filename
 * @param {object} data
 */
function writeJson(filename, data) {
  ensureStateDir();
  const payload = {
    _version: STATE_VERSION,
    _updated: new Date().toISOString(),
    ...data
  };
  writeFileSync(statePath(filename), JSON.stringify(payload, null, 2), 'utf8');
}

// ── Project State ──────────────────────────────────────────────────────────────

/**
 * Read the top-level project state (project.json).
 * @returns {object}
 */
export function readState() {
  const state = readJson('project.json');
  if (!state) {
    throw new Error(
      "Cannot find .threadwork/state/project.json — run 'threadwork init' first."
    );
  }
  return state;
}

/**
 * Write the top-level project state.
 * @param {object} data
 */
export function writeState(data) {
  writeJson('project.json', data);
}

// ── Phase & Milestone ──────────────────────────────────────────────────────────

/** @returns {number} Current phase number */
export function getPhase() {
  return readState().currentPhase ?? 0;
}

/** @param {number} n Phase number */
export function setPhase(n) {
  const state = readState();
  state.currentPhase = n;
  writeState(state);
}

/** @returns {number} Current milestone number */
export function getMilestone() {
  return readState().currentMilestone ?? 0;
}

/** @param {number} n Milestone number */
export function setMilestone(n) {
  const state = readState();
  state.currentMilestone = n;
  writeState(state);
}

// ── Task Tracking ──────────────────────────────────────────────────────────────

/**
 * Append a task ID to the completed tasks log.
 * @param {string} taskId
 */
export function addCompletedTask(taskId) {
  const existing = readJson('completed-tasks.json') ?? { tasks: [] };
  existing.tasks.push({ id: taskId, completedAt: new Date().toISOString() });
  writeJson('completed-tasks.json', existing);
}

/**
 * Set the currently executing task.
 * @param {string} taskId
 * @param {string} planId
 */
export function setActiveTask(taskId, planId) {
  writeJson('active-task.json', { taskId, planId, startedAt: new Date().toISOString() });
}

/** Clear the active task (call on task completion). */
export function clearActiveTask() {
  writeJson('active-task.json', { taskId: null, planId: null, clearedAt: new Date().toISOString() });
}

// ── Requirements & Roadmap ─────────────────────────────────────────────────────

/**
 * Parse REQUIREMENTS.md and return structured array of requirements.
 * Expects lines like: `- REQ-001: Description`
 * @returns {Array<{id: string, description: string}>}
 */
export function readRequirements() {
  const reqPath = join(process.cwd(), '.threadwork', 'state', 'REQUIREMENTS.md');
  if (!existsSync(reqPath)) {
    throw new Error(
      "Cannot find .threadwork/state/REQUIREMENTS.md — run '/tw:new-project' first."
    );
  }
  const text = readFileSync(reqPath, 'utf8');
  const results = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*[-*]\s+(REQ-\d+):\s+(.+)/);
    if (match) {
      results.push({ id: match[1], description: match[2].trim() });
    }
  }
  return results;
}

/**
 * Parse ROADMAP.md into a milestone/phase/plan hierarchy.
 * @returns {Array<{milestone: number, phases: Array}>}
 */
export function readRoadmap() {
  const roadmapPath = join(process.cwd(), '.threadwork', 'state', 'ROADMAP.md');
  if (!existsSync(roadmapPath)) {
    throw new Error(
      "Cannot find .threadwork/state/ROADMAP.md — run '/tw:new-project' first."
    );
  }
  const text = readFileSync(roadmapPath, 'utf8');
  // Simple structure extraction — headings denote milestones/phases
  const milestones = [];
  let currentMilestone = null;
  for (const line of text.split('\n')) {
    const milestoneMatch = line.match(/^##\s+Milestone\s+(\d+):\s+(.+)/i);
    const phaseMatch = line.match(/^###\s+Phase\s+(\d+):\s+(.+)/i);
    if (milestoneMatch) {
      currentMilestone = { milestone: parseInt(milestoneMatch[1]), title: milestoneMatch[2].trim(), phases: [] };
      milestones.push(currentMilestone);
    } else if (phaseMatch && currentMilestone) {
      currentMilestone.phases.push({ phase: parseInt(phaseMatch[1]), title: phaseMatch[2].trim() });
    }
  }
  return milestones;
}

// ── Plan Files ─────────────────────────────────────────────────────────────────

/**
 * Read and parse a specific XML plan file.
 * Returns raw XML string for downstream parsing.
 * @param {string} planId e.g. "PLAN-1-1"
 * @returns {string}
 */
export function readPlan(planId) {
  const parts = planId.match(/PLAN-(\d+)-/);
  if (!parts) throw new Error(`Invalid plan ID format: ${planId}. Expected PLAN-N-M`);
  const phaseN = parts[1];
  const planPath = join(
    process.cwd(), '.threadwork', 'state', 'phases', `phase-${phaseN}`, 'plans', `${planId}.xml`
  );
  if (!existsSync(planPath)) {
    throw new Error(`Plan file not found: ${planPath}`);
  }
  return readFileSync(planPath, 'utf8');
}

/**
 * List all plan files for a given phase.
 * @param {number} phaseN
 * @returns {string[]} Array of plan IDs
 */
export function listPlans(phaseN) {
  const plansDir = join(process.cwd(), '.threadwork', 'state', 'phases', `phase-${phaseN}`, 'plans');
  if (!existsSync(plansDir)) return [];
  return readdirSync(plansDir)
    .filter(f => f.endsWith('.xml'))
    .map(f => f.replace('.xml', ''));
}

/**
 * Mark a plan as complete in the state.
 * @param {string} planId
 */
export function markPlanComplete(planId) {
  const existing = readJson('completed-plans.json') ?? { plans: [] };
  existing.plans.push({ id: planId, completedAt: new Date().toISOString() });
  writeJson('completed-plans.json', existing);
}

// ── Git Info ──────────────────────────────────────────────────────────────────

/**
 * Returns current git branch, last commit SHA, and list of uncommitted files.
 * @returns {{ branch: string, sha: string, uncommitted: string[] }}
 */
export function getGitInfo() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    const sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const uncommitted = execSync('git status --porcelain', { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map(l => l.slice(3).trim());
    return { branch, sha, uncommitted };
  } catch {
    return { branch: 'unknown', sha: 'unknown', uncommitted: [] };
  }
}

/**
 * Stage all changes and create a commit with the given message.
 * @param {string} message Commit message (conventional commits format)
 */
export function writeAtomicCommit(message) {
  execSync('git add -A', { stdio: 'inherit' });
  execSync(`git commit -m ${JSON.stringify(message)}`, { stdio: 'inherit' });
}

// ── Checkpoint ────────────────────────────────────────────────────────────────

/**
 * Write a recovery checkpoint.
 * @param {object} data
 */
export function writeCheckpoint(data) {
  writeJson('checkpoint.json', data);
}

/** @returns {object|null} */
export function readCheckpoint() {
  return readJson('checkpoint.json');
}

/** Clear the checkpoint after a phase completes cleanly. */
export function clearCheckpoint() {
  writeJson('checkpoint.json', { cleared: true });
}

/** @returns {boolean} */
export function checkpointExists() {
  const cp = readJson('checkpoint.json');
  return cp !== null && !cp.cleared;
}

// ── Decision Logs (v0.2.0) ────────────────────────────────────────────────────

/**
 * Append a decision block to a plan XML file.
 * Creates the <decisions> block if absent. Stages the file (git add) but
 * does NOT commit — the executor includes decisions in its task commit.
 *
 * @param {string} planId   e.g. "PLAN-1-2"
 * @param {string} taskId   e.g. "T-1-2-1"
 * @param {object} decisionData
 * @param {string} decisionData.choice               One sentence
 * @param {string} decisionData.rationale            1–3 sentences
 * @param {string} [decisionData.alternativesConsidered]  One sentence per rejected option
 */
export function appendDecision(planId, taskId, decisionData) {
  const parts = planId.match(/PLAN-(\d+)-/);
  if (!parts) throw new Error(`Invalid plan ID format: ${planId}. Expected PLAN-N-M`);
  const phaseN = parts[1];
  const planPath = join(
    process.cwd(), '.threadwork', 'state', 'phases', `phase-${phaseN}`, 'plans', `${planId}.xml`
  );

  if (!existsSync(planPath)) {
    throw new Error(`Plan file not found: ${planPath}`);
  }

  const xml = readFileSync(planPath, 'utf8');
  const timestamp = new Date().toISOString();
  const { choice, rationale, alternativesConsidered } = decisionData;

  const decisionElement = [
    `    <decision task="${taskId}" timestamp="${timestamp}">`,
    `      <choice>${escapeXml(choice ?? '')}</choice>`,
    `      <rationale>${escapeXml(rationale ?? '')}</rationale>`,
    alternativesConsidered
      ? `      <alternatives-considered>${escapeXml(alternativesConsidered)}</alternatives-considered>`
      : null,
    `    </decision>`
  ].filter(Boolean).join('\n');

  let updatedXml;
  if (xml.includes('<decisions>')) {
    // Append inside existing <decisions> block before </decisions>
    updatedXml = xml.replace('</decisions>', `${decisionElement}\n  </decisions>`);
  } else {
    // Insert <decisions> block before </plan>
    const decisionsBlock = `\n  <decisions>\n${decisionElement}\n  </decisions>\n`;
    updatedXml = xml.replace('</plan>', `${decisionsBlock}</plan>`);
  }

  writeFileSync(planPath, updatedXml, 'utf8');

  // Stage the change (git add) — executor commits with the task
  try {
    execSync(`git add "${planPath}"`, { stdio: 'pipe', cwd: process.cwd() });
  } catch { /* git may not be available in all environments */ }
}

/**
 * Read all decision records from a plan XML file.
 * Returns an empty array for v0.1.x plans without a <decisions> block (backward compat).
 *
 * @param {string} planId
 * @returns {Array<{ taskId: string, timestamp: string, choice: string, rationale: string, alternativesConsidered: string }>}
 */
export function readDecisions(planId) {
  let xml;
  try {
    xml = readPlan(planId);
  } catch {
    return []; // Plan not found — return empty (backward compat)
  }

  if (!xml.includes('<decisions>')) return []; // v0.1.x plan — no decisions block

  const decisions = [];
  const decisionRegex = /<decision task="([^"]*)" timestamp="([^"]*)">([\s\S]*?)<\/decision>/g;
  let match;

  while ((match = decisionRegex.exec(xml)) !== null) {
    const [, taskId, timestamp, body] = match;
    const choice = extractXmlTag(body, 'choice');
    const rationale = extractXmlTag(body, 'rationale');
    const alternativesConsidered = extractXmlTag(body, 'alternatives-considered');
    decisions.push({ taskId, timestamp, choice, rationale, alternativesConsidered });
  }

  return decisions;
}

/**
 * Read all decisions made since a given git commit SHA.
 * Scans all plan XML files modified since that commit, filtered by timestamp.
 *
 * @param {string} sinceCommitSha
 * @returns {Array<{ planId: string, taskId: string, choice: string, rationale: string, timestamp: string }>}
 */
export function readSessionDecisions(sinceCommitSha) {
  if (!sinceCommitSha || sinceCommitSha === 'unknown') return [];

  try {
    // Get plan XML files modified since the given SHA
    const output = execSync(
      `git diff --name-only ${sinceCommitSha}..HEAD -- "*.xml"`,
      { encoding: 'utf8', stdio: 'pipe', cwd: process.cwd() }
    ).trim();

    if (!output) return [];

    const modifiedPlans = output.split('\n').filter(f => f.endsWith('.xml') && f.includes('/plans/'));

    // Get the commit date for sinceCommitSha
    let sinceDate;
    try {
      sinceDate = execSync(
        `git log -1 --format="%ci" ${sinceCommitSha}`,
        { encoding: 'utf8', stdio: 'pipe' }
      ).trim();
    } catch { sinceDate = null; }

    const allDecisions = [];

    for (const planFile of modifiedPlans) {
      const planPath = join(process.cwd(), planFile);
      if (!existsSync(planPath)) continue;

      // Extract plan ID from filename
      const planId = planFile.split('/').pop().replace('.xml', '');

      try {
        const decisions = readDecisions(planId);
        for (const d of decisions) {
          // Filter by timestamp if we have a reference date
          if (sinceDate && d.timestamp < sinceDate) continue;
          allDecisions.push({ planId, ...d });
        }
      } catch { /* skip invalid plans */ }
    }

    return allDecisions.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));
  } catch {
    return [];
  }
}

// ── XML Helpers ───────────────────────────────────────────────────────────────

function escapeXml(str) {
  return (str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function extractXmlTag(str, tag) {
  const match = str.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match ? match[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') : '';
}

// ── Team Session ───────────────────────────────────────────────────────────────

/**
 * Write team session state.
 * @param {object} data
 */
export function writeTeamSession(data) {
  writeJson('team-session.json', data);
}

/** @returns {object|null} */
export function readTeamSession() {
  return readJson('team-session.json');
}

/** Clear the team session after a wave completes. */
export function clearTeamSession() {
  writeJson('team-session.json', { cleared: true });
}

// ── Gap Report (v0.3.2) ────────────────────────────────────────────────────────

/**
 * Append a gap entry to the gap report.
 * Gap entries document capability gaps detected during Ralph Loop iterations.
 * @param {{ type: string, description: string, gate?: string, iteration?: number, sessionId?: string }} entry
 */
export function appendGapReport(entry) {
  ensureStateDir();
  const p = statePath('gap-report.json');
  let data = { _version: STATE_VERSION, _updated: new Date().toISOString(), gaps: [] };
  if (existsSync(p)) {
    try { data = JSON.parse(readFileSync(p, 'utf8')); } catch { /* start fresh */ }
    if (!data.gaps) data.gaps = [];
  }
  data.gaps.push({ ...entry, recordedAt: new Date().toISOString() });
  data._updated = new Date().toISOString();
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Read all gap report entries.
 * @returns {object[]}
 */
export function readGapReport() {
  const p = statePath('gap-report.json');
  if (!existsSync(p)) return [];
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    return data.gaps ?? [];
  } catch { return []; }
}

/**
 * Aggregate gap entries by type and fingerprint, sorted by priority.
 * @returns {{ high: object[], medium: object[], low: object[] }}
 */
export function aggregateGaps() {
  const gaps = readGapReport();
  const counts = {};

  for (const gap of gaps) {
    const key = `${gap.type}:${(gap.description ?? '').slice(0, 50)}`;
    if (!counts[key]) {
      counts[key] = { ...gap, count: 0, firstSeen: gap.recordedAt };
    }
    counts[key].count++;
  }

  const entries = Object.values(counts).sort((a, b) => b.count - a.count);

  const high = entries.filter(e => e.type === 'missing_capability' && e.count >= 3);
  const medium = entries.filter(e => (e.type === 'knowledge_gap' && e.count >= 2) ||
    (e.type === 'missing_capability' && e.count < 3));
  const low = entries.filter(e => e.count === 1 || e.type === 'code_bug');

  return { high, medium, low };
}
