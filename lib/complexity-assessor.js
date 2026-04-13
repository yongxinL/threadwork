/**
 * lib/complexity-assessor.js — 7-dimension task complexity scoring
 *
 * Assesses coding task complexity across 7 dimensions to produce a
 * SIMPLE / STANDARD / COMPLEX tier, confidence score, and model recommendation.
 *
 * Used to drive model tier selection (Haiku / Sonnet / Opus) and to enrich
 * plan XML with structured complexity data.
 *
 * Dimension scores (1-3 each, max 21):
 *   7-11  → SIMPLE  → Haiku
 *   12-16 → STANDARD → Sonnet
 *   17-21 → COMPLEX → Opus
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ── Risk multipliers ───────────────────────────────────────────────────────────

const MULTIPLIERS = {
  'security-sensitive': 1.2,  // Auth, encryption, user data, API keys
  'data-migration':     1.3,  // Schema changes, data transformations
  'breaking-changes':   1.2,  // API changes, deprecated features
  'technical-debt':     1.1,  // Legacy/poorly-tested code
  'time-pressure':      1.1   // Urgent deadline, reduced review time
};

// ── Tier → model mapping ───────────────────────────────────────────────────────

const TIER_MODEL = {
  'SIMPLE':   'haiku',
  'STANDARD': 'sonnet',
  'COMPLEX':  'opus'
};

// ── Confidence thresholds ───────────────────────────────────────────────────────

const CONFIDENCE_HIGH   = 80;
const CONFIDENCE_MEDIUM = 60;
const CONFIDENCE_LOW    = 50;

// ── Dimension definitions ─────────────────────────────────────────────────────

/**
 * @typedef {Object} DimensionScore
 * @property {number} score - 1, 2, or 3
 * @property {string} rationale - Why this score was assigned
 */

/**
 * @typedef {Object} Multipliers
 * @property {string[]} applied - Names of multipliers that fired
 * @property {number} adjustedScore - Score after applying highest multiplier
 */

/**
 * @typedef {Object} IntegrationHints
 * @property {string} githubArtifact - 'single_issue' | 'epic_with_sub_issues' | 'epic_with_sub_issues_and_project'
 * @property {number} contextBranchBudget - Token budget for this tier
 * @property {boolean} worktreeRecommended
 * @property {string[]} parallelizationPotential - Which subtasks can run in parallel
 */

/**
 * @typedef {Object} ComplexityResult
 * @property {'SIMPLE'|'STANDARD'|'COMPLEX'} tier
 * @property {number} score - Base score (7-21)
 * @property {number} adjustedScore - After multipliers
 * @property {number} confidence - 0-100
 * @property {string} confidenceJustification
 * @property {string} modelRecommendation - 'haiku' | 'sonnet' | 'opus'
 * @property {{ [key: string]: DimensionScore }} dimensions
 * @property {Multipliers} multipliers
 * @property {IntegrationHints} integrationHints
 * @property {string[]} decompositionSuggestions - Subtask descriptions if COMPLEX
 */

// ── Core scoring functions ─────────────────────────────────────────────────────

/**
 * Score the Scope dimension (how many files are touched).
 * @param {number} fileCount
 * @param {string} description
 * @returns {DimensionScore}
 */
function scoreScope(fileCount, description) {
  const desc = (description ?? '').toLowerCase();
  if (fileCount <= 2) {
    return { score: 1, rationale: '1-2 files, localized change' };
  }
  if (fileCount <= 10) {
    // Check if cross-cutting
    if (desc.includes('middleware') || desc.includes('shared') || desc.includes('common')) {
      return { score: 2, rationale: `${fileCount} files, cross-cutting concern` };
    }
    return { score: 2, rationale: `${fileCount} files, multiple components` };
  }
  return { score: 3, rationale: `${fileCount} files, system-wide architectural change` };
}

/**
 * Score the Integration dimension (external dependencies).
 * @param {string} description
 * @returns {DimensionScore}
 */
