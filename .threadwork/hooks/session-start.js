#!/usr/bin/env node
/**
 * hooks/session-start.js — Session initialization hook
 *
 * Fires at every Claude Code SessionStart event.
 * Reads stdin (hook payload JSON), composes an orientation block,
 * and writes it back to stdout to inject into the system prompt.
 *
 * Execution target: < 500ms
 */

import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Hook must never crash the session
process.on('uncaughtException', (err) => {
  logHook('ERROR', `session-start uncaught: ${err.message}`);
  process.exit(0); // exit 0 = don't block session
});

function logHook(level, message) {
  try {
    const logDir = join(process.cwd(), '.threadwork', 'state');
    mkdirSync(logDir, { recursive: true });
    const line = JSON.stringify({ timestamp: new Date().toISOString(), level, hook: 'session-start', message }) + '\n';
    appendFileSync(join(logDir, 'hook-log.json'), line, 'utf8');
  } catch { /* log failures must never crash */ }
}

async function main() {
  // Read hook payload from stdin
  let payload = {};
  try {
    const raw = readFileSync(0, 'utf8').trim();
    if (raw) payload = JSON.parse(raw);
  } catch {
    // No stdin or malformed — continue with empty payload
  }

  // Check for --minimal mode flag
  const minimal = payload.minimal || process.argv.includes('--minimal');

  try {
    // Dynamic imports here to avoid crashing if .threadwork doesn't exist yet
    const [
      { readState },
      { readCheckpoint, checkpointExists },
      { readLatestJournal },
      { readLatestHandoff },
      { loadSpecIndex },
      { formatBudgetDashboard, resetSessionUsage, checkThresholds },
      { getTier, getTierInstructions, getWarningStyle }
    ] = await Promise.all([
      import('../lib/state.js'),
      import('../lib/state.js'),
      import('../lib/journal.js'),
      import('../lib/handoff.js'),
      import('../lib/spec-engine.js'),
      import('../lib/token-tracker.js'),
      import('../lib/skill-tier.js')
    ]);

    // Reset session usage tracking at session start
    resetSessionUsage();

    let projectName = 'Unknown Project';
    let currentPhase = 'unknown';
    let currentMilestone = 'unknown';
    let activeTask = 'None';
    let skillTier = 'advanced';
    let defaultContext = '200k';

    try {
      const state = readState();
      projectName = state.projectName ?? 'Unknown Project';
      currentPhase = state.currentPhase ?? 'unknown';
      currentMilestone = state.currentMilestone ?? 'unknown';
      activeTask = state.activeTask ?? 'None';
      skillTier = state.skillTier ?? 'advanced';
      defaultContext = state.default_context ?? '200k';
    } catch { /* project not yet initialized */ }

    if (minimal) {
      // Minimal mode: only project name and current task
      const block = `## Threadwork Context\n**Project**: ${projectName} | **Task**: ${activeTask}\n`;
      logHook('INFO', `session-start minimal mode: ${block.length} bytes`);
      process.stdout.write(JSON.stringify({ type: 'system', content: block }));
      return;
    }

    // Gather all context
    const latestJournal = readLatestJournal();
    const latestHandoff = readLatestHandoff();
    const specIndex = loadSpecIndex();
    const budgetDashboard = formatBudgetDashboard();
    const hasCheckpoint = checkpointExists();
    const tierInstructions = getTierInstructions(skillTier);

    // Extract last session summary from journal (first 3 non-empty lines after the header)
    let lastSessionSummary = '_No previous session recorded._';
    if (latestJournal) {
      const lines = latestJournal.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 3);
      lastSessionSummary = lines.join(' ').slice(0, 300);
    }

    const parts = [
      `## Threadwork — Session Context`,
      `**Project**: ${projectName} | **Phase**: ${currentPhase} | **Milestone**: ${currentMilestone}`,
      `**Active task**: ${activeTask}`,
      `**Context model**: ${defaultContext === '1m' ? 'Sonnet 1M (extended)' : 'Sonnet 200K (standard)'}`,
      '',
      `${budgetDashboard}`,
      ''
    ];

    // v0.3.0: High-context agent advisory
    try {
      const { getHighContextAgents } = await import('../lib/token-tracker.js');
      const highContextAgents = getHighContextAgents();
      if (highContextAgents.length > 0 && defaultContext === '200k') {
        const advisory = highContextAgents.slice(0, 2).map(a =>
          `Context advisory: Agent ${a.agentType} used ~${Math.round(a.tokens / 1000)}K tokens last session.`
        );
        advisory.push('Approaching 200K context limit. Consider 1M model for complex planning phases.');
        parts.push(...advisory, '');
      }
    } catch { /* token-tracker may not be initialized */ }

    if (hasCheckpoint) {
      let cp = {};
      try { cp = readCheckpoint(); } catch { /* ignore */ }
      parts.push(
        `> ⚠️ Recovery checkpoint found from ${cp._updated?.slice(0, 10) ?? 'previous session'}.`,
        `> Run \`/tw:resume\` to restore context, or \`/tw:recover\` if session was interrupted.`,
        ''
      );
    }

    parts.push(
      `### Last Session Summary`,
      lastSessionSummary,
      ''
    );

    if (specIndex) {
      parts.push(`### Active Spec Domains`, specIndex.slice(0, 800), '');
    }

    // v0.2.0: Store section (compact, ~50 tokens) — skip if budget > 80%
    const thresholds = checkThresholds();
    if (!thresholds.warning) {
      try {
        const { getStoreInjectionBlock } = await import('../lib/store.js');
        const storeBlock = getStoreInjectionBlock();
        if (storeBlock) {
          parts.push(storeBlock, '');
          logHook('INFO', 'session-start: Store section injected');
        }
      } catch { /* store module may not exist yet */ }
    } else {
      logHook('INFO', 'session-start: Store section skipped — budget above 80%');
    }

    // v0.3.2: Increment sessionsSurvived on all knowledge notes
    try {
      const { incrementSessionsSurvived, getCriticalNotes, buildKnowledgeNotesBlock } =
        await import('../lib/knowledge-notes.js');
      incrementSessionsSurvived();

      const criticalNotes = getCriticalNotes();
      if (criticalNotes.length > 0) {
        const notesBlock = buildKnowledgeNotesBlock('');
        if (notesBlock) {
          parts.push(`### Critical Implementation Notes`, notesBlock, '');
          logHook('INFO', `session-start: injected ${criticalNotes.length} critical knowledge notes`);
        }
      }
    } catch { /* knowledge-notes module not available */ }

    // v0.3.2: Inject recurring gap warnings (high-priority)
    try {
      const { aggregateGaps } = await import('../lib/state.js');
      const gaps = aggregateGaps();
      if (gaps.high.length > 0) {
        parts.push(`### ⚠️ Recurring Capability Gaps`);
        for (const gap of gaps.high.slice(0, 3)) {
          parts.push(`- **${gap.type}** (seen ${gap.count}x): ${gap.description}`);
        }
        parts.push('', 'These gaps have caused failures in previous sessions. Plan accordingly.', '');
        logHook('INFO', `session-start: injected ${gaps.high.length} high-priority gap warnings`);
      }
    } catch { /* gaps module not available */ }

    // v0.3.2: Autonomy mode summary
    try {
      const { getAutonomyLevel, getAutonomySummary } = await import('../lib/autonomy.js');
      const level = getAutonomyLevel();
      if (level !== 'supervised') {
        const summary = getAutonomySummary();
        parts.push(`### Autonomy Mode`, summary, '');
        logHook('INFO', `session-start: autonomy level=${level}`);
      }
    } catch { /* autonomy module not available */ }

    parts.push(tierInstructions);

    const orientationBlock = parts.join('\n');
    const bytesInjected = orientationBlock.length;

    logHook('INFO', `session-start injected ${bytesInjected} bytes | tier=${skillTier} | checkpoint=${hasCheckpoint}`);

    // Output in Claude Code hook format
    process.stdout.write(JSON.stringify({ type: 'system', content: orientationBlock }));

  } catch (err) {
    logHook('ERROR', `session-start failed: ${err.message}`);
    // Exit cleanly — don't block session
  }
}

main().catch((err) => {
  logHook('ERROR', `session-start async error: ${err.message}`);
  process.exit(0);
});
