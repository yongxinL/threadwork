#!/usr/bin/env node
/**
 * hooks/subagent-stop.js — The Ralph Loop
 *
 * Fires when a subagent tries to stop (SubagentStop event).
 * Runs quality gates; if they fail, blocks completion and re-invokes
 * the agent with a correction prompt (tier-appropriate formatting).
 * Retries up to MAX_RETRIES times before escalating to user.
 *
 * Execution target: < 2s
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// MAX_RETRIES is now autonomy-level-aware; default remains 5 for supervised
const DEFAULT_MAX_RETRIES = 5;
const RALPH_STATE_PATH = () => join(process.cwd(), '.threadwork', 'state', 'ralph-state.json');

process.on('uncaughtException', (err) => {
  logHook('ERROR', `subagent-stop uncaught: ${err.message}`);
  // Allow completion on crash to avoid infinite loops
  process.stdout.write(JSON.stringify({ action: 'allow' }));
  process.exit(0);
});

function logHook(level, message) {
  try {
    const logDir = join(process.cwd(), '.threadwork', 'state');
    mkdirSync(logDir, { recursive: true });
    const line = JSON.stringify({ timestamp: new Date().toISOString(), level, hook: 'subagent-stop', message }) + '\n';
    appendFileSync(join(logDir, 'hook-log.json'), line, 'utf8');
  } catch { /* never crash */ }
}

function readRalphState() {
  const p = RALPH_STATE_PATH();
  if (!existsSync(p)) return { retries: 0, lastTaskId: null, lastUpdated: null, remediation_log: [] };
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    if (!data.remediation_log) data.remediation_log = [];
    return data;
  } catch { return { retries: 0, remediation_log: [] }; }
}

function writeRalphState(data) {
  mkdirSync(join(process.cwd(), '.threadwork', 'state'), { recursive: true });
  writeFileSync(RALPH_STATE_PATH(), JSON.stringify({
    _version: '1',
    _updated: new Date().toISOString(),
    ...data
  }, null, 2), 'utf8');
}

/**
 * Clear ralph-state but preserve the remediation_log by moving it to hook-log.json
 * under a ralph_loop_history key. Keeps the learning record across sessions.
 */
function clearRalphState() {
  const current = readRalphState();
  const remediationLog = current.remediation_log ?? [];

  if (remediationLog.length > 0) {
    try {
      const logDir = join(process.cwd(), '.threadwork', 'state');
      const hookLogPath = join(logDir, 'hook-log.json');
      // Append a history record to hook-log.json
      const historyLine = JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        hook: 'subagent-stop',
        message: 'ralph-state cleared',
        ralph_loop_history: remediationLog
      }) + '\n';
      appendFileSync(hookLogPath, historyLine, 'utf8');
    } catch { /* never crash */ }
  }

  writeRalphState({ retries: 0, lastTaskId: null, cleared: true, remediation_log: [] });
}

/**
 * Build the correction prompt from a structured remediation payload.
 * Includes primary violation, relevant spec, fix template, and raw failing errors.
 *
 * @param {object} rejectionPayload - Full rejection payload with remediation block
 * @param {string} tier - Skill tier
 * @returns {string}
 */
function buildRemediationPrompt(rejectionPayload, tier) {
  const { iteration, gates, remediation, maxRetries: payloadMax } = rejectionPayload;
  const maxRetries = payloadMax ?? DEFAULT_MAX_RETRIES;

  const failedGates = Object.entries(gates ?? {})
    .filter(([, v]) => v && !v.passed && !v.skipped)
    .map(([gate, v]) => {
      const errs = v.errors ?? v.failures ?? v.vulnerabilities ?? [];
      return `${gate.toUpperCase()}:\n${errs.slice(0, 5).map(e => `  ${e}`).join('\n')}`;
    });

  const parts = [
    `QUALITY GATE REJECTION (iteration ${iteration} of ${maxRetries})`,
    '',
    `Primary violation: ${remediation?.primary_violation ?? 'Unknown'}`,
  ];

  if (remediation?.relevant_spec && remediation.relevant_spec !== 'None identified') {
    parts.push(`Relevant spec: ${remediation.relevant_spec}`);
  }

  parts.push(`Fix required: ${remediation?.fix_template ?? 'Review gate output below.'}`);

  if (failedGates.length > 0) {
    parts.push('', 'Raw errors:', ...failedGates);
  }

  return parts.join('\n');
}