function scoreIntegration(description) {
  const desc = (description ?? '').toLowerCase();
  const apiSignals = [
    'api', 'http', 'fetch', 'axios', 'graphql', 'grpc',
    'oauth', 'saml', 'webhook', 'webSocket', 'socket',
    'third-party', 'external', 'integration'
  ];
  const count = apiSignals.filter(s => desc.includes(s)).length;
  if (count === 0) {
    return { score: 1, rationale: 'Self-contained, no external calls' };
  }
  if (count <= 2) {
    return { score: 2, rationale: '1-2 external APIs or services' };
  }
  return { score: 3, rationale: `${count} external integrations, complex orchestration` };
}

/**
 * Score the Infrastructure dimension (config/infra changes).
 * @param {string} description
 * @param {string[]} files
 * @returns {DimensionScore}
 */
function scoreInfrastructure(description, files = []) {
  const desc = (description ?? '').toLowerCase();
  const infraFiles = files.filter(f =>
    /(docker|dockerfile|\.env|docker-compose|k8s|kubernetes|terraform|ansible|cloudformation|\.tf|\.yml$|\.yaml$)/.test(f)
  );
  const dbFiles = files.filter(f =>
    /(migration|schema|seeds|mongo|postgres|mysql|redis|database|\.sql$)/.test(f)
  );
  if (infraFiles.length > 0 || dbFiles.length > 0) {
    return { score: 3, rationale: 'Database or infrastructure (Docker/K8s) changes required' };
  }
  if (desc.includes('config') || desc.includes('env') || desc.includes('feature flag') ||
      desc.includes('environment') || desc.includes('settings')) {
    return { score: 2, rationale: 'Configuration or environment changes' };
  }
  return { score: 1, rationale: 'Code-only change, no infra impact' };
}

/**
 * Score the Knowledge dimension (domain expertise required).
 * @param {string} description
 * @param {string[]} files
 * @returns {DimensionScore}
 */
function scoreKnowledge(description, files = []) {
  const desc = (description ?? '').toLowerCase();
  const deepExpertise = [
    'security', 'cryptograph', 'encrypt', 'oauth', 'saml', 'kerberos',
    'payment', 'stripe', 'billing', 'compliance', 'gdpr', 'hipaa',
    'performance', 'optimization', 'caching', 'sharding',
    'distributed', 'consensus', 'raft', 'paxos'
  ];
  const research = [
    ' unfamiliar ', 'new library', 'new api', 'research',
    'evaluate', 'compare', 'investigate', 'prototype'
  ];
  if (deepExpertise.some(s => desc.includes(s))) {
    return { score: 3, rationale: 'Deep expertise required: security/compliance/performance' };
  }
  if (research.some(s => desc.includes(s))) {
    return { score: 2, rationale: 'Research needed: unfamiliar library or domain' };
  }
  // Check if files are in unfamiliar directories
  const unfamiliarDirs = ['/legacy/', '/vendor/', '/node_modules/'];
  const hasUnfamiliar = files.some(f => unfamiliarDirs.some(d => f.includes(d)));
  if (hasUnfamiliar) {
    return { score: 2, rationale: 'Touching legacy or vendor code, may need research' };
  }
  return { score: 1, rationale: 'Familiar patterns, well-known conventions' };
}

/**
 * Score the Risk dimension (blast radius if something goes wrong).
 * @param {string} description
 * @returns {DimensionScore}
 */
function scoreRisk(description) {
  const desc = (description ?? '').toLowerCase();
  const highRisk = [
    'payment', 'billing', 'stripe', 'charge', 'refund',
    'auth', 'password', 'session', 'token', 'jwt', 'oauth',
    'user data', 'pii', 'gdpr', 'delete', 'drop', 'truncate',
    'migration', 'schema', 'alter', 'production', 'release'
  ];
  const mediumRisk = [
    'user-facing', 'api', 'endpoint', 'public', 'core',
    'background', 'queue', 'email', 'notification'
  ];
  if (highRisk.some(s => desc.includes(s))) {
    return { score: 3, rationale: 'High blast radius: auth, payments, user data, or data integrity' };
  }
  if (mediumRisk.some(s => desc.includes(s))) {
    return { score: 2, rationale: 'User-facing or requires careful testing' };
  }
  return { score: 1, rationale: 'Easily reversible, non-critical path' };
}

/**
 * Score the Testing dimension (testing effort required).
 * @param {string} description
 * @param {string[]} files
 * @returns {DimensionScore}
 */
