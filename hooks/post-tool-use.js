#!/usr/bin/env node
/**
 * hooks/post-tool-use.js — Learning capture + token tracking + checkpoint
 *
 * Fires after every tool call completes. Detects learning signals,
 * proposes spec updates, tracks tokens, and writes checkpoint.
 *
 * Execution target: < 100ms (defer heavy work to async queues)
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

process.on('uncaughtException', (err) => {
  logHook('ERROR', `post-tool-use uncaught: ${err.message}`);
  process.exit(0);
});

function logHook(level, message) {
  try {
    const logDir = join(process.cwd(), '.threadwork', 'state');
    mkdirSync(logDir, { recursive: true });
    const line = JSON.stringify({ timestamp: new Date().toISOString(), level, hook: 'post-tool-use', message }) + '\n';
    appendFileSync(join(logDir, 'hook-log.json'), line, 'utf8');
  } catch { /* never crash */ }
}

/** Estimate tokens used by a tool call from its input/output sizes */
function estimateToolTokens(toolInput, toolOutput) {
  const inputSize = JSON.stringify(toolInput ?? {}).length;
  const outputSize = JSON.stringify(toolOutput ?? {}).length;
  return Math.ceil((inputSize + outputSize) / 4);
}

/**
 * Detect learning signals from tool call result.
 * Returns array of { type, content, confidence } proposals.
 */
function detectLearningSignals(toolName, toolOutput) {
  const signals = [];
  const outputStr = JSON.stringify(toolOutput ?? '').toLowerCase();

  // Lint error fixed
  if ((toolName === 'Edit' || toolName === 'Write') &&
      (outputStr.includes('eslint') || outputStr.includes('lint error'))) {
    signals.push({
      type: 'lint-fix',
      confidence: 0.3,
      content: `Lint error detected and fixed in ${toolName} call`
    });
  }

  // TypeScript error corrected
  if (outputStr.includes('ts error') || outputStr.includes('type error') ||
      outputStr.includes('error ts')) {
    signals.push({
      type: 'typescript-fix',
      confidence: 0.3,
      content: 'TypeScript error pattern corrected'
    });
  }

  // Test caught a bug
  if ((toolName === 'Bash') && outputStr.includes('test') &&
      (outputStr.includes('fail') || outputStr.includes('pass'))) {
    signals.push({
      type: 'test-pattern',
      confidence: 0.4,
      content: 'Test execution result captured'
    });
  }

  return signals;
}