// ── Review helpers (v0.3.2) ───────────────────────────────────────────────────

async function getReviewConfig() {
  try {
    const { readFileSync: rfs, existsSync: efs } = await import('fs');
    const { join: joinPath } = await import('path');
    const statePath = joinPath(process.cwd(), '.threadwork', 'state', 'project.json');
    if (!efs(statePath)) return { enabled: false };
    const project = JSON.parse(rfs(statePath, 'utf8'));
    const review = project.review ?? {};
    return {
      enabled: review.enabled !== false && review.mode !== 'off',
      mode: review.mode ?? 'selective',
      triggers: review.triggers ?? { fileCount: 3, securityKeywords: true, newFiles: true }
    };
  } catch {
    return { enabled: false };
  }
}

function shouldRunReview(reviewConfig, payload, ralph) {
  if (!reviewConfig.enabled) return false;
  if (reviewConfig.mode === 'all') return true;
  if (reviewConfig.mode === 'off') return false;
  if ((ralph.reviewIterations ?? 0) >= 2) return false; // Max 2 review iterations

  // selective mode: check triggers
  const triggers = reviewConfig.triggers ?? {};
  const toolName = payload.tool_name ?? '';

  // If this is a Task tool completion with file changes
  if (toolName === 'Task' || toolName === 'Agent') {
    // Security keywords in task description
    if (triggers.securityKeywords) {
      const desc = (payload.tool_input?.description ?? '').toLowerCase();
      if (/auth|jwt|password|token|secret|key|encrypt|decrypt|sql|injection/.test(desc)) {
        return true;
      }
    }
    return triggers.newFiles === true; // default trigger for new files
  }

  return false;
}

async function runAgentReview(payload, tier) {
  // Spawn tw-reviewer as a subprocess via Claude Code's Agent tool pattern
  // In practice, the reviewer is invoked via the harness — here we do a lightweight check
  // by looking at changed files. A full agent spawn is coordinated by the executor context.
  // This stub returns null (no blocking) unless future integration adds full spawn.
  try {
    const reviewerPath = join(process.cwd(), 'templates', 'agents', 'tw-reviewer.md');
    const { existsSync: efs } = await import('fs');
    if (!efs(reviewerPath)) return null;
    // In hooks context, we can't spawn a full agent synchronously within 2s
    // The reviewer integration is handled via the TaskStop event, not here.
    // Return null to proceed to quality gates.
    return null;
  } catch {
    return null;
  }
}

function buildReviewPrompt(reviewFeedback) {
  if (!reviewFeedback) return '';
  const issues = reviewFeedback.issues ?? [];
  const lines = [
    'CODE REVIEW FEEDBACK (tw-reviewer)',
    '',
    'The code reviewer found issues that must be addressed before quality gates run:',
    ''
  ];
  for (const issue of issues.slice(0, 5)) {
    lines.push(`- ${issue.type ?? 'issue'}: ${issue.message ?? issue}`);
    if (issue.file) lines.push(`  File: ${issue.file}`);
  }
  lines.push('');
  lines.push('Please address all review issues and re-submit.');
  return lines.join('\n');
}

