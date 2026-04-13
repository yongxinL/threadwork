/**
 * lib/token-tracker.js — Token budget management
 *
 * First-class feature. Tracks session token usage, surfaces threshold warnings
 * at 80% and 90%, reports estimation variance per task.
 * All state persisted to .threadwork/state/token-log.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const TOKEN_LOG_VERSION = '1';
const DEFAULT_BUDGET = 800_000;

function tokenLogPath() {
  return join(process.cwd(), '.threadwork', 'state', 'token-log.json');
}

function ensureDir() {
  const dir = join(process.cwd(), '.threadwork', 'state');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readLog() {
  const p = tokenLogPath();
  if (!existsSync(p)) {
    return { _version: TOKEN_LOG_VERSION, sessionBudget: DEFAULT_BUDGET, sessionUsed: 0, tasks: [] };
  }
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { _version: TOKEN_LOG_VERSION, sessionBudget: DEFAULT_BUDGET, sessionUsed: 0, tasks: [] };
  }
}

function writeLog(data) {
  ensureDir();
  writeFileSync(tokenLogPath(), JSON.stringify({
    _version: TOKEN_LOG_VERSION,
    _updated: new Date().toISOString(),
    ...data
  }, null, 2), 'utf8');
}

// ── Estimation ────────────────────────────────────────────────────────────────

/**
 * Rough token estimate from text (chars / 4).
 * No API call needed.
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  return Math.ceil((text ?? '').length / 4);
}

/**
 * Heuristic task budget estimate based on description and phase.
 * @param {string} taskDescription
 * @param {number} [phase=1]
 * @returns {{ low: number, high: number, midpoint: number, complexity: string }}
 */
export function estimateTaskBudget(taskDescription, phase = 1) {
  const desc = (taskDescription ?? '').toLowerCase();
  const wordCount = desc.split(/\s+/).length;

  // Complexity heuristics
  const complexSignals = ['architect', 'refactor', 'migration', 'integration', 'authentication', 'auth', 'database', 'schema', 'multi', 'complex', 'redesign'];
  const simpleSignals = ['add', 'update', 'fix', 'rename', 'move', 'remove', 'delete', 'simple', 'small'];

  const complexScore = complexSignals.filter(s => desc.includes(s)).length;
  const simpleScore = simpleSignals.filter(s => desc.includes(s)).length;

  let complexity, low, high;

  if (complexScore >= 2 || wordCount > 20) {
    complexity = 'complex';
    low = 40_000;
    high = 80_000;
  } else if (simpleScore >= 2 || wordCount < 6) {
    complexity = 'simple';
    low = 5_000;
    high = 15_000;
  } else {
    complexity = 'medium';
    low = 15_000;
    high = 40_000;
  }

  // Planning phases cheaper than execution
  const multiplier = phase <= 1 ? 0.7 : 1.0;
  low = Math.round(low * multiplier);
  high = Math.round(high * multiplier);

  return { low, high, midpoint: Math.round((low + high) / 2), complexity };
}

// ── Budget Tracking ───────────────────────────────────────────────────────────

/**
 * Get the configured session budget (default 800K).
 * @returns {number}
 */
export function getSessionBudget() {
  return readLog().sessionBudget ?? DEFAULT_BUDGET;
}

/**
 * Set the session budget (called at init time with user's choice).
 * @param {number} budget
 */
export function setSessionBudget(budget) {
  const log = readLog();
  log.sessionBudget = budget;
  writeLog(log);
}

/**
 * Get estimated tokens consumed this session.
 * @returns {number}
 */
export function getSessionUsed() {
  return readLog().sessionUsed ?? 0;
}

/**
 * Get tokens remaining in this session.
 * @returns {number}
 */
export function getBudgetRemaining() {
  return Math.max(0, getSessionBudget() - getSessionUsed());
}

/**
 * Get 0–100 integer representing % of budget consumed.
 * @returns {number}
 */
export function getBudgetPercent() {
  const budget = getSessionBudget();
  if (budget === 0) return 100;
  return Math.min(100, Math.round((getSessionUsed() / budget) * 100));
}

