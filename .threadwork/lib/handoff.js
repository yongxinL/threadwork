/**
 * lib/handoff.js — Session end summary and handoff generator
 *
 * Generates a 10-section structured handoff document that makes resuming
 * the next session effortless. Also writes checkpoint.json in machine-readable form.
 *
 * Handoffs live at: .threadwork/workspace/handoffs/YYYY-MM-DD-N.md
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { readCheckpoint, writeCheckpoint, readSessionDecisions, readGapReport } from './state.js';
import { getBudgetReport } from './token-tracker.js';
import { getLastCommitSha, getCurrentBranch, getUncommittedFiles, getFilesChangedSince } from './git.js';

function handoffsDir() {
  return join(process.cwd(), '.threadwork', 'workspace', 'handoffs');
}

function ensureDir() {
  mkdirSync(handoffsDir(), { recursive: true });
}

function nextHandoffFilename() {
  ensureDir();
  const today = new Date().toISOString().slice(0, 10);
  const existing = readdirSync(handoffsDir())
    .filter(f => f.startsWith(today) && f.endsWith('.md'));
  return `${today}-${existing.length + 1}.md`;
}

// ── Store Status (v0.2.0) ─────────────────────────────────────────────────────

/**
 * Get a brief Store status summary for inclusion in handoffs.
 * Shows entries added this session and proposals nearing the promotion threshold.
 * @returns {{ entriesAdded: number, approachingPromotion: string[] }}
 */
