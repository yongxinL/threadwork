/**
 * lib/skill-tier.js — Skill tier system
 *
 * Controls output verbosity, explanation depth, and guidance level
 * across all Threadwork outputs. Set at init time, changeable anytime.
 *
 * Three tiers:
 *   beginner — inline comments, step-by-step reasoning, hand-holding
 *   advanced — concise summaries, code with non-obvious comments only (default)
 *   ninja    — minimal output, code only, no narration
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/** @typedef {'beginner' | 'advanced' | 'ninja'} Tier */
const VALID_TIERS = ['beginner', 'advanced', 'ninja'];

function projectJsonPath() {
  return join(process.cwd(), '.threadwork', 'state', 'project.json');
}

function ensureDir() {
  const dir = join(process.cwd(), '.threadwork', 'state');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readProjectJson() {
  const p = projectJsonPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// ── Core Functions ────────────────────────────────────────────────────────────

/**
 * Get the current skill tier from project.json.
 * Falls back to 'advanced' if unset.
 * @returns {Tier}
 */
export function getTier() {
  const proj = readProjectJson();
  const tier = proj?.skillTier;
  if (VALID_TIERS.includes(tier)) return tier;
  return 'advanced';
}

/**
 * Set the skill tier in project.json.
 * @param {Tier} tier
 */
export function setTier(tier) {
  if (!VALID_TIERS.includes(tier)) {
    throw new Error(`Invalid skill tier: '${tier}'. Must be one of: beginner, advanced, ninja`);
  }
  const p = projectJsonPath();
  let proj = {};
  if (existsSync(p)) {
    try {
      proj = JSON.parse(readFileSync(p, 'utf8'));
    } catch { /* ignore */ }
  }
  proj.skillTier = tier;
  proj._updated = new Date().toISOString();
  ensureDir();
  writeFileSync(p, JSON.stringify(proj, null, 2), 'utf8');
}

/**
 * Get the verbosity instruction string injected into every subagent prompt.
 * @param {Tier} [tier] Override; reads from project.json if omitted
 * @returns {string}
 */
export function getTierInstructions(tier) {
  const t = tier ?? getTier();
  switch (t) {
    case 'beginner':
      return [
        '## Output Style: Beginner Mode',
        'Explain your reasoning step-by-step before implementing.',
        'Include inline comments throughout generated code explaining what each section does.',
        'When a quality gate fails, explain what the error means and why it matters before fixing it.',
        'After each significant action, include a brief "What just happened" summary.',
        'Token budget warnings: briefly explain why managing tokens matters.',
        'Phase transitions: include a "You are here" orientation block.'
      ].join('\n');

    case 'advanced':
      return [
        '## Output Style: Advanced Mode',
        'Summarize reasoning in 1–2 sentences — no elaborate explanations.',
        'Code comments only for non-obvious logic.',
        'Quality gate failures: show the error and the fix, no background lecture.',
        'Slash command output: information-dense, no hand-holding.',
        'Token warnings: brief one-liner.',
        'Phase transitions: terse status updates.'
      ].join('\n');

    case 'ninja':
      return [
        '## Output Style: Ninja Mode',
        'Minimal output. Code only — no narration unless explicitly asked.',
        'Omit reasoning entirely unless requested.',
        'Quality gate failures: raw error + minimal correction. No explanation.',
        'Slash commands: machine-readable compact summaries.',
        'Token warnings: single indicator only (e.g., 🚨 91%).',
        'No orientation blocks, no summaries, no explanations unless asked.'
      ].join('\n');

    default:
      return getTierInstructions('advanced');
  }
}

/**
 * Apply tier-appropriate formatting to command output.
 * @param {string} content Raw output content
 * @param {{ tier?: Tier, context?: string }} [options]
 * @returns {string}
 */
export function formatOutput(content, options = {}) {
  const tier = options.tier ?? getTier();
  if (tier === 'ninja') {
    // Strip markdown headers, reduce whitespace
    return content
      .replace(/^#{1,3}\s+.+\n/gm, '')  // remove headings
      .replace(/\n{3,}/g, '\n\n')        // collapse blank lines
      .trim();
  }
  if (tier === 'beginner') {
    // Content is returned as-is; callers are expected to include explanations
    return content;
  }
  // advanced: return as-is (callers control density)
  return content;
}

/**
 * Get tier-appropriate warning format for a given level.
 * @param {'info' | 'warning' | 'critical'} level
 * @param {string} [message] Message to include
 * @param {Tier} [tier]
 * @returns {string}
 */
export function getWarningStyle(level, message = '', tier) {
  const t = tier ?? getTier();

  if (t === 'ninja') {
    const icons = { info: 'ℹ', warning: '⚠', critical: '🚨' };
    return message ? `${icons[level]} ${message}` : icons[level];
  }

  if (t === 'beginner') {
    switch (level) {
      case 'info':
        return `ℹ️ Note: ${message}\n(This is informational — no action required right now.)`;
      case 'warning':
        return `⚠️ Heads up: ${message}\n(You should address this before starting a new session to avoid losing context.)`;
      case 'critical':
        return `🚨 Important: ${message}\n(You need to act on this now. Run '/tw:done' to save your session before context is lost.)`;
      default:
        return message;
    }
  }

  // advanced
  switch (level) {
    case 'info':    return `ℹ️ ${message}`;
    case 'warning': return `⚠️ ${message}`;
    case 'critical': return `🚨 ${message}`;
    default:        return message;
  }
}
