/**
 * lib/team-coordinator.js — Team session lifecycle management
 *
 * Manages the state record for Claude Code Team model sessions.
 * The actual TeamCreate/SendMessage tool calls happen inside Claude agent
 * prompts — this module records what was created and provides helpers
 * for naming, budget calculation, and Option D mode decisions.
 *
 * All functions: try/catch, return null on error, never throw.
 */

import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { writeTeamSession, readTeamSession, clearTeamSession } from './state.js';

export { writeTeamSession, readTeamSession, clearTeamSession };

// ── Team Session Active Check ──────────────────────────────────────────────────

/**
 * Returns true if there is an active (non-stale, non-cleared) team session.
 * Sessions older than 2 hours are considered stale.
 * @returns {boolean}
 */
export function isTeamSessionActive() {
  try {
    const session = readTeamSession();
    if (!session || session.cleared || session.status !== 'active') return false;
    // Stale check: >2 hours old
    if (session.startedAt) {
      const ageMs = Date.now() - new Date(session.startedAt).getTime();
      if (ageMs > 2 * 60 * 60 * 1000) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ── Name Generation ───────────────────────────────────────────────────────────

/**
 * Generate a deterministic, filesystem-safe team name for phase execution.
 * Format: tw-phase-{phase}-{waveIndex}-{ts} (under 40 chars)
 * @param {number} phase
 * @param {number} waveIndex
 * @returns {string}
 */
export function generateTeamName(phase, waveIndex) {
  try {
    const ts = Date.now().toString().slice(-8); // last 8 digits
    return `tw-phase-${phase}-${waveIndex}-${ts}`;
  } catch {
    return `tw-phase-0-0-${Date.now().toString().slice(-8)}`;
  }
}

/**
 * Generate a team name for a parallel feature execution.
 * Format: tw-par-{slug}-{ts} (under 40 chars)
 * @param {string} slug  Filesystem-safe feature slug
 * @returns {string}
 */
export function generateParallelTeamName(slug) {
  try {
    const safeSlug = slug.replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 18);
    const ts = Date.now().toString().slice(-8);
    return `tw-par-${safeSlug}-${ts}`;
  } catch {
    return `tw-par-feature-${Date.now().toString().slice(-8)}`;
  }
}

// ── Worker Naming ─────────────────────────────────────────────────────────────

/**
 * Map an array of plan IDs to canonical worker names.
 * PLAN-1-2 → tw-executor-plan-1-2
 * @param {string[]} planIds
 * @returns {string[]}
 */
export function getWorkerNamesForWave(planIds) {
  try {
    return planIds.map(id => `tw-executor-${id.toLowerCase().replace(/_/g, '-')}`);
  } catch {
    return [];
  }
}

// ── Team Config Reader ─────────────────────────────────────────────────────────

/**
 * Read the Claude Code team config file for a named team.
 * Located at ~/.claude/teams/{teamName}/config.json
 * @param {string} teamName
 * @returns {{ members: Array }|null}
 */
export function readTeamConfig(teamName) {
  try {
    const configPath = join(homedir(), '.claude', 'teams', teamName, 'config.json');
    if (!existsSync(configPath)) return null;
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

// ── Worker Health Tracking ─────────────────────────────────────────────────────

/**
 * Return a copy of teamSession with lastSeen[workerName] updated to now.
 * Call whenever any message (STARTED, HEARTBEAT, DONE, BLOCKED, BUDGET_LOW) is
 * received from a worker. Caller must writeTeamSession with the returned value.
 * @param {object} teamSession  Current session data from readTeamSession()
 * @param {string} workerName
 * @returns {object} Updated session (shallow copy)
 */
export function updateWorkerLastSeen(teamSession, workerName) {
  try {
    const session = { ...teamSession };
    if (!session.workerLastSeen) session.workerLastSeen = {};
    session.workerLastSeen = { ...session.workerLastSeen, [workerName]: new Date().toISOString() };
    return session;
  } catch {
    return teamSession;
  }
}

/**
 * Return names of workers that have been silent longer than thresholdMs.
 * Only considers workers whose plan is still in activePlans (not completed/failed).
 * A worker is "stale" if:
 *   - No message was ever received AND the team session is older than thresholdMs, OR
 *   - Their lastSeen timestamp is older than thresholdMs
 * @param {object} teamSession
 * @param {number} [thresholdMs=900000]  15 minutes
 * @returns {string[]}
 */
export function getStaleWorkers(teamSession, thresholdMs = 15 * 60 * 1000) {
  try {
    if (!teamSession || !teamSession.workerNames) return [];
    const now = Date.now();
    const completedSet = new Set(teamSession.completedPlans ?? []);
    const failedSet = new Set(teamSession.failedPlans ?? []);

    return (teamSession.workerNames ?? []).filter(workerName => {
      // Derive the plan ID from the worker name (tw-executor-plan-n-m → PLAN-N-M)
      const planId = workerName
        .replace(/^tw-executor-/, '')
        .toUpperCase()
        .replace(/-(\d)/g, (_, d) => `-${d}`);
      if (completedSet.has(planId) || failedSet.has(planId)) return false;

      const lastSeen = teamSession.workerLastSeen?.[workerName];
      if (!lastSeen) {
        // Never heard from this worker — stale if team session itself is old enough
        const sessionAge = now - new Date(teamSession.startedAt ?? Date.now()).getTime();
        return sessionAge > thresholdMs;
      }
      return now - new Date(lastSeen).getTime() > thresholdMs;
    });
  } catch {
    return [];
  }
}

// ── Budget Calculation ─────────────────────────────────────────────────────────

/**
 * Calculate per-worker budget allocation.
 * Reserves 40% for orchestrator + future waves, splits remaining across workers.
 * Minimum 50K per worker to avoid starvation.
 * @param {number} remainingBudget  Tokens remaining in session
 * @param {number} numWorkers
 * @returns {number}
 */
export function calcWorkerBudget(remainingBudget, numWorkers) {
  try {
    const n = Math.max(1, numWorkers);
    const allocated = Math.floor(remainingBudget * 0.6 / n);
    return Math.max(allocated, 50_000);
  } catch {
    return 50_000;
  }
}

// ── Tier-Based Worker Limits ───────────────────────────────────────────────────

/**
 * Maximum parallel workers for a given skill tier.
 * @param {string} tier  'beginner' | 'advanced' | 'ninja'
 * @returns {number}
 */
export function getMaxWorkersForTier(tier) {
  const limits = { ninja: 5, advanced: 3, beginner: 2 };
  return limits[tier] ?? 3;
}

// ── Option D: Team Mode Decision ───────────────────────────────────────────────

/**
 * Decide whether to use Team model for a given wave.
 *
 * Option D hybrid logic:
 *   - Explicit flags (forceTeam / forceNoTeam) always win
 *   - Project setting 'legacy' or 'team' applies next
 *   - 'auto' applies four conditions: planCount, budget%, waveEst, tier
 *
 * @param {object} opts
 * @param {number}  opts.planCount           Plans in this wave
 * @param {number}  opts.remainingBudget     Tokens remaining
 * @param {number}  opts.sessionBudget       Total session budget
 * @param {number}  opts.waveBudgetEst       Sum of plan token estimates for wave
 * @param {string}  opts.teamModeSetting     'legacy' | 'auto' | 'team'
 * @param {string}  opts.tier               'beginner' | 'advanced' | 'ninja'
 * @param {boolean} opts.forceTeam          --team flag present
 * @param {boolean} opts.forceNoTeam        --no-team flag present
 * @returns {boolean}
 */
export function shouldUseTeamMode({
  planCount = 1,
  remainingBudget = 0,
  sessionBudget = 800_000,
  waveBudgetEst = 0,
  teamModeSetting = 'legacy',
  tier = 'advanced',
  forceTeam = false,
  forceNoTeam = false
} = {}) {
  try {
    // Explicit overrides always win
    if (forceNoTeam) return false;
    if (forceTeam) {
      // Safety floor: don't use team if less than 10% budget remains
      return remainingBudget >= sessionBudget * 0.10;
    }

    // Project-level setting
    if (teamModeSetting === 'legacy') return false;
    if (teamModeSetting === 'team') {
      return remainingBudget >= sessionBudget * 0.10;
    }

    // Auto mode: all four conditions must pass
    const budgetPct = remainingBudget / sessionBudget;
    return (
      planCount >= 2 &&
      budgetPct >= 0.30 &&
      waveBudgetEst <= remainingBudget * 0.50 &&
      getMaxWorkersForTier(tier) >= 2
    );
  } catch {
    return false;
  }
}