/**
 * Check 80%/90% thresholds.
 * @returns {{ warning: boolean, critical: boolean }}
 */
export function checkThresholds() {
  const pct = getBudgetPercent();
  return { warning: pct >= 80, critical: pct >= 90 };
}

/**
 * Returns true if budget is below 20% remaining (trigger pre-task check).
 * @returns {boolean}
 */
export function shouldCheckBudget() {
  return getBudgetPercent() >= 80;
}

/**
 * Returns true if critically low (<10% remaining).
 * @returns {boolean}
 */
export function isOverBudget() {
  return getBudgetPercent() >= 90;
}

// ── Recording & Variance ──────────────────────────────────────────────────────

/**
 * Record token usage for a task. Adds to running session total.
 * @param {string} taskId
 * @param {number} estimatedTokens
 * @param {number} [actualTokens] If not provided, uses estimate as actual
 * @param {string} [model='sonnet'] - 'haiku', 'sonnet', or 'opus'
 */
export function recordUsage(taskId, estimatedTokens, actualTokens, model = 'sonnet') {
  const log = readLog();
  const actual = actualTokens ?? estimatedTokens;
  const estimatedCost = calculateCost(estimatedTokens, model);
  const actualCost = calculateCost(actual, model);
  log.sessionUsed = (log.sessionUsed ?? 0) + actual;
  log.sessionCostUsed = (log.sessionCostUsed ?? 0) + actualCost;
  log.tasks = log.tasks ?? [];
  log.tasks.push({
    id: taskId,
    model,
    estimated: estimatedTokens,
    actual,
    estimatedCost,
    actualCost,
    variance: computeVariancePct(estimatedTokens, actual),
    rating: getVarianceRating(estimatedTokens, actual),
    recordedAt: new Date().toISOString()
  });
  writeLog(log);
}

/**
 * Compute variance percentage string (e.g. "+18%" or "-11%").
 * @param {number} estimated
 * @param {number} actual
 * @returns {string}
 */
