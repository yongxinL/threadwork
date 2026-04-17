/**
 * lib/model-switcher.js — Model tier management and switch policy enforcement
 *
 * Determines the recommended model tier for a task based on complexity indicators,
 * enforces the configured switch policy, and maintains a session switch log.
 *
 * Switch policies:
 *   auto    — switch automatically, log after the fact
 *   notify  — output warning + 10s countdown (terminal), proceed unless interrupted [default]
 *   approve — output prompt and wait for explicit y/n input
 *
 * Note: requestSwitch() with 'notify' or 'approve' policies requires an interactive
 * terminal (stdin). In tests, set THREADWORK_TEST=1 to skip stdin and auto-approve.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ── Agent defaults ──────────────────────────────────────────────────────────────

const AGENT_DEFAULTS = {
  'tw-planner': 'opus',
  'tw-researcher': 'opus',
  'tw-debugger': 'opus',
  'tw-executor': 'sonnet',
  'tw-verifier': 'sonnet',
  'tw-plan-checker': 'sonnet',
  'tw-dispatch': 'haiku',
  'tw-spec-writer': 'haiku',
  'tw-entropy-collector': 'haiku'
};

// ── Switch log ─────────────────────────────────────────────────────────────────

function switchLogPath() {
  return join(process.cwd(), '.threadwork', 'state', 'model-switch-log.json');
}

function readSwitchLog() {
  const p = switchLogPath();
  if (!existsSync(p)) return { switches: [] };
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { switches: [] };
  }
}

function writeSwitchLog(data) {
  const dir = join(process.cwd(), '.threadwork', 'state');
  mkdirSync(dir, { recursive: true });
  writeFileSync(switchLogPath(), JSON.stringify({
    _updated: new Date().toISOString(),
    ...data
  }, null, 2), 'utf8');
}

// ── Session policy state ────────────────────────────────────────────────────────

let _sessionPolicy = null; // null = read from project.json each time

function getPolicy() {
  if (_sessionPolicy !== null) return _sessionPolicy;
  try {
    const projectPath = join(process.cwd(), '.threadwork', 'state', 'project.json');
    if (existsSync(projectPath)) {
      const proj = JSON.parse(readFileSync(projectPath, 'utf8'));
      return proj.model_switch_policy ?? 'notify';
    }
  } catch { /* fall through */ }
  return 'notify';
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Get the default model for an agent type.
 * @param {string} agentType
 * @returns {'haiku'|'sonnet'|'opus'}
 */
export function getAgentDefault(agentType) {
  return AGENT_DEFAULTS[agentType] ?? 'sonnet';
}

/**
 * Determine the recommended model tier for a task.
 *
 * Priority:
 * 1. If a formal complexity assessment result is provided (from complexity-assessor.js),
 *    use its modelRecommendation directly — this reflects 7-dimension scoring.
 * 2. Otherwise fall back to keyword/agent-type heuristics.
 *
 * @param {string} taskDescription
 * @param {number} fileCount
 * @param {string} agentType - e.g. 'tw-executor', 'tw-debugger'
 * @param {Object} [complexityResult] - Optional result from assessTask()
 * @param {string} complexityResult.modelRecommendation - 'haiku' | 'sonnet' | 'opus'
 * @param {number} [complexityResult.confidence] - 0-100
 * @returns {'haiku'|'sonnet'|'opus'}
 */
export function getRecommendedModel(taskDescription, fileCount = 0, agentType = '', complexityResult = null) {
  // If a formal complexity assessment is available, trust it over keyword heuristics
  if (complexityResult?.modelRecommendation) {
    return complexityResult.modelRecommendation;
  }

  const desc = (taskDescription ?? '').toLowerCase();

  // Complex signals → opus (fallback when no complexity assessment)
  const complexAgents = ['tw-debugger', 'tw-planner', 'tw-researcher'];
  const complexKeywords = ['refactor', 'architecture', 'migrate', 'redesign', 'debug', 'complex'];
  if (fileCount >= 6 || complexAgents.includes(agentType) ||
      complexKeywords.some(k => desc.includes(k))) {
    return 'opus';
  }

  // Simple signals → haiku (fallback when no complexity assessment)
  const simpleAgents = ['tw-dispatch', 'tw-spec-writer', 'tw-entropy-collector'];
  const simpleKeywords = ['add', 'rename', 'move', 'delete', 'simple', 'small'];
  if (simpleAgents.includes(agentType) ||
      (simpleKeywords.some(k => desc.includes(k)) && fileCount <= 2)) {
    return 'haiku';
  }

  // Default → sonnet
  return 'sonnet';
}

