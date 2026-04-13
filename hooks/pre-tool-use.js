#!/usr/bin/env node
/**
 * hooks/pre-tool-use.js — Subagent context injection hook
 *
 * Fires before every Task() call. Injects relevant specs, skill tier
 * instructions, and token budget status into the subagent prompt.
 *
 * Execution target: < 200ms
 */

import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

process.on('uncaughtException', (err) => {
  logHook('ERROR', `pre-tool-use uncaught: ${err.message}`);
  process.exit(0);
});

function logHook(level, message) {
  try {
    const logDir = join(process.cwd(), '.threadwork', 'state');
    mkdirSync(logDir, { recursive: true });
    const line = JSON.stringify({ timestamp: new Date().toISOString(), level, hook: 'pre-tool-use', message }) + '\n';
    appendFileSync(join(logDir, 'hook-log.json'), line, 'utf8');
  } catch { /* never crash */ }
}

async function main() {
  let payload = {};
  try {
    const raw = readFileSync(0, 'utf8').trim();
    if (raw) payload = JSON.parse(raw);
  } catch { /* malformed or empty stdin */ }

  // Act on Task() and TeamCreate tool calls
  const toolName = payload.tool_name ?? payload.toolName ?? '';
  const isTask = toolName === 'Task' || toolName === 'task';
  const isTeamCreate = toolName === 'TeamCreate';

  if (!isTask && !isTeamCreate) {
    // Pass through unchanged
    process.stdout.write(JSON.stringify(payload));
    return;
  }

  try {
    const [
      { buildRoutingMap, fetchSpecById, getRoutingMapTokens },
      { getTier, getTierInstructions, getWarningStyle },
      { formatBudgetDashboard, checkThresholds, recordSpecFetch, estimateTokens }
    ] = await Promise.all([
      import('../lib/spec-engine.js'),
      import('../lib/skill-tier.js'),
      import('../lib/token-tracker.js')
    ]);

    const tier = getTier();
    const tierInstructions = getTierInstructions(tier);
    const budgetDashboard = formatBudgetDashboard();
    const thresholds = checkThresholds();

    let budgetWarning = '';
    if (thresholds.critical) {
      budgetWarning = getWarningStyle('critical',
        'Token budget >90%. Finish current task and run /tw:done immediately.', tier);
    } else if (thresholds.warning) {
      budgetWarning = getWarningStyle('warning',
        'Token budget >80%. Wrap up after this task or start a new session.', tier);
    }

    // Intercept spec_fetch tool calls — return spec content as tool result
    if (toolName === 'spec_fetch') {
      const specId = payload.tool_input?.spec_id ?? payload.input?.spec_id ?? '';
      const specContent = fetchSpecById(specId);
      const tokens = estimateTokens(specContent);
      try { recordSpecFetch(specId, tokens); } catch { /* never crash */ }
      logHook('INFO', `pre-tool-use: spec_fetch ${specId} | ${tokens} tokens`);

      // v0.3.2: Check for design_refs in fetched spec and inject design block
      let resultContent = specContent;
      try {
        const { loadDesignRefs, resolveDesignRefsForFiles, buildDesignInjectionBlock } =
          await import('../lib/design-ref.js');
        const specsDir = join(process.cwd(), '.threadwork', 'specs');
        const allRefs = loadDesignRefs(specsDir, process.cwd());
        // Filter to refs belonging to this spec
        const specRefs = allRefs.filter(r => r.specId === specId && r.exists);
        if (specRefs.length > 0) {
          const designBlock = buildDesignInjectionBlock(specRefs, process.cwd());
          if (designBlock) resultContent = specContent + '\n\n' + designBlock;
        }
      } catch { /* design-ref not available — continue */ }

      // Return spec content as the tool result (intercept the call)
      process.stdout.write(JSON.stringify({ ...payload, intercept: true, result: resultContent }));
      return;
    }

    // Intercept knowledge_note virtual tool (v0.3.2)
    if (toolName === 'knowledge_note') {
      try {
        const { addNote } = await import('../lib/knowledge-notes.js');
        const noteData = payload.tool_input ?? payload.input ?? {};
        const noteId = addNote(noteData);
        logHook('INFO', `pre-tool-use: knowledge_note captured | ${noteId} | critical=${noteData.critical ?? false}`);
        process.stdout.write(JSON.stringify({
          ...payload,
          intercept: true,
          result: `Knowledge note captured: ${noteId}. It will be injected in future sessions and can be promoted to a spec.`
        }));
      } catch (err) {
        logHook('ERROR', `pre-tool-use: knowledge_note failed: ${err.message}`);
        process.stdout.write(JSON.stringify({
          ...payload,
          intercept: true,
          result: 'Knowledge note capture failed — note not saved.'
        }));
      }
      return;
    }

    // Intercept store_fetch tool calls — delegated to store module
    if (toolName === 'store_fetch') {
      try {
        const { readEntry } = await import('../lib/store.js');
        const entryId = payload.tool_input?.entry_id ?? payload.input?.entry_id ?? '';
        const entry = readEntry(entryId);
        logHook('INFO', `pre-tool-use: store_fetch ${entryId}`);
        process.stdout.write(JSON.stringify({ ...payload, intercept: true, result: entry }));
      } catch (err) {
        logHook('ERROR', `pre-tool-use: store_fetch failed: ${err.message}`);
        process.stdout.write(JSON.stringify(payload));
      }
      return;
    }

    if (isTeamCreate) {
      // Inject budget + tier context into TeamCreate description
      const toolInput = payload.tool_input ?? payload.input ?? {};
      if (toolInput.description !== undefined) {
        const teamContext = [
          `<!-- Threadwork Team Context -->`,
          tierInstructions,
          '',
          budgetDashboard,
          budgetWarning ? `\n${budgetWarning}` : ''
        ].filter(Boolean).join('\n').trim();

        payload.tool_input.description = toolInput.description + '\n\n' + teamContext;
        logHook('INFO', `pre-tool-use: injected team context into TeamCreate | tier=${tier}`);
      }
      process.stdout.write(JSON.stringify(payload));
      return;
    }

    // Task() injection path — v0.2.0: routing map instead of full spec injection
    const taskInput = payload.tool_input ?? payload.input ?? {};
    const taskDescription = taskInput.prompt ?? taskInput.description ?? taskInput.task ?? '';
    const agentType = taskInput.subagent_type ?? taskInput.agent_type ?? '';

    // Phase context from state (best-effort)
    let currentPhase = 1;
    try {
      const { getPhase } = await import('../lib/state.js');
      currentPhase = getPhase();
    } catch { /* state may not exist */ }

    // v0.3.0: Context advisory for high-complexity tasks when using 200K default
    let contextAdvisory = '';
    try {
      const { readState } = await import('../lib/state.js');
      const projectState = readState();
      const defaultContext = projectState.default_context ?? '200k';
      if (defaultContext === '200k') {
        const descLower = taskDescription.toLowerCase();
        const fileCountMatch = taskDescription.match(/(\d+)\s+files?/i);
        const fileCount = fileCountMatch ? parseInt(fileCountMatch[1], 10) : 0;
        const highComplexityAgent = agentType === 'tw-debugger' || agentType === 'tw-planner';
        const complexKeywords = ['refactor', 'architecture', 'migrate', 'redesign', 'debug', 'complex'];
        const hasComplexKeyword = complexKeywords.some(k => descLower.includes(k));
        if (fileCount >= 6 || highComplexityAgent || hasComplexKeyword) {
          contextAdvisory = [
            '⚠️ CONTEXT ADVISORY: This task has high complexity indicators (6+ files / architectural).',
            'If you encounter context limit issues, consider asking the user to switch to the 1M context model.',
            'Current default: Sonnet 200K.'
          ].join('\n');
        }
      }
    } catch { /* project.json may not exist */ }

    // Build compact routing map (~150 tokens) instead of full spec injection
    const routingMap = buildRoutingMap(taskDescription, currentPhase);
    const routingMapTokens = getRoutingMapTokens(routingMap);

    // Spec fetch tool definition injected into every agent
    const specFetchToolDef = [
      '<!-- spec_fetch tool available: call spec_fetch with spec_id to get full spec content -->',
      '<!-- store_fetch tool available: call store_fetch with entry_id to get Store entry -->',
      '<!-- knowledge_note tool available: call knowledge_note({category, scope, summary, evidence, critical}) to capture discoveries -->'
    ].join('\n');

    // Compose full injection prefix
    const injectionParts = [
      `<!-- Threadwork Context Injection (v0.3.2) -->`,
      contextAdvisory ? contextAdvisory : '',
      tierInstructions,
      '',
      budgetDashboard,
      budgetWarning ? `\n${budgetWarning}` : '',
      '',
      routingMap,
      '',
      specFetchToolDef
    ].filter(Boolean);

    const injectionPrefix = injectionParts.join('\n').trim();

    // Prepend injection to the task prompt
    if (taskInput.prompt !== undefined) {
      payload.tool_input.prompt = injectionPrefix + '\n\n---\n\n' + taskInput.prompt;
    } else if (taskInput.description !== undefined) {
      payload.tool_input.description = injectionPrefix + '\n\n---\n\n' + taskInput.description;
    }

    // v0.3.2: Model tier selection using plan complexity
    // Priority: 1. <complexity model="..."> from plan XML in prompt
    //            2. assessTask() 7-dimension scoring from description/files
    //            3. Keyword heuristics fallback (model-switcher.js)
    let complexityResult = null;
    let planModelFromXml = null;
    let extractedFiles = [];

    try {
      // 1. First: check if plan XML <complexity model="..."> is already in the prompt
      // This was written by tw-plan-phase Step 3b and carries the authoritative model rec
      const complexityMatch = taskDescription.match(/<complexity\s[^>]*model="([^"]+)"[^>]*>/i);
      if (complexityMatch) {
        planModelFromXml = complexityMatch[1]; // 'haiku' | 'sonnet' | 'opus'
        // Also extract confidence if present for logging
        const confidenceMatch = taskDescription.match(/confidence="(\d+)"/i);
        const confidence = confidenceMatch ? parseInt(confidenceMatch[1], 10) : null;
        const scoreMatch = taskDescription.match(/score="(\d+)"/i);
        const score = scoreMatch ? parseInt(scoreMatch[1], 10) : null;
        complexityResult = {
          modelRecommendation: planModelFromXml,
          confidence,
          adjustedScore: score,
          source: 'plan-xml'
        };
      }
    } catch { /* plan XML parsing failed — fall through to assessTask */ }

    // 2. If no plan XML complexity, run assessTask() on the description
    if (!complexityResult) {
      try {
        const { assessTask } = await import('../lib/complexity-assessor.js');

        // Try to extract files from the task prompt description
        const filesMatch = taskDescription.match(/files?[:\s]+([^\n]+)/i);
        if (filesMatch) {
          extractedFiles = filesMatch[1].split(/[,\s]+/).map(f => f.trim()).filter(f => f.length > 1);
        }

        complexityResult = assessTask({
          description: taskDescription,
          files: extractedFiles,
          phaseNumber: currentPhase
        });

        // If complexity assessment has low confidence, surface it in the advisory
        if (complexityResult.confidence < 60) {
          contextAdvisory = contextAdvisory
            ? `${contextAdvisory}\n⚠️ COMPLEXITY UNCERTAINTY (${complexityResult.confidence}%): ${complexityResult.confidenceJustification}. Consider clarifying with the user before execution.`
            : `⚠️ COMPLEXITY UNCERTAINTY (${complexityResult.confidence}%): ${complexityResult.confidenceJustification}. Consider clarifying before execution.`;
        }
      } catch { /* assessTask may not be available */ }
    }

    // v0.3.0 / v0.3.2: Model switch policy check
    // NOTE: always use 'auto' in the hook — notify/approve require interactive terminal
    // and would block for 10+ seconds, causing the hook to be killed before it writes output.
    try {
      const { getRecommendedModel, getAgentDefault, logSwitch } =
        await import('../lib/model-switcher.js');
      const fileCountMatch = taskDescription.match(/(\d+)\s+files?/i);
      const fileCount = fileCountMatch ? parseInt(fileCountMatch[1], 10) : (extractedFiles.length || 0);
      const recommendedModel = getRecommendedModel(taskDescription, fileCount, agentType, complexityResult);
      const agentDefault = getAgentDefault(agentType);

      // Always stamp tool_input.model so post-tool-use can track it for the token log
      if (payload.tool_input) {
        payload.tool_input.model = recommendedModel;
      }

      if (recommendedModel !== agentDefault) {
        const complexityNote = complexityResult
          ? complexityResult.source === 'plan-xml'
            ? `plan-xml model=${recommendedModel}`
            : `7-dim score=${complexityResult.adjustedScore} (${complexityResult.tier}, conf=${complexityResult.confidence}%)`
          : `file-count=${fileCount}`;
        logSwitch(agentDefault, recommendedModel, `agent-spawn-${Date.now()}`,
          `auto-recommended for ${agentType}`, false);
        logHook('INFO', `pre-tool-use: model switch ${agentDefault} → ${recommendedModel} for ${agentType} [${complexityNote}]`);
        process.stderr.write(
          `[Threadwork] Model switch: ${agentDefault} → ${recommendedModel} (${complexityNote})\n`
        );
      } else {
        logHook('INFO', `pre-tool-use: model confirmed ${recommendedModel} for ${agentType}`);
      }
    } catch { /* model-switcher errors must never block execution */ }

    logHook('INFO', `pre-tool-use: injected routing map (${routingMapTokens} tokens) | tier=${tier} | task="${taskDescription.slice(0, 60)}"`);

    process.stdout.write(JSON.stringify(payload));

  } catch (err) {
    logHook('ERROR', `pre-tool-use failed: ${err.message}`);
    // Pass through unchanged on failure
    process.stdout.write(JSON.stringify(payload));
  }
}

main().catch((err) => {
  logHook('ERROR', `pre-tool-use async error: ${err.message}`);
  process.stdout.write(JSON.stringify(payload ?? {}));
  process.exit(0);
});
