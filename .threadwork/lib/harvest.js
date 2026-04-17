/**
 * lib/harvest.js — Knowledge harvest engine
 *
 * Extracts reusable patterns from completed project work and proposes
 * them as learned specs for the Threadwork repository. This is the
 * "self-evolution" engine: projects teach the framework.
 *
 * Harvest sources:
 *  1. Plan decisions (<decision> blocks in PLAN XML files)
 *  2. Ralph Loop remediation log (anti-patterns that caused failures)
 *  3. Knowledge notes (critical discoveries, promoted notes)
 *  4. Spec rules that caught violations (proven enforcement rules)
 *  5. Project specs that diverged from core (evolved patterns)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import matter from 'gray-matter';

// ── Paths ────────────────────────────────────────────────────────────────────

function threadworkRoot() {
  // Navigate from lib/ up to the threadwork repo root
  return join(dirname(import.meta.url.replace('file://', '')), '..');
}

function proposalsDir() {
  return join(threadworkRoot(), 'templates', 'specs', 'proposals');
}

function learnedDir() {
  return join(threadworkRoot(), 'templates', 'specs', 'learned');
}

function learnedIndexPath() {
  return join(learnedDir(), 'index.json');
}

function projectStateDir() {
  return join(process.cwd(), '.threadwork', 'state');
}

// ── Harvest: Extract knowledge from current project ─────────────────────────

/**
 * Run a full harvest of the current project's accumulated knowledge.
 * Returns an array of proposal objects ready for human review.
 *
 * @param {object} [options]
 * @param {string} [options.projectName] Override project name
 * @returns {Array<{ type: string, domain: string, key: string, content: string, provenance: object, confidence: number }>}
 */
export function harvestProject(options = {}) {
  const proposals = [];
  const projectName = options.projectName ?? readProjectName();
  const now = new Date().toISOString();

  // Source 1: Plan decisions
  proposals.push(...harvestDecisions(projectName, now));

  // Source 2: Ralph Loop remediation log
  proposals.push(...harvestRemediationLog(projectName, now));

  // Source 3: Knowledge notes (critical + promoted)
  proposals.push(...harvestKnowledgeNotes(projectName, now));

  // Source 4: Spec rules that caught violations
  proposals.push(...harvestProvenRules(projectName, now));

  // Source 5: Project specs that diverged from core
  proposals.push(...harvestDivergedSpecs(projectName, now));

  // Deduplicate by key
  const seen = new Set();
  return proposals.filter(p => {
    const sig = `${p.domain}:${p.key}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

// ── Source 1: Plan decisions ─────────────────────────────────────────────────

function harvestDecisions(projectName, now) {
  const results = [];
  const phasesDir = join(projectStateDir(), 'phases');
  if (!existsSync(phasesDir)) return results;

  for (const phaseDir of readdirSync(phasesDir)) {
    const plansDir = join(phasesDir, phaseDir, 'plans');
    if (!existsSync(plansDir)) continue;

    for (const file of readdirSync(plansDir)) {
      if (!file.endsWith('.xml')) continue;
      try {
        const xml = readFileSync(join(plansDir, file), 'utf8');
        const decisionMatches = xml.matchAll(/<decision\s+task="([^"]*)"[^>]*>\s*<choice>([\s\S]*?)<\/choice>\s*<rationale>([\s\S]*?)<\/rationale>/g);
        for (const m of decisionMatches) {
          const [, taskId, choice, rationale] = m;
          results.push({
            type: 'decision',
            domain: 'architecture',
            key: slugify(choice.trim().slice(0, 60)),
            content: `# ${choice.trim()}\n\n**Rationale:** ${rationale.trim()}\n\n**Origin task:** ${taskId}`,
            provenance: { project: projectName, date: now, source: 'plan-decision', taskId },
            confidence: 0.5,
            tags: extractTags(choice + ' ' + rationale),
          });
        }
      } catch { /* skip unparseable */ }
    }
  }
  return results;
}

// ── Source 2: Ralph Loop remediation log ──────────────────────────────────────

function harvestRemediationLog(projectName, now) {
  const results = [];
  const ralphPath = join(projectStateDir(), 'ralph-state.json');
  if (!existsSync(ralphPath)) return results;

  try {
    const ralph = JSON.parse(readFileSync(ralphPath, 'utf8'));
    const log = ralph.remediation_log ?? [];

    for (const entry of log) {
      if (!entry.primary_violation) continue;
      results.push({
        type: 'anti-pattern',
        domain: 'anti-patterns',
        key: slugify(entry.primary_violation.slice(0, 60)),
        content: `# Anti-Pattern: ${entry.primary_violation}\n\n**Fix:** ${entry.fix_template ?? 'See remediation'}\n**Gate:** ${entry.gate ?? 'unknown'}\n**Occurrences:** ${entry.count ?? 1}`,
        provenance: { project: projectName, date: now, source: 'ralph-loop', gate: entry.gate },
        confidence: Math.min(0.7, 0.3 + (entry.count ?? 1) * 0.1),
        tags: extractTags(entry.primary_violation),
      });
    }
  } catch { /* skip */ }
  return results;
}