/**
 * Request a model switch according to the configured policy.
 * For 'notify': outputs warning and waits 10 seconds (terminal countdown).
 * For 'approve': outputs prompt and waits for explicit 'y'/'n' input.
 * For 'auto': logs and returns approved immediately.
 * In test mode (THREADWORK_TEST=1): always auto-approves.
 * @param {string} fromModel
 * @param {string} toModel
 * @param {string} reason
 * @param {string} [policy] - overrides project.json policy if provided
 * @returns {Promise<{approved: boolean, userOverride: boolean}>}
 */
export async function requestSwitch(fromModel, toModel, reason, policy) {
  const activePolicy = policy ?? getPolicy();

  // Test mode bypass
  if (process.env.THREADWORK_TEST === '1') {
    return { approved: true, userOverride: false };
  }

  if (activePolicy === 'auto') {
    process.stderr.write(
      `[Threadwork] Model switch: ${fromModel} → ${toModel} (${reason})\n`
    );
    return { approved: true, userOverride: false };
  }

  if (activePolicy === 'notify') {
    process.stderr.write(
      `\n[Threadwork] Model switch proposed: ${fromModel} → ${toModel}\n` +
      `Reason: ${reason}\n` +
      `Proceeding in 10 seconds unless you interrupt (Ctrl+C)...\n`
    );
    await new Promise(resolve => setTimeout(resolve, 10_000));
    return { approved: true, userOverride: false };
  }

  if (activePolicy === 'approve') {
    process.stderr.write(
      `\n[Threadwork] Model switch requested: ${fromModel} → ${toModel}\n` +
      `Reason: ${reason}\n` +
      `Approve? [y/N]: `
    );
    return new Promise(resolve => {
      const { createInterface } = require('readline');
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      rl.once('line', (answer) => {
        rl.close();
        const approved = answer.trim().toLowerCase() === 'y';
        resolve({ approved, userOverride: !approved });
      });
    });
  }

  // Unknown policy — default to auto-approve
  return { approved: true, userOverride: false };
}

/**
 * Log a model switch to the session switch log.
 * @param {string} fromModel
 * @param {string} toModel
 * @param {string} taskId
 * @param {string} reason
 * @param {boolean} userOverride - true if user changed the recommendation
 */
export function logSwitch(fromModel, toModel, taskId, reason, userOverride = false) {
  const log = readSwitchLog();
  log.switches.push({
    timestamp: new Date().toISOString(),
    task_id: taskId,
    from: fromModel,
    to: toModel,
    reason,
    policy: getPolicy(),
    user_override: userOverride,
    approved: true
  });
  writeSwitchLog(log);
}

/**
 * Get all model switches this session.
 * @returns {Array}
 */
export function getSwitchLog() {
  return readSwitchLog().switches ?? [];
}

/**
 * Set the switch policy mid-session.
 * Also updates project.json if it exists.
 * @param {'auto'|'notify'|'approve'} policy
 */
export function setSwitchPolicy(policy) {
  const valid = ['auto', 'notify', 'approve'];
  if (!valid.includes(policy)) throw new Error(`Invalid policy: ${policy}. Must be one of: ${valid.join(', ')}`);
  _sessionPolicy = policy;
  try {
    const projectPath = join(process.cwd(), '.threadwork', 'state', 'project.json');
    if (existsSync(projectPath)) {
      const proj = JSON.parse(readFileSync(projectPath, 'utf8'));
      proj.model_switch_policy = policy;
      proj._updated = new Date().toISOString();
      writeFileSync(projectPath, JSON.stringify(proj, null, 2), 'utf8');
    }
  } catch { /* project.json may not exist in tests */ }
}

/**
 * Get agent defaults map (for /tw:model command).
 * @returns {Object}
 */
export function getAgentDefaults() {
  return { ...AGENT_DEFAULTS };
}