async function main() {
  const start = Date.now();
  let payload = {};
  try {
    const raw = readFileSync(0, 'utf8').trim();
    if (raw) payload = JSON.parse(raw);
  } catch { /* malformed or empty stdin */ }

  // Pass through immediately (we operate on side-effects, not payload modification)
  process.stdout.write(JSON.stringify(payload));

  // All remaining work is deferred (async, non-blocking for output)
  setImmediate(async () => {
    try {
      const toolName = payload.tool_name ?? payload.toolName ?? '';
      const toolInput = payload.tool_input ?? payload.input ?? {};
      const toolOutput = payload.tool_result ?? payload.result ?? {};

      // 1. Estimate token usage for this tool call
      const tokensUsed = estimateToolTokens(toolInput, toolOutput);

      // 2. Record usage
      try {
        const { recordUsage, checkThresholds, getSessionUsed } = await import('../lib/token-tracker.js');
        const taskId = `tool-${toolName}-${Date.now()}`;
        const model = toolInput.model ?? 'sonnet';
        recordUsage(taskId, tokensUsed, tokensUsed, model);

        // 3. Check thresholds and emit visible warnings
        const thresholds = checkThresholds();
        const used = getSessionUsed();
        const usedK = Math.round(used / 1000);

        if (thresholds.critical) {
          // Emit to stderr — visible to user in Claude Code terminal
          process.stderr.write(
            `\n🚨 [THREADWORK] Token budget CRITICAL: ${usedK}K used. ` +
            `Run /tw:done NOW to generate handoff before context is lost.\n`
          );
          logHook('CRITICAL', `Token budget critical: ${usedK}K used`);
        } else if (thresholds.warning) {
          process.stderr.write(
            `\n⚠️ [THREADWORK] Token budget at 80%+: ${usedK}K used. ` +
            `Consider wrapping up after the current task.\n`
          );
          logHook('WARNING', `Token budget warning: ${usedK}K used`);
        }
      } catch { /* token tracker not initialized */ }

      // 4. Detect learning signals and write proposals
      const signals = detectLearningSignals(toolName, toolOutput);
      if (signals.length > 0) {
        try {
          const { proposeSpecUpdate } = await import('../lib/spec-engine.js');
          for (const signal of signals) {
            proposeSpecUpdate(
              `auto/${signal.type}`,
              `# Auto-Detected Pattern\n\n${signal.content}`,
              `Auto-detected from ${toolName} call (confidence: ${signal.confidence})`
            );
          }
        } catch { /* spec engine may not be ready */ }
      }

      // 5. Write checkpoint
      let currentState = {};
      try {
        const { getGitInfo, writeCheckpoint, readState } = await import('../lib/state.js');
        const gitInfo = getGitInfo();
        try { currentState = readState(); } catch { /* ok */ }
        writeCheckpoint({
          phase: currentState.currentPhase,
          milestone: currentState.currentMilestone,
          activeTask: currentState.activeTask,
          branch: gitInfo.branch,
          lastSha: gitInfo.sha,
          uncommittedCount: gitInfo.uncommitted.length,
          updatedByHook: 'post-tool-use'
        });
      } catch { /* state may not exist */ }

      // 6. Wave-completion detection — spawn entropy collector if wave is done
      try {
        const { isWaveComplete, readExecutionLog, getWaveDiff, loadTasteInvariants, listEntropyReports } =
          await import('../lib/entropy-collector.js');

        const phaseId = currentState.currentPhase ?? 1;
        const waveId = currentState.currentWave ?? 1;

        // Use a simple flag file to prevent duplicate spawns within the same wave
        const flagPath = join(process.cwd(), '.threadwork', 'state', `entropy-running-wave-${waveId}.flag`);
        const execLog = readExecutionLog(phaseId);

        if (execLog && isWaveComplete(execLog) && !existsSync(flagPath)) {
          // Mark that collector is running for this wave
          try {
            mkdirSync(join(process.cwd(), '.threadwork', 'state'), { recursive: true });
            writeFileSync(flagPath, new Date().toISOString(), 'utf8');
          } catch { /* never crash */ }

          const waveDiff = getWaveDiff(waveId, phaseId);
          const tasteInvariants = loadTasteInvariants();
          const previousReports = listEntropyReports(phaseId);

          logHook('INFO', `post-tool-use: wave ${waveId} complete — spawning entropy collector`);

          // Entropy collector agent spawn is handled by Claude Code's Task() mechanism.
          // We log the trigger; the actual spawn happens via the session-level orchestrator
          // or the developer's /tw:execute-phase command which watches for this flag.
          logHook('INFO', `post-tool-use: entropy-trigger | wave=${waveId} | phase=${phaseId} | diff=${waveDiff.length} chars | invariants=${tasteInvariants.length}`);
        }
      } catch { /* entropy collector module may not exist yet */ }

      // 7. Spec staleness tracking (v0.3.2) — track file changes against spec references
      if ((toolName === 'Edit' || toolName === 'Write') && toolInput?.file_path) {
        try {
          const { trackSpecStaleness } = await import('../lib/spec-engine.js');
          const { relative } = await import('path');
          const relPath = relative(process.cwd(), toolInput.file_path);
          trackSpecStaleness(relPath);
        } catch { /* never crash */ }
      }

      // 8. Knowledge note freshness tracking (v0.3.2) — increment sessions survived
      // (done in session-start.js, not here)

      // 9. Autonomy auto-handoff at 95% budget (v0.3.2)
      try {
        const { getAutonomyLevel, shouldAutoChainSessions } = await import('../lib/autonomy.js');
        const level = getAutonomyLevel();
        if (shouldAutoChainSessions(level)) {
          const { checkThresholds } = await import('../lib/token-tracker.js');
          const thresholds = checkThresholds();
          if (thresholds.critical) {
            logHook('INFO', `post-tool-use: autonomous mode — budget critical, triggering auto-handoff signal`);
            // Write handoff trigger flag
            try {
              mkdirSync(join(process.cwd(), '.threadwork', 'state'), { recursive: true });
              writeFileSync(
                join(process.cwd(), '.threadwork', 'state', 'auto-handoff.flag'),
                new Date().toISOString(),
                'utf8'
              );
            } catch { /* never crash */ }
          }
        }
      } catch { /* autonomy module not available */ }

      // 10. Store promotion pipeline — runs at session end (Task tool final completion)
      if (toolName === 'Task' && (toolOutput?.status === 'completed' || toolOutput?.done === true)) {
        try {
          const { promoteToStore } = await import('../lib/store.js');
          const { readdirSync: rds, readFileSync: rfs, existsSync: efs } = await import('fs');
          const { join: pj } = await import('path');
          const proposalsDir = pj(process.cwd(), '.threadwork', 'specs', 'proposals');
          if (efs(proposalsDir)) {
            const proposals = rds(proposalsDir).filter(f => f.endsWith('.md'));
            for (const pf of proposals) {
              try {
                const content = rfs(pj(proposalsDir, pf), 'utf8');
                const confMatch = content.match(/confidence:\s*([\d.]+)/);
                const promotedMatch = content.includes('promoted: true');
                if (confMatch && !promotedMatch) {
                  const conf = parseFloat(confMatch[1]);
                  if (conf >= 0.7) {
                    promoteToStore({ filePath: pj(proposalsDir, pf), content });
                    logHook('INFO', `post-tool-use: promoted proposal ${pf} to Store (confidence ${conf})`);
                  }
                }
              } catch { /* skip */ }
            }
          }
        } catch { /* store module may not exist yet */ }
      }

      const elapsed = Date.now() - start;
      logHook('INFO', `post-tool-use: ${toolName} | ${tokensUsed} tokens | ${elapsed}ms`);

    } catch (err) {
      logHook('ERROR', `post-tool-use deferred error: ${err.message}`);
    }
  });
}

main().catch((err) => {
  logHook('ERROR', `post-tool-use async error: ${err.message}`);
  process.exit(0);
});