// ── Source 3: Knowledge notes ────────────────────────────────────────────────

function harvestKnowledgeNotes(projectName, now) {
  const results = [];
  const notesPath = join(projectStateDir(), 'knowledge-notes.json');
  if (!existsSync(notesPath)) return results;

  try {
    const data = JSON.parse(readFileSync(notesPath, 'utf8'));
    const notes = data.notes ?? [];

    for (const note of notes) {
      // Only harvest critical notes or those that survived 2+ sessions
      if (!note.critical && (note.sessionsSurvived ?? 0) < 2) continue;

      results.push({
        type: 'pattern',
        domain: 'patterns',
        key: slugify(note.summary.slice(0, 60)),
        content: `# ${note.summary}\n\n**Category:** ${note.category}\n**Scope:** ${note.scope ?? 'global'}\n**Evidence:** ${note.evidence ?? 'discovered during implementation'}\n**Critical:** ${note.critical ? 'yes' : 'no'}`,
        provenance: { project: projectName, date: now, source: 'knowledge-note', noteId: note.noteId },
        confidence: note.critical ? 0.7 : 0.5,
        tags: extractTags(note.summary + ' ' + (note.category ?? '')),
      });
    }
  } catch { /* skip */ }
  return results;
}

// ── Source 4: Proven spec rules ──────────────────────────────────────────────

function harvestProvenRules(projectName, now) {
  const results = [];
  const specsDir = join(process.cwd(), '.threadwork', 'specs');
  if (!existsSync(specsDir)) return results;

  // Look for specs with rules that have enforcement evidence in ralph-state
  const ralphPath = join(projectStateDir(), 'ralph-state.json');
  const violatedSpecs = new Set();
  if (existsSync(ralphPath)) {
    try {
      const ralph = JSON.parse(readFileSync(ralphPath, 'utf8'));
      for (const entry of ralph.remediation_log ?? []) {
        if (entry.relevant_spec) violatedSpecs.add(entry.relevant_spec);
      }
    } catch { /* skip */ }
  }

  // Walk project specs for rules that caught violations
  for (const domain of ['backend', 'frontend', 'testing', 'enforcement']) {
    const domainDir = join(specsDir, domain);
    if (!existsSync(domainDir)) continue;

    for (const file of readdirSync(domainDir)) {
      if (!file.endsWith('.md')) continue;
      try {
        const parsed = matter(readFileSync(join(domainDir, file), 'utf8'));
        const rules = parsed.data.rules ?? [];
        const specId = parsed.data.specId ?? '';

        if (rules.length > 0 && violatedSpecs.has(specId)) {
          results.push({
            type: 'proven-rules',
            domain: 'patterns',
            key: `rules-${slugify(parsed.data.name ?? file.replace('.md', ''))}`,
            content: `# Proven Rules from ${parsed.data.name ?? file}\n\nThese rules caught real violations in project "${projectName}".\n\n${rules.map(r => `- **${r.type}**: ${r.message}`).join('\n')}`,
            provenance: { project: projectName, date: now, source: 'spec-compliance', specId },
            confidence: 0.7,
            tags: parsed.data.tags ?? [],
            rules,
          });
        }
      } catch { /* skip */ }
    }
  }
  return results;
}

// ── Source 5: Diverged specs ─────────────────────────────────────────────────

