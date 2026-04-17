/**
 * lib/blueprint-diff.js — Blueprint delta analysis for /tw:blueprint-diff
 *
 * Analysis-only module. No hooks/ imports. No LLM calls.
 * All analysis is keyword-heuristic and section-level diffing.
 * Designed to run in under 1 second on typical blueprints.
 *
 * Blueprint files are stored in .threadwork/state/ and committed to git.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ── Storage helpers ────────────────────────────────────────────────────────────

function stateDir() {
  return join(process.cwd(), '.threadwork', 'state');
}

function blueprintIndexPath() {
  return join(stateDir(), 'blueprint-index.json');
}

function readBlueprintIndex() {
  const p = blueprintIndexPath();
  if (!existsSync(p)) return { versions: [], latest: 0 };
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { versions: [], latest: 0 };
  }
}

function writeBlueprintIndex(index) {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(blueprintIndexPath(), JSON.stringify({
    _updated: new Date().toISOString(),
    ...index
  }, null, 2), 'utf8');
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Load the most recent blueprint version from storage.
 * @returns {string|null} blueprint content or null if none stored
 */
export function loadLatestBlueprint() {
  const index = readBlueprintIndex();
  if (!index.latest || index.versions.length === 0) return null;
  const latest = index.versions.find(v => v.version === index.latest);
  if (!latest) return null;
  const filePath = join(stateDir(), latest.file);
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Snapshot current blueprint content as a new versioned file.
 * @param {string} content - blueprint markdown content
 * @param {string} [note] - optional note for the version
 * @returns {number} new version number
 */
export function lockBlueprint(content, note = '') {
  mkdirSync(stateDir(), { recursive: true });
  const index = readBlueprintIndex();
  const newVersion = index.latest + 1;
  const filename = `blueprint-v${newVersion}.md`;
  const date = new Date().toISOString().slice(0, 10);

  writeFileSync(join(stateDir(), filename), content, 'utf8');

  index.versions.push({
    version: newVersion,
    date,
    file: filename,
    note: note || (newVersion === 1 ? 'Initial' : `Version ${newVersion}`)
  });
  index.latest = newVersion;
  writeBlueprintIndex(index);

  return newVersion;
}

/**
 * Extract section headings from blueprint markdown.
 * @param {string} content
 * @returns {string[]} array of heading lines
 */
function extractSections(content) {
  return (content ?? '').split('\n')
    .filter(line => /^#{1,3}\s/.test(line))
    .map(line => line.trim());
}

/**
 * Extract keywords from a section body.
 * @param {string} content
 * @returns {string[]}
 */
function extractKeywords(content) {
  const lower = content.toLowerCase();
  const patterns = [
    /command[s]?\s+`?\/tw:[a-z-]+`?/g,
    /agent[s]?\s+`?tw-[a-z-]+`?/g,
    /field[s]?\s+`?[a-z_]+`?/g,
    /function[s]?\s+`?[a-zA-Z_]+\(\)`?/g,
    /hook[s]?\s+`?[a-z-]+`?/g
  ];
  const found = [];
  for (const p of patterns) {
    const matches = lower.match(p) ?? [];
    found.push(...matches.map(m => m.trim()));
  }
  return found;
}

/**
 * Estimate token cost to implement a change.
 * Rough heuristic: structural > modifications > additive.
 * @param {string} type - 'additive'|'modification'|'structural'
 * @param {string} description
 * @returns {number} token estimate
 */
function estimateChangeTokens(type, description) {
  const baseTokens = { additive: 8_000, modification: 15_000, structural: 30_000 };
  const base = baseTokens[type] ?? 15_000;
  // Longer descriptions generally mean more complex changes
  const lengthFactor = Math.min(2.0, 1 + description.length / 500);
  return Math.round(base * lengthFactor);
}

/**
 * Diff two blueprint documents and categorize all changes.
 * Uses section-level diffing with keyword heuristics — no LLM.
 * @param {string} oldContent
 * @param {string} newContent
 * @returns {{ additive: Array, modifications: Array, structural: Array }}
 */
export function diffBlueprints(oldContent, newContent) {
  const oldSections = extractSections(oldContent ?? '');
  const newSections = extractSections(newContent ?? '');

  const oldSet = new Set(oldSections.map(s => s.replace(/^#+\s+/, '').toLowerCase()));
  const newSet = new Set(newSections.map(s => s.replace(/^#+\s+/, '').toLowerCase()));

  const additive = [];
  const modifications = [];
  const structural = [];

  let changeId = { a: 0, m: 0, s: 0 };

  // Find added sections (new sections not in old)
  for (const section of newSections) {
    const normalized = section.replace(/^#+\s+/, '').toLowerCase();
    if (!oldSet.has(normalized)) {
      changeId.a++;
      const id = `A${changeId.a}`;
      const isCommand = normalized.includes('/tw:') || normalized.includes('command');
      const isAgent = normalized.includes('tw-') || normalized.includes('agent');
      const isSpec = normalized.includes('spec') || normalized.includes('domain');

      let affectedComponents = [];
      let description = '';
      if (isCommand) {
        affectedComponents = ['templates/commands/'];
        description = `New command section: ${section.replace(/^#+\s+/, '')}`;
      } else if (isAgent) {
        affectedComponents = ['templates/agents/'];
        description = `New agent: ${section.replace(/^#+\s+/, '')}`;
      } else if (isSpec) {
        affectedComponents = ['.threadwork/specs/'];
        description = `New spec domain: ${section.replace(/^#+\s+/, '')}`;
      } else {
        affectedComponents = ['(new section)'];
        description = `New section: ${section.replace(/^#+\s+/, '')}`;
      }

      const estimatedTokens = estimateChangeTokens('additive', description);
      additive.push({
        id,
        description,
        section: section.replace(/^#+\s+/, ''),
        affected_components: affectedComponents,
        estimated_tokens: estimatedTokens,
        estimated_cost: estimatedTokens * 0.000009 // ~sonnet rate
      });
    }
  }

  // Detect modifications (sections exist in both but content around them changed)
  // We look for structural keyword changes vs. behavioral changes
  const structuralKeywords = [
    'hook event', 'state file schema', 'renamed', 'core execution model',
    'agent spawn model', 'core directory', 'execution architecture'
  ];
  const modificationKeywords = [
    'threshold', 'format change', 'behavior', 'function signature',
    'data format', 'updated', 'changed', 'modified', 'altered'
  ];

  // Simple content-level diff: look for lines present in new but not old
  const oldLines = new Set((oldContent ?? '').split('\n').map(l => l.trim()).filter(Boolean));
  const newLines = (newContent ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  const addedLines = newLines.filter(l => !oldLines.has(l) && l.length > 20);

  // Group added lines by proximity to section headings
  let currentSection = 'General';
  const sectionChanges = {};
  for (const line of (newContent ?? '').split('\n')) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      currentSection = headingMatch[2].trim();
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed || oldLines.has(trimmed) || trimmed.length < 20) continue;
    if (!sectionChanges[currentSection]) sectionChanges[currentSection] = [];
    sectionChanges[currentSection].push(trimmed);
  }

  for (const [section, changedLines] of Object.entries(sectionChanges)) {
    if (changedLines.length === 0) continue;
    const combined = changedLines.join(' ').toLowerCase();

    const isStructural = structuralKeywords.some(k => combined.includes(k));
    const isModification = modificationKeywords.some(k => combined.includes(k)) || !isStructural;

    if (isStructural) {
      changeId.s++;
      const id = `S${changeId.s}`;
      const estimatedTokens = estimateChangeTokens('structural', section);
      structural.push({
        id,
        description: `Structural change in: ${section}`,
        section,
        affected_components: guessAffectedComponents(section, combined),
        estimated_tokens: estimatedTokens,
        estimated_cost: estimatedTokens * 0.000009
      });
    } else if (isModification && oldSet.has(section.toLowerCase())) {
      changeId.m++;
      const id = `M${changeId.m}`;
      const estimatedTokens = estimateChangeTokens('modification', section);
      modifications.push({
        id,
        description: `Behavior change in: ${section}`,
        section,
        affected_components: guessAffectedComponents(section, combined),
        estimated_tokens: estimatedTokens,
        estimated_cost: estimatedTokens * 0.000009
      });
    }
  }

  return { additive, modifications, structural };
}

/**
 * Guess affected components based on section name and content.
 * @param {string} section
 * @param {string} content
 * @returns {string[]}
 */
function guessAffectedComponents(section, content) {
  const components = [];
  const lower = (section + ' ' + content).toLowerCase();
  if (lower.includes('token') || lower.includes('budget') || lower.includes('cost')) {
    components.push('lib/token-tracker.js');
  }
  if (lower.includes('handoff')) components.push('lib/handoff.js');
  if (lower.includes('state') || lower.includes('project.json')) components.push('lib/state.js');
  if (lower.includes('hook') || lower.includes('pre-tool') || lower.includes('session-start')) {
    components.push('hooks/');
  }
  if (lower.includes('spec')) components.push('.threadwork/specs/');
  if (lower.includes('command') || lower.includes('/tw:')) components.push('templates/commands/');
  if (lower.includes('agent') || lower.includes('tw-')) components.push('templates/agents/');
  return components.length > 0 ? components : ['(unknown)'];
}

/**
 * Map categorized changes to current project state.
 * @param {Object} changes - output of diffBlueprints()
 * @param {Object} projectState - from state.js readState()
 * @param {number} [sincePhase] - optional: only analyze phases >= sincePhase
 * @returns {{ rework: Array, free: Array, deferred: Array }}
 */
export function mapChangesToPhases(changes, projectState, sincePhase) {
  const currentPhase = projectState?.currentPhase ?? 0;
  const allChanges = [
    ...changes.additive,
    ...changes.modifications,
    ...changes.structural
  ];

  const rework = []; // affects completed phases — needs rework
  const free = [];   // affects not-yet-started phases — free to integrate
  const deferred = []; // can be deferred to later phases

  for (const change of allChanges) {
    const inDonePhase = change.section && (
      change.section.toLowerCase().includes(`phase ${currentPhase}`) ||
      change.section.toLowerCase().includes(`phase ${currentPhase - 1}`)
    );
    const inFuturePhase = change.section && (
      change.section.toLowerCase().includes('phase') &&
      !inDonePhase
    );

    if (sincePhase && change.section) {
      const phaseMatch = change.section.match(/phase\s+(\d+)/i);
      if (phaseMatch && parseInt(phaseMatch[1]) < sincePhase) {
        deferred.push(change);
        continue;
      }
    }

    if (inDonePhase || (!inFuturePhase && changes.structural.includes(change))) {
      rework.push(change);
    } else {
      free.push(change);
    }
  }

  return { rework, free, deferred };
}

/**
 * Generate cost estimates for three migration options.
 * @param {Object} mappedChanges - output of mapChangesToPhases()
 * @param {Object} pricing - from token-tracker loadPricing()
 * @returns {Object} migration cost estimates
 */
export function estimateMigrationCosts(mappedChanges, pricing) {
  const { rework = [], free = [], deferred = [] } = mappedChanges;

  const reworkCost = rework.reduce((sum, c) => sum + (c.estimated_cost ?? 0), 0);
  const freeCost = free.reduce((sum, c) => sum + (c.estimated_cost ?? 0), 0);
  const deferredCost = deferred.reduce((sum, c) => sum + (c.estimated_cost ?? 0), 0);
  const totalChangeCost = reworkCost + freeCost;

  // Option A: Full restart — estimate based on total scope
  const restartTokens = 2_000_000; // typical full project rebuild
  const restartCost = restartTokens * 0.000009;

  // Option B: In-place — implement rework + free additions
  const inPlaceTokens = (rework.length + free.length) * 15_000;
  const inPlaceCost = reworkCost + freeCost;
  const reworkPctOfRestart = restartCost > 0 ? (inPlaceCost / restartCost) * 100 : 0;

  // Option C: Phased — only additive changes now, defer rework
  const phasedTokens = free.reduce((sum, c) => sum + (c.estimated_tokens ?? 0), 0);
  const phasedCost = freeCost;

  const recommendation = reworkPctOfRestart < 20 ? 'B' : reworkPctOfRestart < 40 ? 'C' : 'A';

  return {
    restart: {
      tokens: restartTokens,
      cost: restartCost,
      description: 'Rebuild all phases from scratch with new blueprint. Clean slate, no technical debt.'
    },
    in_place: {
      tokens: inPlaceTokens,
      cost: inPlaceCost,
      description: `Implement ${rework.length} rework changes + ${free.length} new additions.`,
      risk: rework.length === 0 ? 'minimal' : rework.length <= 2 ? 'minor' : 'moderate',
      rework_pct_of_restart: Math.round(reworkPctOfRestart)
    },
    phased: {
      tokens: phasedTokens,
      cost: phasedCost,
      description: `Implement ${free.length} additive changes now. Defer ${rework.length} rework changes.`,
      deferred_cost: reworkCost + deferredCost
    },
    recommendation
  };
}

/**
 * Format the full diff analysis report as a readable string.
 * @param {Object} analysis - full analysis object
 * @param {number} [sincePhase] - if set, adds "Impact on remaining work only" header
 * @returns {string} formatted report
 */
export function formatDiffReport(analysis, sincePhase) {
  const { changes, mapped, migration } = analysis;
  const lines = [];

  lines.push('── Blueprint Delta Analysis ─────────────────────────────');

  if (sincePhase) {
    lines.push(`Showing impact on remaining work only (Phases ${sincePhase}+)`);
  }

  lines.push('');

  // Additive
  if (changes.additive.length > 0) {
    lines.push(`ADDITIVE CHANGES (${changes.additive.length}) — can be added without touching existing code`);
    for (const c of changes.additive) {
      lines.push(`  [${c.id}] ${c.description}`);
      lines.push(`       Affects: ${c.affected_components.join(', ')}`);
      lines.push(`       Est. cost: ~$${c.estimated_cost.toFixed(2)} to implement`);
    }
    lines.push('');
  }

  // Modifications
  if (changes.modifications.length > 0) {
    lines.push(`MODIFICATIONS (${changes.modifications.length}) — behavior changes to existing features`);
    for (const c of changes.modifications) {
      lines.push(`  [${c.id}] ${c.description}`);
      lines.push(`       Affects: ${c.affected_components.join(', ')}`);
      lines.push(`       Est. rework cost: ~$${c.estimated_cost.toFixed(2)}`);
    }
    lines.push('');
  }

  // Structural
  if (changes.structural.length > 0) {
    lines.push(`STRUCTURAL CHANGES (${changes.structural.length}) — core architecture shifts`);
    for (const c of changes.structural) {
      lines.push(`  [${c.id}] ${c.description}`);
      lines.push(`       Affects: ${c.affected_components.join(', ')}`);
      lines.push(`       Est. rework cost: ~$${c.estimated_cost.toFixed(2)}`);
    }
    lines.push('');
  }

  if (changes.additive.length === 0 && changes.modifications.length === 0 && changes.structural.length === 0) {
    lines.push('No changes detected between blueprint versions.');
    lines.push('──────────────────────────────────────────────────────────');
    return lines.join('\n');
  }

  lines.push('──────────────────────────────────────────────────────────');
  lines.push('MIGRATION OPTIONS');
  lines.push('');
  lines.push(`Option A — Full Restart`);
  lines.push(`  ${migration.restart.description}`);
  lines.push(`  Estimated cost: ~$${migration.restart.cost.toFixed(2)} | Clean slate | No technical debt`);
  lines.push(`  Use when: structural changes are pervasive or > 40% of work is DONE`);
  lines.push('');
  lines.push(`Option B — In-Place Migration`);
  lines.push(`  ${migration.in_place.description}`);
  lines.push(`  Estimated cost: ~$${migration.in_place.cost.toFixed(2)} total`);
  lines.push(`  Risk: ${migration.in_place.risk} — rework is ${migration.in_place.rework_pct_of_restart}% of restart cost`);
  lines.push(`  Use when: rework cost is < 20% of restart cost`);
  lines.push('');
  lines.push(`Option C — Phased Adoption`);
  lines.push(`  ${migration.phased.description}`);
  lines.push(`  Immediate cost: ~$${migration.phased.cost.toFixed(2)} | Deferred cost: ~$${migration.phased.deferred_cost.toFixed(2)}`);
  lines.push(`  Use when: you want to keep momentum and can tolerate temporary inconsistency`);
  lines.push('');
  lines.push(`Recommendation: Option ${migration.recommendation} (${
    migration.recommendation === 'A' ? 'full restart' :
    migration.recommendation === 'B' ? 'in-place migration' : 'phased adoption'
  })`);
  lines.push('');
  lines.push(`Type the option letter (A/B/C) to proceed, or press Enter to cancel.`);
  lines.push('──────────────────────────────────────────────────────────');

  return lines.join('\n');
}

/**
 * List all stored blueprint versions.
 * @returns {Array} version objects from blueprint-index.json
 */
export function listBlueprintVersions() {
  return readBlueprintIndex().versions ?? [];
}