async function main() {
  let payload = {};
  try {
    const raw = readFileSync(0, 'utf8').trim();
    if (raw) payload = JSON.parse(raw);
  } catch { /* empty stdin */ }

  // Determine agent type from payload
  const agentType = payload.agent_type ?? payload.subagent_type ?? '';
  const agentName = payload.agent_name ?? '';

  // Skip quality gates for non-code agents (coordinators, planners, etc.)
  const nonCodeAgents = [
    'planner', 'researcher', 'verifier', 'dispatch', 'spec-writer',
    'tw-planner', 'tw-researcher', 'tw-verifier', 'tw-dispatch', 'tw-spec-writer',
    'tw-orchestrator'  // Team model orchestrator — coordinates, does not write code
  ];
  const isNonCode = nonCodeAgents.some(a => agentType.includes(a) || agentName.includes(a));

  if (isNonCode) {
    clearRalphState();
    process.stdout.write(JSON.stringify({ action: 'allow' }));
    return;
  }

  // Log team context if a team session is active
  try {
    const { readTeamSession } = await import('../lib/state.js');
    const teamSession = readTeamSession();
    if (teamSession && !teamSession.cleared && teamSession.status === 'active') {
      logHook('INFO', `subagent-stop: team=${teamSession.teamName} worker=${agentName || agentType}`);
    }
  } catch { /* never crash */ }

  try {
    const { runAll, buildRemediationBlock, classifyFailure } = await import('../lib/quality-gate.js');
    const { getTier, getWarningStyle } = await import('../lib/skill-tier.js');
    const specEngine = await import('../lib/spec-engine.js');

    const tier = getTier();
    const ralph = readRalphState();

    // ── Autonomy level (v0.3.2) ──────────────────────────────────────────────
    let maxRetries = DEFAULT_MAX_RETRIES;
    let autonomyLevel = 'supervised';
    try {
      const { getAutonomyLevel, getMaxRetries } = await import('../lib/autonomy.js');
      autonomyLevel = getAutonomyLevel();
      maxRetries = getMaxRetries(autonomyLevel);
    } catch { /* use defaults */ }

    // ── tw-reviewer pre-gate review (v0.3.2) ──────────────────────────────────
    let reviewFeedback = null;
    try {
      const reviewConfig = await getReviewConfig();
      if (reviewConfig.enabled && shouldRunReview(reviewConfig, payload, ralph)) {
        reviewFeedback = await runAgentReview(payload, tier);
        if (reviewFeedback?.decision === 'request_changes' && (ralph.reviewIterations ?? 0) < 2) {
          // Send review feedback to executor for revision before running gates
          writeRalphState({
            ...ralph,
            reviewIterations: (ralph.reviewIterations ?? 0) + 1,
            lastUpdated: new Date().toISOString()
          });
          logHook('INFO', `subagent-stop: reviewer requested changes (iteration ${(ralph.reviewIterations ?? 0) + 1}/2)`);
          const reviewPrompt = buildReviewPrompt(reviewFeedback);
          process.stdout.write(JSON.stringify({
            action: 'block',
            retry: true,
            message: reviewPrompt,
            retryCount: ralph.reviewIterations ?? 0,
            maxRetries: 2
          }));
          return;
        }
      }
    } catch { /* reviewer not available — proceed to quality gates */ }

    // ── Quality gates ─────────────────────────────────────────────────────────
    const gateResult = await runAll({ skipCache: true });

    if (gateResult.passed) {
      // All gates pass — allow completion
      clearRalphState();
      logHook('INFO', `subagent-stop: gates PASSED | tier=${tier} | autonomy=${autonomyLevel}`);
      process.stdout.write(JSON.stringify({ action: 'allow' }));
      return;
    }

    // Gates failed
    const retries = (ralph.retries ?? 0) + 1;

    if (retries > maxRetries) {
      // Escalate to user (or skip-and-log in autonomous mode)
      const failedGates = gateResult.results.filter(r => !r.passed && !r.skipped).map(r => r.gate);

      if (autonomyLevel === 'autonomous') {
        // In autonomous mode: log and allow rather than block indefinitely
        logHook('WARNING', `subagent-stop: max retries (${maxRetries}) in autonomous mode — skip-and-log | gates=${failedGates.join(',')}`);
        clearRalphState();
        process.stdout.write(JSON.stringify({
          action: 'allow',
          note: `Autonomous skip after ${maxRetries} retries — gates still failing: ${failedGates.join(', ')}`
        }));
        return;
      }

      const escalation = getWarningStyle('critical',
        `Quality gates failed after ${maxRetries} retries: ${failedGates.join(', ')}. Manual intervention required.`,
        tier
      );
      logHook('ERROR', `subagent-stop: max retries reached (${maxRetries}) | gates=${failedGates.join(',')}`);

      process.stderr.write(`\n${escalation}\n`);
      clearRalphState();
      // Allow completion to unblock — user must resolve manually
      process.stdout.write(JSON.stringify({ action: 'allow', escalation }));
      return;
    }

    // Build structured remediation block
    const remediation = buildRemediationBlock(gateResult, specEngine, tier);

    // ── Failure classification (v0.3.2) ──────────────────────────────────────
    let classification = { type: 'code_bug', confidence: 0.3, evidence: '', recommendation: '' };
    try {
      classification = classifyFailure(gateResult, specEngine);
    } catch { /* never crash */ }

    // Classification-aware behavior
    let extraPromptContext = '';
    if (classification.type === 'missing_capability') {
      // Log gap and allow completion — don't waste retries on missing tooling
      try {
        const { appendGapReport } = await import('../lib/state.js');
        appendGapReport({
          type: 'missing_capability',
          description: classification.evidence,
          gate: gateResult.results.find(r => !r.passed && !r.skipped)?.gate,
          iteration: retries
        });
      } catch { /* never crash */ }
      clearRalphState();
      logHook('WARNING', `subagent-stop: missing_capability detected — skip retry | ${classification.evidence.slice(0, 80)}`);
      process.stdout.write(JSON.stringify({
        action: 'allow',
        note: `Missing capability: ${classification.evidence.slice(0, 200)}`
      }));
      return;
    }

    if (classification.type === 'knowledge_gap' && classification.relatedSpecId) {
      // Inject missing spec into this retry prompt
      try {
        const specContent = specEngine.fetchSpecById(classification.relatedSpecId);
        extraPromptContext = `\n\nRELEVANT SPEC (you should have fetched this before implementing):\n${specContent.slice(0, 2000)}`;
      } catch { /* never crash */ }

      try {
        const { appendGapReport } = await import('../lib/state.js');
        appendGapReport({
          type: 'knowledge_gap',
          description: `Spec ${classification.relatedSpecId} was relevant but not fetched`,
          gate: gateResult.results.find(r => !r.passed && !r.skipped)?.gate,
          iteration: retries
        });
      } catch { /* never crash */ }
    }

    // Build structured rejection payload
    const gatesMap = {};
    for (const r of gateResult.results) {
      gatesMap[r.gate] = {
        passed: r.passed,
        skipped: r.skipped ?? false,
        errors: r.errors ?? r.failures ?? r.vulnerabilities ?? r.violations?.map(v => v.message) ?? []
      };
    }
    const rejectionPayload = {
      status: 'rejected',
      iteration: retries,
      gates: gatesMap,
      remediation,
      maxRetries
    };

    // Append to remediation_log (preserved on clear)
    const remediationLog = ralph.remediation_log ?? [];
    remediationLog.push({
      iteration: retries,
      timestamp: new Date().toISOString(),
      primary_violation: remediation.primary_violation,
      relevant_spec: remediation.relevant_spec,
      learning_signal: remediation.learning_signal,
      classification: classification.type,
      evidence: classification.evidence,
      proposal_queued: false
    });

    // Queue learning signal as spec proposal — use classification-aware confidence
    let proposalQueued = false;
    if (classification.type !== 'missing_capability') {
      try {
        const { proposeSpecUpdate } = await import('../lib/spec-engine.js');
        const initialConfidence = (classification.type === 'knowledge_gap' || classification.type === 'architectural_violation')
          ? 0.5 : 0.3;
        proposeSpecUpdate(
          `auto/${gateResult.results.find(r => !r.passed && !r.skipped)?.gate ?? 'unknown'}`,
          `# Auto-Detected Quality Pattern\n\n${remediation.learning_signal}`,
          remediation.learning_signal,
          {
            source: 'ralph-loop',
            learningSignal: remediation.learning_signal,
            initialConfidence
          }
        );
        proposalQueued = true;
        remediationLog[remediationLog.length - 1].proposal_queued = true;
      } catch { /* spec engine may not be ready */ }
    }

    // Write updated ralph state
    writeRalphState({
      retries,
      lastUpdated: new Date().toISOString(),
      remediation_log: remediationLog,
      reviewIterations: 0  // reset review iterations on gate failure
    });

    // Build correction prompt from structured payload
    let correctionPrompt = buildRemediationPrompt(rejectionPayload, tier);
    if (extraPromptContext) correctionPrompt += extraPromptContext;

    logHook('WARNING', `subagent-stop: gates FAILED (retry ${retries}/${maxRetries}) | tier=${tier} | classification=${classification.type} | proposal=${proposalQueued} | violation="${remediation.primary_violation.slice(0, 60)}"`);

    // Block completion and re-invoke with remediation-injected correction
    process.stdout.write(JSON.stringify({
      action: 'block',
      retry: true,
      message: correctionPrompt,
      retryCount: retries,
      maxRetries,
      remediation,
      classification: classification.type
    }));

  } catch (err) {
    logHook('ERROR', `subagent-stop quality gate error: ${err.message}`);
    // Allow completion on error to prevent infinite blocking
    process.stdout.write(JSON.stringify({ action: 'allow' }));
  }
}

main().catch((err) => {
  logHook('ERROR', `subagent-stop async error: ${err.message}`);
  process.stdout.write(JSON.stringify({ action: 'allow' }));
  process.exit(0);
});