function harvestDivergedSpecs(projectName, now) {
  const results = [];
  const projectSpecsDir = join(process.cwd(), '.threadwork', 'specs');
  const coreSpecsDir = join(threadworkRoot(), 'templates', 'specs', 'core');
  if (!existsSync(projectSpecsDir) || !existsSync(coreSpecsDir)) return results;

  for (const domain of ['backend', 'frontend', 'testing', 'enforcement']) {
    const projDomainDir = join(projectSpecsDir, domain);
    const coreDomainDir = join(coreSpecsDir, domain);
    if (!existsSync(projDomainDir)) continue;

    for (const file of readdirSync(projDomainDir)) {
      if (!file.endsWith('.md')) continue;
      const corePath = join(coreDomainDir, file);
      const projPath = join(projDomainDir, file);

      try {
        const projContent = readFileSync(projPath, 'utf8');
        // If no core equivalent exists, this is a project-created spec
        if (!existsSync(corePath)) {
          const parsed = matter(projContent);
          if ((parsed.data.confidence ?? 0) >= 0.7) {
            results.push({
              type: 'new-spec',
              domain: 'patterns',
              key: `${domain}-${file.replace('.md', '')}`,
              content: projContent,
              provenance: { project: projectName, date: now, source: 'project-spec', specId: parsed.data.specId },
              confidence: parsed.data.confidence ?? 0.6,
              tags: parsed.data.tags ?? [],
            });
          }
          continue;
        }

        // If core exists, check for meaningful divergence
        const coreContent = readFileSync(corePath, 'utf8');
        const projParsed = matter(projContent);
        const coreParsed = matter(coreContent);

        // Check for new rules added by the project
        const coreRules = coreParsed.data.rules ?? [];
        const projRules = projParsed.data.rules ?? [];
        const newRules = projRules.filter(pr =>
          !coreRules.some(cr => cr.type === pr.type && cr.pattern === pr.pattern)
        );

        if (newRules.length > 0) {
          results.push({
            type: 'rule-addition',
            domain: 'patterns',
            key: `new-rules-${domain}-${file.replace('.md', '')}`,
            content: `# New rules from ${projParsed.data.name ?? file}\n\nAdded during project "${projectName}".\n\n${newRules.map(r => `- **${r.type}**: ${r.message}`).join('\n')}`,
            provenance: { project: projectName, date: now, source: 'spec-divergence', specId: projParsed.data.specId },
            confidence: 0.5,
            tags: projParsed.data.tags ?? [],
            rules: newRules,
          });
        }
      } catch { /* skip */ }
    }
  }
  return results;
}

// ── Write proposals to Threadwork repo ───────────────────────────────────────

/**
 * Write harvested proposals to templates/specs/proposals/ in the Threadwork repo.
 * @param {Array} proposals Output from harvestProject()
 * @returns {number} Number of proposals written
 */
export function writeProposals(proposals) {
  const dir = proposalsDir();
  mkdirSync(dir, { recursive: true });
  let count = 0;

  for (const p of proposals) {
    const id = `${Date.now()}-${p.key}`;
    const frontmatter = {
      proposalId: id,
      type: p.type,
      domain: p.domain,
      key: p.key,
      confidence: p.confidence,
      tags: p.tags ?? [],
      provenance: p.provenance,
      createdAt: new Date().toISOString(),
    };

    if (p.rules) frontmatter.rules = p.rules;

    const content = matter.stringify(p.content, frontmatter);
    writeFileSync(join(dir, `${id}.md`), content, 'utf8');
    count++;
  }
  return count;
}

// ── Review: List, approve, reject proposals ──────────────────────────────────

/**
 * List all pending proposals.
 * @returns {Array<{ id: string, type: string, key: string, confidence: number, provenance: object, preview: string }>}
 */