function computeVariancePct(estimated, actual) {
  if (estimated === 0) return 'N/A';
  const pct = Math.round(((actual - estimated) / estimated) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

/**
 * Get variance quality rating.
 * @param {number} estimated
 * @param {number} actual
 * @returns {'Excellent' | 'Good' | 'Needs Improvement'}
 */
export function getVarianceRating(estimated, actual) {
  if (estimated === 0) return 'Needs Improvement';
  const absPct = Math.abs(((actual - estimated) / estimated) * 100);
  if (absPct < 10) return 'Excellent';
  if (absPct <= 20) return 'Good';
  return 'Needs Improvement';
}

/**
 * Get full budget and variance report for the current session.
 * @returns {object}
 */
export function getBudgetReport() {
  const log = readLog();
  const budget = log.sessionBudget ?? DEFAULT_BUDGET;
  const used = log.sessionUsed ?? 0;
  const remaining = Math.max(0, budget - used);

  const tasks = (log.tasks ?? []).map(t => ({
    id: t.id,
    model: t.model ?? 'sonnet',
    estimated: t.estimated,
    actual: t.actual,
    variance: t.variance ?? computeVariancePct(t.estimated, t.actual),
    rating: t.rating ?? getVarianceRating(t.estimated, t.actual)
  }));

  const totalEstimated = tasks.reduce((s, t) => s + (t.estimated ?? 0), 0);
  const totalActual = tasks.reduce((s, t) => s + (t.actual ?? 0), 0);

  return {
    session: {
      budget,
      used,
      remaining,
      percent: Math.min(100, Math.round((used / budget) * 100))
    },
    tasks,
    phaseTotal: {
      estimated: totalEstimated,
      actual: totalActual,
      variance: computeVariancePct(totalEstimated, totalActual)
    }
  };
}

/**
 * Format a single-line budget dashboard string for hook injection.
 * @returns {string}
 */
export function formatBudgetDashboard() {
  const report = getBudgetReport();
  const { used, budget, remaining, percent } = report.session;
  const usedK = Math.round(used / 1000);
  const budgetK = Math.round(budget / 1000);
  const remainK = Math.round(remaining / 1000);

  const { warning, critical } = checkThresholds();
  let statusPart = '';
  if (critical) {
    statusPart = ' | 🚨 CRITICAL: >90% consumed — run /tw:done now';
  } else if (warning) {
    statusPart = ' | ⚠️ Warning: >80% consumed';
  }

  const specFetchTotal = getSpecFetchTotal();
  const specFetchBreakdown = getSpecFetchBreakdown();
  const specFetchLine = specFetchTotal > 0
    ? ` | Spec fetches: ${Math.round(specFetchTotal / 1000) || '<1'}K (${specFetchBreakdown.length} fetches)`
    : '';

  return `[TOKEN: ${usedK}K/${budgetK}K used | ${percent}% consumed | ${remainK}K remaining${specFetchLine}${statusPart}]`;
}

/**
 * Reset session usage to zero (call at session start).
 */
export function resetSessionUsage() {
  const log = readLog();
  log.sessionUsed = 0;
  log.sessionCostUsed = 0;
  log.tasks = [];
  log.spec_fetch_tokens = 0;
  log.spec_fetch_log = [];
  writeLog(log);
}

// ── Spec Fetch Tracking (v0.2.0) ─────────────────────────────────────────────

/**
 * Record a spec fetch event.
 * @param {string} specId - e.g. "SPEC:auth-001"
 * @param {number} tokens - Estimated token cost of the fetched content
 */
export function recordSpecFetch(specId, tokens) {
  const log = readLog();
  log.spec_fetch_tokens = (log.spec_fetch_tokens ?? 0) + tokens;
  log.spec_fetch_log = log.spec_fetch_log ?? [];
  log.spec_fetch_log.push({
    specId,
    tokens,
    fetchedAt: new Date().toISOString()
  });
  writeLog(log);
}

/**
 * Get total tokens spent on spec fetches this session.
 * @returns {number}
 */
export function getSpecFetchTotal() {
  return readLog().spec_fetch_tokens ?? 0;
}

/**
 * Get per-fetch breakdown for this session.
 * @returns {Array<{ specId: string, tokens: number, fetchedAt: string }>}
 */
export function getSpecFetchBreakdown() {
  return readLog().spec_fetch_log ?? [];
}

// ── Cost Tracking (v0.3.0) ────────────────────────────────────────────────────

const DEFAULT_PRICING = {
  models: {
    haiku: { input: 0.80, output: 4.00 },
    sonnet: { input: 3.00, output: 15.00 },
    opus: { input: 15.00, output: 75.00 }
  }
};

/**
 * Load pricing table from ~/.threadwork/pricing.json
 * Falls back to hardcoded defaults if file is absent.
 * @returns {Object} pricing table
 */
export function loadPricing() {
  try {
    const pricingPath = process.env.THREADWORK_PRICING_PATH
      ?? join(homedir(), '.threadwork', 'pricing.json');
    if (existsSync(pricingPath)) {
      return JSON.parse(readFileSync(pricingPath, 'utf8'));
    }
  } catch { /* fall through to default */ }
  return DEFAULT_PRICING;
}

/**
 * Calculate estimated cost for a token count and model.
 * Uses 60/40 input/output split as approximation.
 * @param {number} tokens
 * @param {string} model - 'haiku', 'sonnet', or 'opus'
 * @returns {number} estimated cost in USD
 */
export function calculateCost(tokens, model = 'sonnet') {
  const pricing = loadPricing();
  const modelPricing = pricing.models?.[model] ?? pricing.models?.sonnet ?? { input: 3.00, output: 15.00 };
  const inputTokens = tokens * 0.6;
  const outputTokens = tokens * 0.4;
  return (inputTokens * modelPricing.input + outputTokens * modelPricing.output) / 1_000_000;
}

/**
 * Get the configured cost budget (default $5.00).
 * Reads from project.json if available, else returns default.
 * @returns {number} cost budget in USD
 */
export function getCostBudget() {
  try {
    const projectPath = join(process.cwd(), '.threadwork', 'state', 'project.json');
    if (existsSync(projectPath)) {
      const proj = JSON.parse(readFileSync(projectPath, 'utf8'));
      if (typeof proj.cost_budget === 'number') return proj.cost_budget;
    }
  } catch { /* fall through */ }
  return 5.00;
}

/**
 * Get total estimated cost consumed this session.
 * @returns {number} cost in USD
 */
export function getCostUsed() {
  return readLog().sessionCostUsed ?? 0;
}

/**
 * Get remaining cost budget.
 * @returns {number} cost in USD
 */
export function getCostRemaining() {
  return Math.max(0, getCostBudget() - getCostUsed());
}

/**
 * Get cost budget percentage consumed.
 * @returns {number} 0-100
 */
export function getCostPercent() {
  const budget = getCostBudget();
  if (budget === 0) return 100;
  return Math.min(100, Math.round((getCostUsed() / budget) * 100));
}

/**
 * Get full cost+token report for handoff and variance commands.
 * @returns {Object}
 */
export function getDualBudgetReport() {
  const log = readLog();
  const tokenBudget = log.sessionBudget ?? DEFAULT_BUDGET;
  const tokenUsed = log.sessionUsed ?? 0;
  const costBudget = getCostBudget();
  const costUsed = getCostUsed();

  const tasks = (log.tasks ?? []).map(t => ({
    id: t.id,
    model: t.model ?? 'sonnet',
    estimated: t.estimated,
    actual: t.actual,
    estimatedCost: t.estimatedCost ?? calculateCost(t.estimated ?? 0, t.model ?? 'sonnet'),
    actualCost: t.actualCost ?? calculateCost(t.actual ?? 0, t.model ?? 'sonnet'),
    variance: t.variance ?? computeVariancePct(t.estimated, t.actual),
    rating: t.rating ?? getVarianceRating(t.estimated, t.actual)
  }));

  // Aggregate by model tier
  const modelUsage = {};
  for (const t of tasks) {
    const m = t.model ?? 'sonnet';
    if (!modelUsage[m]) modelUsage[m] = { tokens: 0, cost: 0 };
    modelUsage[m].tokens += t.actual ?? 0;
    modelUsage[m].cost += t.actualCost ?? 0;
  }

  return {
    token: {
      budget: tokenBudget,
      used: tokenUsed,
      remaining: Math.max(0, tokenBudget - tokenUsed),
      percent: Math.min(100, Math.round((tokenUsed / tokenBudget) * 100))
    },
    cost: {
      budget: costBudget,
      used: costUsed,
      remaining: Math.max(0, costBudget - costUsed),
      percent: Math.min(100, Math.round((costUsed / costBudget) * 100))
    },
    modelUsage,
    tasks
  };
}

// ── Context Advisory (v0.3.0) ─────────────────────────────────────────────────

/**
 * Get agents that consumed more than 150K tokens this session.
 * Used to surface context advisory when approaching 200K limit.
 * @returns {Array<{ agentType: string, tokens: number }>}
 */
export function getHighContextAgents() {
  const log = readLog();
  const agentMap = {};
  for (const task of (log.tasks ?? [])) {
    // Task IDs include agent type as prefix (e.g. "tw-planner-T-1-1-1" or "tool-Task-...")
    // Match tw- followed by lowercase/hyphen but stop before uppercase (e.g. T-1-1)
    const agentMatch = (task.id ?? '').match(/^(tw-[a-z]+(?:-[a-z]+)*)-[A-Z0-9]/);
    const agentType = agentMatch ? agentMatch[1] : null;
    if (!agentType) continue;
    agentMap[agentType] = (agentMap[agentType] ?? 0) + (task.actual ?? task.estimated ?? 0);
  }
  return Object.entries(agentMap)
    .filter(([, tokens]) => tokens > 150_000)
    .map(([agentType, tokens]) => ({ agentType, tokens }))
    .sort((a, b) => b.tokens - a.tokens);
}
