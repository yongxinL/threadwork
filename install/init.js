/**
 * install/init.js — threadwork init implementation
 *
 * Asks 6 setup questions, scaffolds .threadwork/, registers hooks,
 * installs commands and agents.
 */

import { createInterface } from 'readline';
import { mkdirSync, writeFileSync, existsSync, cpSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { detectRuntime } from '../lib/runtime.js';
import { installClaudeCode, writeGitignoreBlock } from './claude-code.js';
import { installCodex } from './codex.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

/**
 * Run the interactive init flow.
 * @param {{ runtime: string, global: boolean, dryRun: boolean }} options
 */
export async function runInit(options) {
  const cwd = process.cwd();
  const { dryRun } = options;
  const isDryRun = dryRun;

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   Threadwork — Project Setup             ║');
  console.log('╚══════════════════════════════════════════╝\n');

  if (isDryRun) {
    console.log('🔍 DRY RUN — no files will be written\n');
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    // Detect runtime
    let runtime = options.runtime === 'auto' ? detectRuntime() : options.runtime;
    if (runtime === 'unknown') {
      console.log('⚠️ Could not auto-detect runtime. Defaulting to claude-code.');
      runtime = 'claude-code';
    }
    console.log(`✓ Detected runtime: ${runtime}\n`);

    // ── Question 1: Project name ───────────────────────────────────────────
    const projectName = await ask(rl, '1. Project name: ');

    // ── Question 2: Tech stack ─────────────────────────────────────────────
    console.log('\n2. Tech stack (choose or enter your own):');
    console.log('   1) Next.js + TypeScript');
    console.log('   2) React + Vite + TypeScript');
    console.log('   3) Express + Node.js');
    console.log('   4) FastAPI + Python');
    console.log('   5) Other (describe)');
    const stackAnswer = await ask(rl, '   Choice or description: ');
    const stackMap = {
      '1': 'Next.js + TypeScript',
      '2': 'React + Vite + TypeScript',
      '3': 'Express + Node.js',
      '4': 'FastAPI + Python'
    };
    const techStack = stackMap[stackAnswer.trim()] ?? stackAnswer.trim();

    // ── Question 3: Quality thresholds ───────────────────────────────────
    console.log('\n3. Quality thresholds:');
    const coverageAnswer = await ask(rl, '   Minimum test coverage % (default: 80): ');
    const minCoverage = parseInt(coverageAnswer.trim() || '80', 10) || 80;

    console.log('   Lint rules:');
    console.log('   1) Strict (0 warnings allowed)');
    console.log('   2) Standard (up to 10 warnings)');
    console.log('   3) Relaxed (errors only)');
    const lintAnswer = await ask(rl, '   Choice (default: 1): ');
    const lintMap = { '1': 'strict', '2': 'standard', '3': 'relaxed' };
    const lintLevel = lintMap[lintAnswer.trim() || '1'] ?? 'strict';

    // ── Question 4: Team mode ─────────────────────────────────────────────
    console.log('\n4. Parallel execution mode (controls how /tw:execute-phase runs):');
    console.log('   1) Legacy   — single-agent execution, safe & predictable (lower token cost)');
    console.log('   2) Auto     — system decides per-wave based on plan count & budget (recommended)');
    console.log('   3) Team     — always use Claude Code Team model when possible (fastest, higher token cost)');
    const teamAnswer = await ask(rl, '   Choice (default: 2): ');
    const teamMap = { '1': 'legacy', '2': 'auto', '3': 'team' };
    const teamMode = teamMap[teamAnswer.trim() || '2'] ?? 'auto';

    let maxWorkers = 'auto';
    if (teamMode !== 'legacy') {
      const maxWorkersAnswer = await ask(rl, '   Max workers per wave? (default: auto = use tier limit): ');
      const parsed = parseInt(maxWorkersAnswer.trim(), 10);
      maxWorkers = (!isNaN(parsed) && parsed >= 1 && parsed <= 10) ? parsed : 'auto';
    }

    // ── Question 5: Skill tier ─────────────────────────────────────────────
    console.log('\n5. Skill tier (controls AI output verbosity):');
    console.log('   1) Beginner  — step-by-step explanations, inline comments');
    console.log('   2) Advanced  — concise, professional (recommended)');
    console.log('   3) Ninja     — code only, zero narration');
    const tierAnswer = await ask(rl, '   Choice (default: 2): ');
    const tierMap = { '1': 'beginner', '2': 'advanced', '3': 'ninja' };
    const skillTier = tierMap[tierAnswer.trim() || '2'] ?? 'advanced';

    // ── Question 6: Context model ──────────────────────────────────────────
    console.log('\n6. Which Claude context model will you use by default?');
    console.log('   1) Sonnet 200K — standard, recommended');
    console.log('   2) Sonnet 1M   — extended context, higher cost');
    const contextAnswer = await ask(rl, '   Choice (default: 1): ');
    const defaultContext = contextAnswer.trim() === '2' ? '1m' : '200k';

    // ── Question 7: Session token budget (calibrated per context choice) ──
    const defaultBudgetK = defaultContext === '1m' ? 800 : 400;
    console.log(`\n7. Session token budget (calibrated for ${defaultContext === '1m' ? '1M' : '200K'} model):`);
    console.log(`   Recommended default: ${defaultBudgetK}K`);
    const budgetAnswer = await ask(rl, `   Budget in thousands (default: ${defaultBudgetK}): `);
    const sessionBudget = (parseInt(budgetAnswer.trim() || String(defaultBudgetK), 10) || defaultBudgetK) * 1000;

    // ── Question 8: Cost budget ────────────────────────────────────────────
    console.log('\n8. Per-session cost budget:');
    const costAnswer = await ask(rl, '   Dollar amount (default: 5.00): ');
    const costBudget = parseFloat(costAnswer.trim() || '5.00') || 5.00;

    // ── Question 9: Model switch policy ───────────────────────────────────
    console.log('\n9. Model switch policy (when Threadwork recommends a model tier change):');
    console.log('   1) Auto    — switch automatically, notify after the fact');
    console.log('   2) Notify  — propose switch with 10-second countdown [RECOMMENDED]');
    console.log('   3) Approve — always ask for explicit confirmation');
    const switchPolicyDefaults = { 'ninja': '1', 'advanced': '2', 'beginner': '3' };
    const switchPolicyDefault = switchPolicyDefaults[skillTier] ?? '2';
    const switchPolicyAnswer = await ask(rl, `   Choice (default: ${switchPolicyDefault}): `);
    const switchPolicyMap = { '1': 'auto', '2': 'notify', '3': 'approve' };
    const modelSwitchPolicy = switchPolicyMap[switchPolicyAnswer.trim() || switchPolicyDefault] ?? 'notify';

    rl.close();

    // ── Confirm ───────────────────────────────────────────────────────────
    console.log('\n── Summary ──────────────────────────────────');
    console.log(`  Project:        ${projectName}`);
    console.log(`  Stack:          ${techStack}`);
    console.log(`  Coverage:       ${minCoverage}%  |  Lint: ${lintLevel}`);
    console.log(`  Team mode:      ${teamMode}${teamMode !== 'legacy' ? ` (max workers: ${maxWorkers})` : ''}`);
    console.log(`  Skill tier:     ${skillTier}`);
    console.log(`  Context model:  ${defaultContext === '1m' ? 'Sonnet 1M' : 'Sonnet 200K'}`);
    console.log(`  Token budget:   ${(sessionBudget / 1000).toFixed(0)}K`);
    console.log(`  Cost budget:    $${costBudget.toFixed(2)}`);
    console.log(`  Switch policy:  ${modelSwitchPolicy}`);
    console.log(`  Runtime:        ${runtime}`);
    console.log('─────────────────────────────────────────────\n');

    if (isDryRun) {
      console.log('DRY RUN complete — no files written.');
      return;
    }

    // ── Scaffold .threadwork/ ─────────────────────────────────────────────
    const dirs = [
      '.threadwork/state/phases',
      '.threadwork/logs',
      '.threadwork/specs/frontend',
      '.threadwork/specs/backend',
      '.threadwork/specs/testing',
      '.threadwork/specs/proposals',
      '.threadwork/workspace/journals',
      '.threadwork/workspace/handoffs',
      '.threadwork/workspace/archive',
      '.threadwork/worktrees'
    ];

    for (const dir of dirs) {
      mkdirSync(join(cwd, dir), { recursive: true });
    }

    // Write project.json
    const projectState = {
      _version: '0.3.0',
      _updated: new Date().toISOString(),
      projectName,
      techStack,
      currentPhase: 0,
      currentMilestone: 0,
      activeTask: null,
      skillTier,
      sessionBudget,
      session_token_budget: sessionBudget,
      default_context: defaultContext,
      cost_budget: costBudget,
      model_switch_policy: modelSwitchPolicy,
      teamMode,
      maxWorkers,
      qualityConfig: { minCoverage, lintLevel }
    };
    writeFileSync(
      join(cwd, '.threadwork', 'state', 'project.json'),
      JSON.stringify(projectState, null, 2)
    );

    // Write quality-config.json
    const qualityConfig = {
      _version: '1',
      typecheck: { enabled: true, blocking: true },
      lint: { enabled: true, blocking: lintLevel !== 'relaxed' },
      tests: { enabled: true, blocking: true, minCoverage },
      build: { enabled: false, blocking: false },
      security: { enabled: true, blocking: false },
      outputFilter: {
        enabled: true,
        maxFailures: 10,
        maxErrorsPerGroup: 3,
        maxLineLength: 200,
        strategies: {
          smartFiltering: true,
          grouping: true,
          truncation: true,
          deduplication: true
        }
      }
    };
    writeFileSync(
      join(cwd, '.threadwork', 'state', 'quality-config.json'),
      JSON.stringify(qualityConfig, null, 2)
    );

    // Write token-log.json
    const tokenLog = {
      _version: '1',
      _updated: new Date().toISOString(),
      sessionBudget,
      sessionUsed: 0,
      tasks: []
    };
    writeFileSync(
      join(cwd, '.threadwork', 'state', 'token-log.json'),
      JSON.stringify(tokenLog, null, 2)
    );

    // Copy hooks to .threadwork/hooks/
    const hooksDestDir = join(cwd, '.threadwork', 'hooks');
    mkdirSync(hooksDestDir, { recursive: true });
    const hooksSourceDir = join(__dirname, '..', 'hooks');
    if (existsSync(hooksSourceDir)) {
      for (const file of readdirSync(hooksSourceDir)) {
        if (file.endsWith('.js') && file !== 'test-harness.js') {
          cpSync(join(hooksSourceDir, file), join(hooksDestDir, file));
        }
      }
      // Also copy the lib/ directory needed by hooks
      const libDestDir = join(cwd, '.threadwork', 'lib');
      mkdirSync(libDestDir, { recursive: true });
      const libSourceDir = join(__dirname, '..', 'lib');
      if (existsSync(libSourceDir)) {
        cpSync(libSourceDir, libDestDir, { recursive: true });
      }

      // Copy node_modules needed by lib/ (e.g. gray-matter and its deps)
      const nmSourceDir = join(__dirname, '..', 'node_modules');
      const nmDestDir = join(cwd, '.threadwork', 'node_modules');
      if (existsSync(nmSourceDir)) {
        mkdirSync(nmDestDir, { recursive: true });
        cpSync(nmSourceDir, nmDestDir, { recursive: true });
      }
    }

    // Copy starter spec templates (core/ → project specs)
    const coreSpecsDir = join(__dirname, '..', 'templates', 'specs', 'core');
    if (existsSync(coreSpecsDir)) {
      cpSync(coreSpecsDir, join(cwd, '.threadwork', 'specs'), { recursive: true });
    }

    // Seed stack-matched learned specs from the Threadwork knowledge base
    const learnedDir = join(__dirname, '..', 'templates', 'specs', 'learned');
    if (existsSync(learnedDir)) {
      const stackLower = (techStack ?? '').toLowerCase();
      const stackTagMap = {
        'next.js': ['typescript', 'nextjs', 'react', 'prisma'],
        'nextjs': ['typescript', 'nextjs', 'react', 'prisma'],
        'react': ['typescript', 'react'],
        'express': ['typescript', 'express'],
        'fastapi': ['python', 'fastapi', 'pydantic'],
        'django': ['python', 'django'],
        'python': ['python'],
        'typescript': ['typescript'],
      };
      let matchTags = [];
      for (const [key, tags] of Object.entries(stackTagMap)) {
        if (stackLower.includes(key)) { matchTags = tags; break; }
      }

      // Copy learned specs whose tags overlap with project stack
      for (const subdir of ['patterns', 'anti-patterns', 'architecture']) {
        const srcDir = join(learnedDir, subdir);
        if (!existsSync(srcDir)) continue;
        for (const file of readdirSync(srcDir)) {
          if (!file.endsWith('.md')) continue;
          try {
            const raw = readFileSync(join(srcDir, file), 'utf8');
            // Quick tag extraction from frontmatter without full parser
            const tagMatch = raw.match(/tags:\s*\[([^\]]*)\]/);
            if (!tagMatch) continue;
            const fileTags = tagMatch[1].toLowerCase().split(',').map(t => t.trim());
            const isMatch = matchTags.length === 0 || fileTags.some(t => matchTags.includes(t));
            if (isMatch) {
              const destDir = join(cwd, '.threadwork', 'specs', 'learned', subdir);
              mkdirSync(destDir, { recursive: true });
              cpSync(join(srcDir, file), join(destDir, file));
            }
          } catch { /* skip unparseable files */ }
        }
      }
    }

    // Copy guide to project root — CLAUDE.md for Claude Code, AGENTS.md for Codex
    const agentsMdSrc = join(__dirname, '..', 'templates', 'AGENTS.md');
    if (existsSync(agentsMdSrc)) {
      const destFilename = runtime === 'claude-code' ? 'CLAUDE.md' : 'AGENTS.md';
      cpSync(agentsMdSrc, join(cwd, destFilename));
    }

    // Install runtime-specific files
    if (runtime === 'claude-code') {
      await installClaudeCode({ cwd, global: options.global, __dirname });
    } else if (runtime === 'codex') {
      await installCodex({ cwd, __dirname });
    }

    // Write .gitignore block (idempotent)
    try {
      writeGitignoreBlock(cwd);
      console.log('  ✓ .gitignore updated with Threadwork operational state entries');
    } catch { /* never crash init */ }

    // Create ~/.threadwork/pricing.json if absent (never overwrite)
    try {
      const threadworkGlobalDir = join(homedir(), '.threadwork');
      const pricingPath = join(threadworkGlobalDir, 'pricing.json');
      if (!existsSync(pricingPath)) {
        mkdirSync(threadworkGlobalDir, { recursive: true });
        const pricingTemplate = join(__dirname, '..', 'templates', 'pricing.json');
        if (existsSync(pricingTemplate)) {
          cpSync(pricingTemplate, pricingPath);
        } else {
          writeFileSync(pricingPath, JSON.stringify({
            _updated: new Date().toISOString().slice(0, 10),
            _note: 'Prices per million tokens. Edit this file when Anthropic updates pricing.',
            models: {
              haiku: { input: 0.80, output: 4.00 },
              sonnet: { input: 3.00, output: 15.00 },
              opus: { input: 15.00, output: 75.00 }
            }
          }, null, 2), 'utf8');
        }
        console.log(`  ✓ Created ${pricingPath}`);
      }
    } catch { /* never crash init */ }

    // Create .threadwork/workspace/sessions/ directory
    try {
      mkdirSync(join(cwd, '.threadwork', 'workspace', 'sessions'), { recursive: true });
    } catch { /* may already exist */ }

    // Success summary
    console.log('✅ Threadwork installed!\n');
    console.log('What was installed:');
    console.log('  📁 .threadwork/          — Framework state directory');
    const guideFile = runtime === 'claude-code' ? 'CLAUDE.md' : 'AGENTS.md';
    console.log(`  📝 ${guideFile.padEnd(20)} — Project-level guide`);
    console.log(`  🪝 4 hooks               — session-start, pre-tool-use, post-tool-use, subagent-stop`);
    if (runtime === 'claude-code') {
      console.log('  ⚙️  ~/.claude/settings.json — Hooks registered');
      console.log('  🔓 .claude/settings.json  — Git auto-approval configured');
      console.log('  📋 ~/.claude/commands/tw/ — Slash commands installed');
      console.log('  🤖 ~/.claude/agents/     — Agent prompts installed');
    } else {
      console.log('  📋 AGENTS.md             — Codex behavioral instructions generated');
    }
    console.log('\nNext steps:');
    console.log('  1. Start a new Claude Code session');
    console.log('  2. Run /tw:new-project to initialize your project');
    console.log('  3. Run /tw:plan-phase 1 when ready to plan');

  } catch (err) {
    rl.close();
    throw err;
  }
}