export function listProposals() {
  const dir = proposalsDir();
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      try {
        const parsed = matter(readFileSync(join(dir, f), 'utf8'));
        const d = parsed.data;
        return {
          id: d.proposalId ?? f.replace('.md', ''),
          filename: f,
          type: d.type ?? 'unknown',
          domain: d.domain ?? 'unknown',
          key: d.key ?? f.replace('.md', ''),
          confidence: d.confidence ?? 0.3,
          tags: d.tags ?? [],
          provenance: d.provenance ?? {},
          preview: parsed.content.trim().split('\n').slice(0, 3).join('\n'),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Approve a proposal — move it to the learned directory.
 * @param {string} proposalId
 * @returns {{ success: boolean, destPath?: string, error?: string }}
 */
export function approveProposal(proposalId) {
  const dir = proposalsDir();
  const files = existsSync(dir) ? readdirSync(dir) : [];
  const match = files.find(f => f.includes(proposalId) || f === `${proposalId}.md`);
  if (!match) return { success: false, error: `Proposal not found: ${proposalId}` };

  const srcPath = join(dir, match);
  const parsed = matter(readFileSync(srcPath, 'utf8'));
  const domain = parsed.data.domain ?? 'patterns';
  const key = parsed.data.key ?? proposalId;

  // Bump confidence on approval
  parsed.data.confidence = Math.max(parsed.data.confidence ?? 0.5, 0.7);
  parsed.data.approvedAt = new Date().toISOString();

  const destDir = join(learnedDir(), domain);
  mkdirSync(destDir, { recursive: true });
  const destPath = join(destDir, `${key}.md`);

  // If file exists, merge provenance
  if (existsSync(destPath)) {
    try {
      const existing = matter(readFileSync(destPath, 'utf8'));
      const existingProv = Array.isArray(existing.data.provenance) ? existing.data.provenance : [existing.data.provenance].filter(Boolean);
      parsed.data.provenance = [...existingProv, parsed.data.provenance];
      parsed.data.confidence = Math.min(0.95, (existing.data.confidence ?? 0.7) + 0.1);
    } catch { /* overwrite if unparseable */ }
  } else {
    // Wrap single provenance in array for consistency
    parsed.data.provenance = [parsed.data.provenance].filter(Boolean);
  }

  writeFileSync(destPath, matter.stringify(parsed.content, parsed.data), 'utf8');

  // Remove from proposals
  unlinkSync(srcPath);

  // Update learned index
  updateLearnedIndex();

  return { success: true, destPath: destPath.replace(threadworkRoot() + '/', '') };
}

/**
 * Reject a proposal — delete it and optionally record the signal.
 * @param {string} proposalId
 * @param {string} [reason]
 * @returns {{ success: boolean, error?: string }}
 */
export function rejectProposal(proposalId, reason) {
  const dir = proposalsDir();
  const files = existsSync(dir) ? readdirSync(dir) : [];
  const match = files.find(f => f.includes(proposalId) || f === `${proposalId}.md`);
  if (!match) return { success: false, error: `Proposal not found: ${proposalId}` };

  const srcPath = join(dir, match);

  // Record rejection signal to suppress future similar proposals
  if (reason) {
    const rejectedPath = join(dir, '.rejected-signals.json');
    let signals = [];
    if (existsSync(rejectedPath)) {
      try { signals = JSON.parse(readFileSync(rejectedPath, 'utf8')); } catch { signals = []; }
    }
    const parsed = matter(readFileSync(srcPath, 'utf8'));
    signals.push({
      key: parsed.data.key,
      reason,
      rejectedAt: new Date().toISOString(),
    });
    writeFileSync(rejectedPath, JSON.stringify(signals, null, 2), 'utf8');
  }

  unlinkSync(srcPath);
  return { success: true };
}

// ── Stats ────────────────────────────────────────────────────────────────────

/**
 * Get statistics about the learned spec library.
 * @returns {{ totalLearned: number, byDomain: object, topProjects: Array, pendingProposals: number }}
 */
export function getLearnedStats() {
  const stats = { totalLearned: 0, byDomain: {}, topProjects: {}, pendingProposals: 0 };

  // Count learned specs
  const dir = learnedDir();
  for (const subdir of ['patterns', 'anti-patterns', 'architecture']) {
    const d = join(dir, subdir);
    if (!existsSync(d)) continue;
    const files = readdirSync(d).filter(f => f.endsWith('.md'));
    stats.byDomain[subdir] = files.length;
    stats.totalLearned += files.length;

    for (const file of files) {
      try {
        const parsed = matter(readFileSync(join(d, file), 'utf8'));
        const prov = Array.isArray(parsed.data.provenance) ? parsed.data.provenance : [parsed.data.provenance].filter(Boolean);
        for (const p of prov) {
          if (p?.project) {
            stats.topProjects[p.project] = (stats.topProjects[p.project] ?? 0) + 1;
          }
        }
      } catch { /* skip */ }
    }
  }

  // Count pending proposals
  const pDir = proposalsDir();
  if (existsSync(pDir)) {
    stats.pendingProposals = readdirSync(pDir).filter(f => f.endsWith('.md')).length;
  }

  return stats;
}

// ── Learned index management ─────────────────────────────────────────────────

function updateLearnedIndex() {
  const dir = learnedDir();
  const entries = [];

  for (const subdir of ['patterns', 'anti-patterns', 'architecture']) {
    const d = join(dir, subdir);
    if (!existsSync(d)) continue;

    for (const file of readdirSync(d)) {
      if (!file.endsWith('.md')) continue;
      try {
        const parsed = matter(readFileSync(join(d, file), 'utf8'));
        entries.push({
          domain: subdir,
          key: parsed.data.key ?? file.replace('.md', ''),
          confidence: parsed.data.confidence ?? 0.5,
          tags: parsed.data.tags ?? [],
          filename: `${subdir}/${file}`,
          approvedAt: parsed.data.approvedAt ?? null,
        });
      } catch { /* skip */ }
    }
  }

  const index = {
    _version: '1',
    _description: 'Learned spec index — patterns harvested from completed projects',
    _updated: new Date().toISOString(),
    entries,
  };

  writeFileSync(learnedIndexPath(), JSON.stringify(index, null, 2), 'utf8');
}

// ── Utilities ────────────────────────────────────────────────────────────────

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function extractTags(text) {
  const tagKeywords = [
    'typescript', 'python', 'react', 'nextjs', 'django', 'fastapi', 'express',
    'prisma', 'sqlalchemy', 'jwt', 'auth', 'api', 'database', 'testing',
    'migration', 'security', 'performance', 'caching', 'websocket',
  ];
  const lower = text.toLowerCase();
  return tagKeywords.filter(k => lower.includes(k));
}

function readProjectName() {
  try {
    const projPath = join(projectStateDir(), 'project.json');
    if (existsSync(projPath)) {
      return JSON.parse(readFileSync(projPath, 'utf8')).projectName ?? 'unknown';
    }
  } catch { /* fall through */ }
  return 'unknown';
}