function scoreTesting(description, files = []) {
  const desc = (description ?? '').toLowerCase();
  const hasTestFiles = files.some(f => /(test|spec|__tests__|\.test\.|\.spec\.)/.test(f));
  if (desc.includes('e2e') || desc.includes('end-to-end') || desc.includes('playwright') ||
      desc.includes('cypress') || desc.includes('integration test')) {
    return { score: 3, rationale: 'E2E testing required, performance or security tests' };
  }
  if (hasTestFiles || desc.includes('test') || desc.includes('spec')) {
    return { score: 2, rationale: 'Unit or integration tests with new fixtures' };
  }
  return { score: 1, rationale: 'Minimal testing: existing patterns, unit tests only' };
}

/**
 * Score the Decomposability dimension (can it be split?).
 * @param {string} description
 * @param {string[]} files
 * @param {DimensionScore} scope
 * @returns {DimensionScore}
 */
function scoreDecomposability(description, files = [], scope) {
  const desc = (description ?? '').toLowerCase();
  const parallelSignals = [
    'backend', 'frontend', 'server', 'client',
    'api route', 'ui', 'component', 'database', 'migration'
  ];
  const coupledSignals = [
    'atomic', 'transaction', 'race condition', 'shared state',
    'tightly coupled', 'monolithic', 'spaghetti'
  ];
  if (coupledSignals.some(s => desc.includes(s))) {
    return { score: 3, rationale: 'Tightly coupled, must be done atomically' };
  }
  // Backend/frontend separation is a good decomposability signal
  const uniqueDirs = [...new Set(files.map(f => f.split('/')[1] ?? f.split('/')[0]))];
  if (uniqueDirs.length >= 3 || parallelSignals.filter(s => desc.includes(s)).length >= 2) {
    if (scope?.score <= 2) {
      return { score: 1, rationale: 'Clearly separable: backend/frontend/data layers' };
    }
    return { score: 2, rationale: 'Partially decomposable, some shared dependencies' };
  }
  if (scope?.score >= 3) {
    return { score: 3, rationale: 'Large scope, difficult to decompose cleanly' };
  }
  return { score: 2, rationale: 'Some subtask boundaries but not fully independent' };
}

// ── Multiplier detection ───────────────────────────────────────────────────────

/**
 * Detect applicable risk multipliers from description.
 * @param {string} description
 * @returns {{ applied: string[], highest: number }}
 */
function detectMultipliers(description) {
  const desc = (description ?? '').toLowerCase();
  const applied = [];

  if (/auth|encrypt|jwt|token|oauth|password|credential|api[\s_-]?key|secret/.test(desc)) {
    applied.push('security-sensitive');
  }
  if (/migration|schema|migrate|alter\s+table|transform|seed/.test(desc)) {
    applied.push('data-migration');
  }
  if (/deprecat|break|version\s*\+?|remove.*api|major/.test(desc)) {
    applied.push('breaking-changes');
  }
  if (/legacy|refactor|technical\s+debt|debt|untested|quick[\s_-]?fix/.test(desc)) {
    applied.push('technical-debt');
  }
  if (/urgent|rush|asap|deadline|hotfix|critical\s+bug/.test(desc)) {
    applied.push('time-pressure');
  }

  const values = applied.map(m => MULTIPLIERS[m] ?? 1.0);
  const highest = values.length > 0 ? Math.max(...values) : 1.0;

  return { applied, highest };
}

// ── Confidence scoring ─────────────────────────────────────────────────────────

/**
 * Calculate confidence score based on assessment clarity.
 * @param {string} description
 * @param {number} fileCount
 * @param {{ [key: string]: DimensionScore }} dimensions
 * @returns {{ confidence: number, justification: string }}
 */
