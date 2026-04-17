/**
 * lib/autonomy.js — Autonomous operation mode controller
 *
 * Manages three autonomy levels (supervised/guided/autonomous) that control
 * how much human intervention the harness requires during execution. Reads
 * the autonomy level from project.json and provides decision functions for
 * hooks and agents.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ── Level constants ───────────────────────────────────────────────────────────

export const LEVELS = {
  SUPERVISED: 'supervised',
  GUIDED: 'guided',
  AUTONOMOUS: 'autonomous'
};

// Operations that are NEVER auto-approved regardless of autonomy level
const SAFETY_RAIL_PATTERNS = [
  /git\s+push/i,
  /gh\s+pr\s+create/i,
  /rm\s+-rf/i,
  /drop\s+table/i,
  /delete\s+from/i,
  /--force/i,
  /security/i,
  /autonomy/i,
  /quality-config/i,
  /budget.*exceed/i
];

// ── Read project state ────────────────────────────────────────────────────────

function readProjectJson() {
  try {
    const p = join(process.cwd(), '.threadwork', 'state', 'project.json');
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Get the current autonomy level from project.json.
 * Defaults to 'supervised' if not set.
 * @returns {"supervised"|"guided"|"autonomous"}
 */
export function getAutonomyLevel() {
  const project = readProjectJson();
  const level = project.autonomyLevel ?? 'supervised';
  if (Object.values(LEVELS).includes(level)) return level;
  return LEVELS.SUPERVISED;
}

/**
 * Get the max retries for the Ralph Loop based on autonomy level.
 * supervised=5, guided=8, autonomous=10
 * @param {"supervised"|"guided"|"autonomous"} level
 * @returns {number}
 */
export function getMaxRetries(level) {
  switch (level) {
    case LEVELS.AUTONOMOUS: return 10;
    case LEVELS.GUIDED: return 8;
    default: return 5;
  }
}

/**
 * Get the auto-accept threshold for spec proposals.
 * supervised=0.7, guided=0.6, autonomous=0.5
 * @param {"supervised"|"guided"|"autonomous"} level
 * @returns {number}
 */
export function getAutoAcceptThreshold(level) {
  switch (level) {
    case LEVELS.AUTONOMOUS: return 0.5;
    case LEVELS.GUIDED: return 0.6;
    default: return 0.7;
  }
}

/**
 * Determine if a plan should be auto-approved (skipping human review).
 * Only true in autonomous mode AND check report passes.
 * @param {"supervised"|"guided"|"autonomous"} level
 * @param {{ passed: boolean, issues: string[] }} [checkReport]
 * @returns {boolean}
 */
export function shouldAutoApprovePlan(level, checkReport) {
  if (level !== LEVELS.AUTONOMOUS) return false;
  // Only auto-approve if plan-checker passed with no critical issues
  return checkReport?.passed === true && (checkReport?.issues ?? []).length === 0;
}

/**
 * Determine if discuss-phase should be auto-filled from previous context.
 * guided: auto-fill from previous CONTEXT.md, only ask new questions
 * autonomous: fully auto-fill, no questions asked
 * @param {"supervised"|"guided"|"autonomous"} level
 * @param {object} [previousContext]
 * @returns {boolean}
 */
export function shouldAutoFillDiscuss(level, previousContext) {
  if (level === LEVELS.AUTONOMOUS) return true;
  if (level === LEVELS.GUIDED && previousContext && Object.keys(previousContext).length > 0) return true;
  return false;
}

/**
 * Determine if manual verification steps should be deferred (not blocking).
 * Only true in autonomous mode.
 * @param {"supervised"|"guided"|"autonomous"} level
 * @returns {boolean}
 */
export function shouldDeferManualVerification(level) {
  return level === LEVELS.AUTONOMOUS;
}

/**
 * Determine if sessions should auto-chain (start next phase without user prompt).
 * Only true in autonomous mode.
 * @param {"supervised"|"guided"|"autonomous"} level
 * @returns {boolean}
 */
export function shouldAutoChainSessions(level) {
  return level === LEVELS.AUTONOMOUS;
}

/**
 * Check if a proposed action is covered by a safety rail.
 * Safety rails are NEVER auto-approved regardless of autonomy level.
 * @param {string} actionDescription
 * @returns {boolean} true if the action hits a safety rail (should NOT auto-approve)
 */
export function isSafetyRail(actionDescription) {
  const desc = actionDescription ?? '';
  return SAFETY_RAIL_PATTERNS.some(pattern => pattern.test(desc));
}

/**
 * Get a human-readable summary of the current autonomy configuration.
 * @returns {string}
 */
export function getAutonomySummary() {
  const level = getAutonomyLevel();
  const retries = getMaxRetries(level);
  const threshold = getAutoAcceptThreshold(level);

  const descriptions = {
    supervised: 'Human approval required for plans, reviews, and phase completions',
    guided: 'Auto-fills discuss-phase from prior context; human approves critical gates',
    autonomous: 'Fully autonomous; auto-approves plans and chains sessions without prompts'
  };

  return [
    `Autonomy: ${level.toUpperCase()}`,
    `  Max retries: ${retries}`,
    `  Auto-accept threshold: ${threshold}`,
    `  ${descriptions[level] ?? ''}`
  ].join('\n');
}