function getStoreStatusForHandoff() {
  const approaching = [];
  try {
    const proposalsDir = join(process.cwd(), '.threadwork', 'specs', 'proposals');
    if (existsSync(proposalsDir)) {
      const files = readdirSync(proposalsDir).filter(f => f.endsWith('.md'));
      for (const f of files) {
        try {
          const content = readFileSync(join(proposalsDir, f), 'utf8');
          if (content.includes('promoted: true')) continue;
          const confMatch = content.match(/confidence:\s*([\d.]+)/);
          const nameMatch = content.match(/specName:\s*([^\n]+)/);
          if (confMatch) {
            const conf = parseFloat(confMatch[1]);
            if (conf >= 0.5 && conf < 0.7) {
              approaching.push(`${nameMatch?.[1]?.trim() ?? f.replace('.md', '')} (confidence: ${conf.toFixed(2)})`);
            }
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* proposals dir may not exist */ }
  return { entriesAdded: 0, approachingPromotion: approaching };
}

// ── Generate ──────────────────────────────────────────────────────────────────

/**
 * Generate a 10-section handoff document and write checkpoint.
 * @param {object} sessionData
 * @param {string} sessionData.projectName
 * @param {number|string} sessionData.phaseAtStart
 * @param {number|string} sessionData.phaseAtEnd
 * @param {number|string} sessionData.milestoneAtStart
 * @param {number|string} sessionData.milestoneAtEnd
 * @param {string[]} sessionData.completedTasks  Array of "T-ID: description" strings
 * @param {string} sessionData.inProgressTask    Current task ID + description
 * @param {number} [sessionData.inProgressPct]
 * @param {string[]} sessionData.keyDecisions
 * @param {string} sessionData.sessionStartSha   Git SHA at session start
 * @param {object} sessionData.ralphResult       { passed: bool, lastRun: string }
 * @param {string} sessionData.nextAction        Recommended next action sentence
 * @param {string} sessionData.skillTier
 * @returns {string} Path to written handoff file
 */
export function generateHandoff(sessionData) {
  ensureDir();

  const now = new Date().toISOString();
  const filename = nextHandoffFilename();
  const filepath = join(handoffsDir(), filename);

  const {
    projectName = 'Unknown Project',
    phaseAtStart = '?',
    phaseAtEnd = '?',
    milestoneAtStart = '?',
    milestoneAtEnd = '?',
    completedTasks = [],
    inProgressTask = 'None',
    inProgressPct = null,
    keyDecisions = [],
    sessionStartSha = 'unknown',
    ralphResult = { passed: null, lastRun: 'Not run' },
    nextAction = 'Review current state and continue.',
    skillTier = 'advanced'
  } = sessionData;

  // Live data
  const branch = getCurrentBranch();
  const lastSha = getLastCommitSha();
  const uncommitted = getUncommittedFiles();
  const budgetReport = getBudgetReport();
  let filesModified = [];
  try {
    filesModified = getFilesChangedSince(sessionStartSha);
  } catch { /* git may not be available */ }

  // v0.2.0: Auto-populate decisions from plan XML <decisions> blocks
  let sessionDecisions = [];
  try {
    sessionDecisions = readSessionDecisions(sessionStartSha);
  } catch { /* state may not be initialized */ }

  // v0.3.0: Read model switch log for Section 6 inclusion
  const modelSwitchLines = [];
  try {
    const switchLogPath = join(process.cwd(), '.threadwork', 'state', 'model-switch-log.json');
    if (existsSync(switchLogPath)) {
      const switchLog = JSON.parse(readFileSync(switchLogPath, 'utf8'));
      const switches = switchLog.switches ?? [];
      if (switches.length > 0) {
        modelSwitchLines.push(`Model switches this session: ${switches.length}`);
        for (const sw of switches.slice(-5)) {
          modelSwitchLines.push(
            `  ${sw.task_id}: ${sw.from} → ${sw.to} (${sw.reason}, ${sw.policy} policy)`
          );
        }
      }
    }
  } catch { /* switch log may not exist */ }

  const resumePrompt = formatResumePrompt({
    projectName, phase: phaseAtEnd, milestone: milestoneAtEnd,
    date: now.slice(0, 10), branch, completedTaskIds: completedTasks.map(t => t.split(':')[0].trim()),
    inProgressTask, nextAction, budgetRemaining: budgetReport.session.remaining,
    sessionBudget: budgetReport.session.budget, skillTier
  });

  const sections = [
    `# Threadwork Session Handoff`,
    `**Generated**: ${now.replace('T', ' ').slice(0, 19)} UTC`,
    '',

    // Section 1
    `## 1. Session Overview`,
    `- **Date**: ${now.slice(0, 10)}`,
    `- **Project**: ${projectName}`,
    `- **Phase at start**: ${phaseAtStart} → **Phase at end**: ${phaseAtEnd}`,
    `- **Milestone at start**: ${milestoneAtStart} → **Milestone at end**: ${milestoneAtEnd}`,
    '',

    // Section 2
    `## 2. Completed This Session`,
    completedTasks.length > 0
      ? completedTasks.map(t => `- ${t}`).join('\n')
      : '_No tasks completed this session._',
    '',

    // Section 3
    `## 3. In Progress`,
    inProgressPct !== null
      ? `- ${inProgressTask} (~${inProgressPct}% complete)`
      : `- ${inProgressTask}`,
    '',

    // Section 4 — auto-populated from plan <decisions> blocks (v0.2.0),
    // falls back to manually provided keyDecisions if none from plans
    `## 4. Key Decisions Made`,
    sessionDecisions.length > 0
      ? sessionDecisions.map(d => `- **${d.choice}** (${d.taskId}): ${d.rationale}`).join('\n')
      : keyDecisions.length > 0
        ? keyDecisions.map(d => `- ${d}`).join('\n')
        : '_No architectural decisions recorded this session._',
    '',
    // Store status (v0.2.0)
    ...((() => {
      const storeStatus = getStoreStatusForHandoff();
      const lines = [`**Store entries added this session**: ${storeStatus.entriesAdded}`];
      if (storeStatus.approachingPromotion.length > 0) {
        lines.push(`**Proposals approaching promotion threshold**: ${storeStatus.approachingPromotion.slice(0, 2).join('; ')}`);
      }
      return lines;
    })()),
    '',

    // Section 4b — Environment Gaps Detected (v0.3.2)
    ...((() => {
      try {
        const gapReport = readGapReport();
        if (gapReport.length === 0) return [];
        const knowledgeGaps = gapReport.filter(g => g.type === 'knowledge_gap');
        const missingCaps = gapReport.filter(g => g.type === 'missing_capability');
        const lines = ['', `## 4b. Environment Gaps Detected`];
        if (knowledgeGaps.length > 0) {
          lines.push(`**Knowledge gaps** (${knowledgeGaps.length}): Agent lacked context that exists in the codebase`);
          knowledgeGaps.slice(0, 3).forEach(g => lines.push(`  - ${g.description ?? 'Unknown gap'}`));
        }
        if (missingCaps.length > 0) {
          lines.push(`**Missing capabilities** (${missingCaps.length}): Agent needed tooling that doesn't exist`);
          missingCaps.slice(0, 3).forEach(g => lines.push(`  - ${g.description ?? 'Unknown capability'}`));
        }
        lines.push('');
        return lines;
      } catch { return []; }
    })()),

    // Section 4c — Implementation Knowledge Discovered (v0.3.2)
    ...((() => {
      try {
        const notesPath = join(process.cwd(), '.threadwork', 'state', 'knowledge-notes.json');
        if (!existsSync(notesPath)) return [];
        const data = JSON.parse(readFileSync(notesPath, 'utf8'));
        const notes = data.notes ?? data ?? [];
        if (notes.length === 0) return [];
        const critical = notes.filter(n => n.critical);
        const promoted = notes.filter(n => n.promotedAt);
        const regular = notes.filter(n => !n.critical && !n.promotedAt);
        const lines = ['', `## 4c. Implementation Knowledge Discovered`];
        if (critical.length > 0) {
          lines.push(`**Critical notes** (${critical.length}):`);
          critical.slice(0, 3).forEach(n => lines.push(`  - [${n.noteId}] ${n.summary} (scope: ${n.scope || 'global'})`));
        }
        if (promoted.length > 0) {
          lines.push(`**Promoted to spec proposals** (${promoted.length}):`);
          promoted.slice(0, 2).forEach(n => lines.push(`  - [${n.noteId}] ${n.summary}`));
        }
        if (regular.length > 0) {
          lines.push(`**Other notes** (${regular.length} total, survived ${Math.max(...regular.map(n => n.sessionsSurvived ?? 0))} sessions max)`);
        }
        lines.push('');
        return lines;
      } catch { return []; }
    })()),

    // Section 5
    `## 5. Files Modified`,
    filesModified.length > 0
      ? filesModified.map(f => `- ${f}`).join('\n')
      : '_No file changes detected via git diff._',
    '',

    // Section 6
    `## 6. Token Usage`,
    `- Session budget: ${(budgetReport.session.budget / 1000).toFixed(0)}K`,
    `- Used: ${(budgetReport.session.used / 1000).toFixed(0)}K (${budgetReport.session.percent}%)`,
    `- Remaining: ${(budgetReport.session.remaining / 1000).toFixed(0)}K`,
    ...(budgetReport.tasks.length > 0 ? [
      '',
      '| Task | Estimated | Actual | Variance | Rating |',
      '|------|-----------|--------|----------|--------|',
      ...budgetReport.tasks.slice(-5).map(t =>
        `| ${t.id} | ${(t.estimated/1000).toFixed(0)}K | ${(t.actual/1000).toFixed(0)}K | ${t.variance} | ${t.rating} |`
      )
    ] : []),
    '',
    // v0.3.0: Model switch summary (read from switch log file directly)
    ...modelSwitchLines,

    // Section 7
    `## 7. Git State`,
    `- **Branch**: ${branch}`,
    `- **Last commit**: ${lastSha}`,
    `- **Uncommitted files**: ${uncommitted.length > 0 ? uncommitted.map(f => `\`${f}\``).join(', ') : 'None'}`,
    '',

    // Section 8
    `## 8. Quality Gate Status`,
    ralphResult.passed === true
      ? `✅ All gates passed — last run: ${ralphResult.lastRun}`
      : ralphResult.passed === false
        ? `❌ Gates failed — last run: ${ralphResult.lastRun}`
        : `⚪ Not run this session`,
    '',

    // Section 9
    `## 9. Recommended Next Action`,
    nextAction,
    '',

    // Section 10
    `## 10. Resume Prompt`,
    '```',
    resumePrompt,
    '```',
    ''
  ];

  writeFileSync(filepath, sections.join('\n'), 'utf8');

  // Also write machine-readable checkpoint
  writeCheckpoint({
    projectName, phase: phaseAtEnd, milestone: milestoneAtEnd,
    inProgressTask, branch, lastSha, uncommittedCount: uncommitted.length,
    tokenBudgetRemaining: budgetReport.session.remaining,
    sessionBudget: budgetReport.session.budget,
    skillTier, handoffFile: filename,
    nextAction, generatedAt: now
  });

  return filepath;
}

// ── Resume Prompt ─────────────────────────────────────────────────────────────

/**
 * Format the self-contained resume prompt block.
 * @param {object} data
 * @returns {string}
 */
export function formatResumePrompt(data) {
  const {
    projectName = 'Unknown',
    phase = '?',
    milestone = '?',
    date = new Date().toISOString().slice(0, 10),
    branch = 'unknown',
    completedTaskIds = [],
    inProgressTask = 'None',
    nextAction = 'Continue.',
    budgetRemaining = 0,
    sessionBudget = 800_000,
    skillTier = 'advanced'
  } = data;

  const remainK = Math.round(budgetRemaining / 1000);
  const totalK = Math.round(sessionBudget / 1000);
  const completedStr = completedTaskIds.length > 0 ? completedTaskIds.join(', ') : 'None';

  return [
    '── THREADWORK RESUME ──────────────────────────────',
    `Project: ${projectName} | Phase: ${phase} | Milestone: ${milestone}`,
    `Last session: ${date} | Branch: ${branch}`,
    `Completed: ${completedStr}`,
    `In progress: ${inProgressTask}`,
    `Next action: ${nextAction}`,
    `Token budget remaining: ${remainK}K / ${totalK}K`,
    `Skill tier: ${skillTier}`,
    '─────────────────────────────────────────────────',
    'Continue from where we left off. Load checkpoint and resume.',
    `Start with: ${nextAction}`
  ].join('\n');
}

// ── Read / List ───────────────────────────────────────────────────────────────

/**
 * Read the most recent handoff file as a string.
 * @returns {string|null}
 */
export function readLatestHandoff() {
  if (!existsSync(handoffsDir())) return null;
  const files = readdirSync(handoffsDir())
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  return readFileSync(join(handoffsDir(), files[0]), 'utf8');
}

/**
 * List all handoff files with dates.
 * @returns {Array<{ filename: string, date: string, path: string }>}
 */
export function listHandoffs() {
  if (!existsSync(handoffsDir())) return [];
  return readdirSync(handoffsDir())
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse()
    .map(f => ({
      filename: f,
      date: f.slice(0, 10),
      path: join(handoffsDir(), f)
    }));
}