function scoreConfidence(description, fileCount, dimensions) {
  let adjustment = 0;
  const reasons = [];

  // Requirements clarity
  const hasClearScope = fileCount > 0 && fileCount <= 10;
  if (hasClearScope) {
    adjustment += 10;
    reasons.push('clear file scope');
  } else if (fileCount > 15) {
    adjustment -= 10;
    reasons.push('large scope makes confidence harder');
  }

  // Language clarity
  const clearTerms = ['add', 'create', 'update', 'delete', 'implement', 'fix', 'rename'];
  const hasClearLanguage = clearTerms.some(t => description?.toLowerCase().includes(t));
  if (hasClearLanguage) {
    adjustment += 10;
    reasons.push('clear action language');
  }

  // Domain familiarity signal
  const unfamiliarDomain = dimensions.knowledge?.score >= 2;
  if (unfamiliarDomain) {
    adjustment -= 15;
    reasons.push('unfamiliar domain');
  }

  // High-risk without clear scope
  if (dimensions.risk?.score === 3 && fileCount === 0) {
    adjustment -= 20;
    reasons.push('high-risk but scope unclear');
  }

  const confidence = Math.max(0, Math.min(100, 70 + adjustment));

  let level, justification;
  if (confidence >= CONFIDENCE_HIGH) {
    justification = `High confidence: ${reasons.join(', ') || 'clear task definition'}`;
  } else if (confidence >= CONFIDENCE_MEDIUM) {
    justification = `Medium confidence: ${reasons.join(', ') || 'some uncertainty in assessment'}`;
  } else {
    justification = `Low confidence: ${reasons.join(', ') || 'ambiguous task requires clarification'}`;
  }

  return { confidence, justification };
}

// ── Decomposition suggestions ───────────────────────────────────────────────────

/**
 * Generate decomposition suggestions for COMPLEX tasks.
 * @param {{ [key: string]: DimensionScore }} dimensions
 * @param {number} adjustedScore
 * @returns {string[]}
 */
function generateDecomposition(dimensions, adjustedScore) {
  if (adjustedScore < 17) return [];

  const suggestions = [];

  if (dimensions.scope?.score >= 3) {
    suggestions.push('Break down by module or feature: isolate the highest-risk component first');
  }
  if (dimensions.integration?.score >= 3) {
    suggestions.push('Tackle external integrations separately before wiring them together');
  }
  if (dimensions.infrastructure?.score >= 3) {
    suggestions.push('Separate infra migration from application code changes');
  }
  if (dimensions.testing?.score >= 3) {
    suggestions.push('Write tests before implementation (TDD approach) to clarify requirements');
  }
  if (dimensions.decomposability?.score >= 3) {
    suggestions.push('Consider a big-bang rewrite avoidance: implement behind feature flag first');
  }

  return suggestions;
}

// ── Integration hints ───────────────────────────────────────────────────────────

/**
 * Build integration hints from tier and dimensions.
 * @param {'SIMPLE'|'STANDARD'|'COMPLEX'} tier
 * @param {{ [key: string]: DimensionScore }} dimensions
 * @returns {IntegrationHints}
 */
function buildIntegrationHints(tier, dimensions) {
  const artifactMap = {
    'SIMPLE':   'single_issue',
    'STANDARD': 'epic_with_sub_issues',
    'COMPLEX':  'epic_with_sub_issues_and_project'
  };
  const budgetMap = {
    'SIMPLE':   4096,
    'STANDARD': 8192,
    'COMPLEX':  16384
  };

  let worktreeRecommended = tier !== 'SIMPLE';
  if (dimensions.decomposability?.score <= 1 && tier !== 'SIMPLE') {
    worktreeRecommended = false;
  }

  return {
    githubArtifact:       artifactMap[tier],
    contextBranchBudget:   budgetMap[tier],
    worktreeRecommended,
    parallelizationPotential: dimensions.decomposability?.score <= 1
      ? ['All subtasks are independent and can run in parallel']
      : ['Subtasks have dependencies — use topological ordering']
  };
}

// ── Main assess function ───────────────────────────────────────────────────────

/**
 * Assess a single task's complexity across 7 dimensions.
 *
 * @param {Object} input
 * @param {string} input.description - Full task description
 * @param {string[]} input.files - List of files this task touches
 * @param {string} [input.phaseContext] - Additional phase context
 * @param {number} [input.phaseNumber] - Current phase number (affects risk multiplier)
 * @returns {ComplexityResult}
 */
export function assessTask({ description, files = [], phaseContext = '', phaseNumber = 1 }) {
  // Score each dimension
  const fileCount = files.length;
  const scope = scoreScope(fileCount, description);
  const integration = scoreIntegration(description);
  const infrastructure = scoreInfrastructure(description, files);
  const knowledge = scoreKnowledge(description, files);
  const risk = scoreRisk(description);
  const testing = scoreTesting(description, files);
  const decomposability = scoreDecomposability(description, files, scope);

  // Phase-aware risk: later phases have slightly higher risk
  const adjustedRisk = phaseNumber >= 3 && risk.score >= 2
    ? { score: Math.min(3, risk.score + 1), rationale: `${risk.rationale} (phase ${phaseNumber})` }
    : risk;

  const dimensions = { scope, integration, infrastructure, knowledge, risk: adjustedRisk, testing, decomposability };

  // Calculate base score
  const score = Object.values(dimensions).reduce((sum, d) => sum + (d.score ?? 1), 0);

  // Apply multipliers
  const multipliers = detectMultipliers(description);
  const adjustedScore = Math.round(score * multipliers.highest);

  // Determine tier
  let tier;
  if (adjustedScore <= 11)      tier = 'SIMPLE';
  else if (adjustedScore <= 16) tier = 'STANDARD';
  else                          tier = 'COMPLEX';

  // Confidence
  const { confidence, justification } = scoreConfidence(description, fileCount, dimensions);

  // Model recommendation
  const modelRecommendation = TIER_MODEL[tier];

  // Integration hints
  const integrationHints = buildIntegrationHints(tier, dimensions);

  // Decomposition
  const decompositionSuggestions = generateDecomposition(dimensions, adjustedScore);

  return {
    tier,
    score,
    adjustedScore,
    confidence,
    confidenceJustification: justification,
    modelRecommendation,
    dimensions,
    multipliers: {
      applied: multipliers.applied,
      adjustedScore: adjustedScore
    },
    integrationHints,
    decompositionSuggestions
  };
}

// ── Plan-level assessment ───────────────────────────────────────────────────────

/**
 * Assess all tasks in a plan XML string.
 * @param {string} planXml - Raw XML string of a plan
 * @param {number} [phaseNumber] - Current phase number
 * @returns {Array<{ taskId: string, complexity: ComplexityResult }>}
 */
export function assessPlan(planXml, phaseNumber = 1) {
  const results = [];

  // Extract each task block from the XML
  const taskRegex = /<task id="([^"]+)"[^>]*>[\s\S]*?<\/task>/g;
  let match;

  while ((match = taskRegex.exec(planXml)) !== null) {
    const taskXml = match[0];
    const taskId = match[1];

    // Extract description
    const descMatch = taskXml.match(/<description>([\s\S]*?)<\/description>/);
    const description = descMatch ? descMatch[1].trim() : '';

    // Extract files
    const filesMatch = taskXml.match(/<files>([\s\S]*?)<\/files>/);
    const files = filesMatch
      ? filesMatch[1].split(',').map(f => f.trim()).filter(Boolean)
      : [];

    const complexity = assessTask({ description, files, phaseNumber });
    results.push({ taskId, complexity });
  }

  return results;
}

/**
 * Assess a full phase's worth of plan XMLs.
 * @param {string[]} planXmls - Array of raw XML strings from multiple plans
 * @param {number} [phaseNumber]
 * @returns {{ tasks: Array<{ planId: string, taskId: string, complexity: ComplexityResult }>, lowConfidenceTasks: Array }}
 */
export function assessPhase(planXmls, phaseNumber = 1) {
  const tasks = [];
  const lowConfidenceTasks = [];

  for (const { planId, xml } of planXmls) {
    const taskResults = assessPlan(xml, phaseNumber);
    for (const { taskId, complexity } of taskResults) {
      tasks.push({ planId, taskId, complexity });
      if (complexity.confidence < CONFIDENCE_MEDIUM) {
        lowConfidenceTasks.push({ planId, taskId, complexity });
      }
    }
  }

  return { tasks, lowConfidenceTasks };
}

// ── Tier thresholds ────────────────────────────────────────────────────────────

export const TIER_THRESHOLDS = {
  SIMPLE:   { min: 7,  max: 11, model: 'haiku',  contextBudget: 4096  },
  STANDARD: { min: 12, max: 16, model: 'sonnet', contextBudget: 8192  },
  COMPLEX:  { min: 17, max: 21, model: 'opus',   contextBudget: 16384 }
};

export { TIER_MODEL, CONFIDENCE_MEDIUM };
