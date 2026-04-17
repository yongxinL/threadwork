/**
 * install/update.js — threadwork update command
 *
 * Updates framework files without overwriting user-customized specs or state.
 * With --to v0.2.0: runs the targeted v0.2.0 migration (idempotent).
 * With --verify: report sync status of every file without applying changes.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, cpSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Content-diff helper ────────────────────────────────────────────────────────

/**
 * Compare source and destination file contents.
 * @returns {'new'|'changed'|'same'}
 */
function diffStatus(src, dest) {
  if (!existsSync(dest)) return 'new';
  try {
    const srcContent = readFileSync(src, 'utf8');
    const destContent = readFileSync(dest, 'utf8');
    return srcContent === destContent ? 'same' : 'changed';
  } catch {
    return 'changed';
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runUpdate(options) {
  const cwd = process.cwd();
  const isDryRun = options.dryRun || options.verify;
  const verifyOnly = options.verify ?? false;
  const targetVersion = options.to;
  const stateDir = join(cwd, '.threadwork', 'state');

  if (!existsSync(stateDir)) {
    console.error("Threadwork is not initialized here. Run 'threadwork init' first.");
    process.exit(1);
  }

  if (targetVersion === 'v0.2.0') {
    return runMigrateV020({ cwd, stateDir, isDryRun });
  }

  if (targetVersion === 'v0.3.0') {
    return runMigrateV030({ cwd, stateDir, isDryRun });
  }

  if (targetVersion === 'v0.3.2') {
    return runMigrateV032({ cwd, stateDir, isDryRun });
  }

  // ── Standard update (no version target) ─────────────────────────────────────
  if (verifyOnly) {
    console.log('\n── Threadwork Verify ─────────────────────────────');
    console.log('Checking sync status (no changes will be applied)\n');
  } else {
    console.log('\n── Threadwork Update ─────────────────────────────');
    if (isDryRun) console.log('DRY RUN — no changes will be applied\n');
  }

  const { lines, updatedCount, newCount, sameCount } = await collectFrameworkUpdates(cwd, isDryRun);

  for (const line of lines) console.log(line);

  const needsAction = updatedCount + newCount;
  if (verifyOnly) {
    console.log(`\n${sameCount} up to date, ${needsAction} need updating`);
    if (needsAction > 0) console.log("Run 'threadwork update' to apply.");
  } else if (isDryRun) {
    console.log(`\n${needsAction} file(s) would be updated. Run without --dry-run to apply.`);
  } else {
    // Stamp _frameworkUpdatedAt in project.json
    try {
      const projectPath = join(stateDir, 'project.json');
      const proj = JSON.parse(readFileSync(projectPath, 'utf8'));
      proj._updated = new Date().toISOString();
      proj._frameworkUpdatedAt = new Date().toISOString();
      writeFileSync(projectPath, JSON.stringify(proj, null, 2));
    } catch { /* ignore */ }
    console.log(`\n✅ Update complete. ${needsAction} file(s) updated, ${sameCount} already up to date.`);
  }
}

// ── v0.2.0 Migration ──────────────────────────────────────────────────────────

/**
 * Idempotent v0.1.x → v0.2.0 migration.
 * Safe to run multiple times — checks _version before each step.
 */
async function runMigrateV020({ cwd, stateDir, isDryRun }) {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   Threadwork — Migrate to v0.2.0             ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  if (isDryRun) console.log('DRY RUN — no changes will be applied\n');

  // ── Idempotency check ──────────────────────────────────────────────────────
  const projectPath = join(stateDir, 'project.json');
  let proj = {};
  try {
    proj = JSON.parse(readFileSync(projectPath, 'utf8'));
  } catch { /* project.json may not exist */ }

  if (proj._version === '0.2.0') {
    console.log('✅ Already at v0.2.0 — nothing to do.');
    return;
  }

  const applied = [];
  const skipped = [];

  // ── Step 1: Backup existing hooks ─────────────────────────────────────────
  const hooksDir = join(cwd, '.threadwork', 'hooks');
  const backupDir = join(cwd, '.threadwork', 'backup', 'v0.1.x-hooks');
  if (existsSync(hooksDir)) {
    applied.push('  [1] Backed up hooks/ → .threadwork/backup/v0.1.x-hooks/');
    if (!isDryRun) {
      mkdirSync(backupDir, { recursive: true });
      cpSync(hooksDir, backupDir, { recursive: true });
    }
  } else {
    skipped.push('  [1] Hooks backup skipped (.threadwork/hooks/ not found)');
  }

  // ── Steps 2–5: Replace hooks ───────────────────────────────────────────────
  const hooksSourceDir = join(__dirname, '..', 'hooks');
  const hookFiles = ['subagent-stop.js', 'pre-tool-use.js', 'post-tool-use.js', 'session-start.js'];
  if (existsSync(hooksSourceDir) && existsSync(hooksDir)) {
    for (const file of hookFiles) {
      const src = join(hooksSourceDir, file);
      if (existsSync(src)) {
        applied.push(`  [2–5] Replaced .threadwork/hooks/${file}`);
        if (!isDryRun) cpSync(src, join(hooksDir, file));
      }
    }
  } else {
    skipped.push('  [2–5] Hook replacement skipped (source or dest dir missing)');
  }

  // ── Steps 6–10: Update lib/ ───────────────────────────────────────────────
  const libSourceDir = join(__dirname, '..', 'lib');
  const libDestDir = join(cwd, '.threadwork', 'lib');
  if (existsSync(libSourceDir)) {
    applied.push('  [6–10] Updated .threadwork/lib/ (store.js, spec-engine.js, quality-gate.js, state.js, handoff.js)');
    if (!isDryRun) {
      mkdirSync(libDestDir, { recursive: true });
      cpSync(libSourceDir, libDestDir, { recursive: true });
    }
  } else {
    skipped.push('  [6–10] lib/ update skipped (source not found)');
  }

  // ── Step 6b: Copy node_modules needed by lib/ ────────────────────────────
  const nmSourceDir020 = join(__dirname, '..', 'node_modules');
  const nmDestDir020 = join(cwd, '.threadwork', 'node_modules');
  if (existsSync(nmSourceDir020)) {
    applied.push('  [6b] Copied node_modules → .threadwork/node_modules/ (gray-matter deps)');
    if (!isDryRun) {
      mkdirSync(nmDestDir020, { recursive: true });
      cpSync(nmSourceDir020, nmDestDir020, { recursive: true });
    }
  }

  // ── Step 11: Install/update agent templates ───────────────────────────────
  const { getCommandsDir, detectRuntime } = await import('../lib/runtime.js');
  const runtime = detectRuntime();
  const agentsSourceDir = join(__dirname, '..', 'templates', 'agents');
  const agentsDest = join(getCommandsDir(runtime).replace('/commands', '/agents'));
  if (existsSync(agentsSourceDir)) {
    const agentFiles = ['tw-entropy-collector.md', 'tw-executor.md'];
    mkdirSync(agentsDest, { recursive: true });
    for (const f of agentFiles) {
      const src = join(agentsSourceDir, f);
      if (existsSync(src)) {
        applied.push(`  [11] Installed/updated agent: ${f}`);
        if (!isDryRun) cpSync(src, join(agentsDest, f));
      }
    }
  }

  // ── Step 12: Install new slash commands ───────────────────────────────────
  const commandsSrcDir = join(__dirname, '..', 'templates', 'commands');
  const commandsDest = getCommandsDir(runtime);
  const newCommands = ['tw-entropy.md', 'tw-store.md'];
  if (existsSync(commandsSrcDir)) {
    mkdirSync(commandsDest, { recursive: true });
    for (const f of newCommands) {
      const src = join(commandsSrcDir, f);
      if (existsSync(src)) {
        applied.push(`  [12] Installed new command: ${f}`);
        if (!isDryRun) cpSync(src, join(commandsDest, f));
      }
    }
  }

  // ── Step 13: Create .threadwork/store/ ────────────────────────────────────
  const storeDir = join(cwd, '.threadwork', 'store');
  const storeIndexPath = join(storeDir, 'store-index.json');
  if (!existsSync(storeDir)) {
    applied.push('  [13] Created .threadwork/store/ (patterns/, edge-cases/, conventions/)');
    if (!isDryRun) {
      mkdirSync(join(storeDir, 'patterns'), { recursive: true });
      mkdirSync(join(storeDir, 'edge-cases'), { recursive: true });
      mkdirSync(join(storeDir, 'conventions'), { recursive: true });
      writeFileSync(storeIndexPath, JSON.stringify({
        _version: '0.2.0',
        _created: new Date().toISOString(),
        entries: []
      }, null, 2));
    }
  } else {
    skipped.push('  [13] .threadwork/store/ already exists — preserved');
  }

  // ── Step 14: Patch project.json ───────────────────────────────────────────
  applied.push('  [14] Updated project.json: _version → "0.2.0", store_enabled → true');
  if (!isDryRun) {
    proj._version = '0.2.0';
    proj._updated = new Date().toISOString();
    proj._frameworkUpdatedAt = new Date().toISOString();
    proj.store_enabled = true;
    if (!proj.store_domains) {
      proj.store_domains = ['patterns', 'edge-cases', 'conventions'];
    }
    writeFileSync(projectPath, JSON.stringify(proj, null, 2));
  }

  // ── Step 15: Patch token-log.json ─────────────────────────────────────────
  const tokenLogPath = join(stateDir, 'token-log.json');
  if (existsSync(tokenLogPath)) {
    try {
      const tokenLog = JSON.parse(readFileSync(tokenLogPath, 'utf8'));
      if (!('spec_fetch_tokens' in tokenLog)) {
        applied.push('  [15] Patched token-log.json: added spec_fetch_tokens: 0');
        if (!isDryRun) {
          tokenLog.spec_fetch_tokens = 0;
          tokenLog.spec_fetch_log = [];
          tokenLog._updated = new Date().toISOString();
          writeFileSync(tokenLogPath, JSON.stringify(tokenLog, null, 2));
        }
      } else {
        skipped.push('  [15] token-log.json already has spec_fetch_tokens');
      }
    } catch { skipped.push('  [15] token-log.json patch skipped (parse error)'); }
  } else {
    skipped.push('  [15] token-log.json not found — skipped');
  }

  // ── Step 16: Patch ralph-state.json ──────────────────────────────────────
  const ralphStatePath = join(stateDir, 'ralph-state.json');
  if (existsSync(ralphStatePath)) {
    try {
      const ralphState = JSON.parse(readFileSync(ralphStatePath, 'utf8'));
      if (!('remediation_log' in ralphState)) {
        applied.push('  [16] Patched ralph-state.json: added remediation_log: []');
        if (!isDryRun) {
          ralphState.remediation_log = [];
          ralphState._updated = new Date().toISOString();
          writeFileSync(ralphStatePath, JSON.stringify(ralphState, null, 2));
        }
      } else {
        skipped.push('  [16] ralph-state.json already has remediation_log');
      }
    } catch { skipped.push('  [16] ralph-state.json patch skipped (parse error)'); }
  } else {
    skipped.push('  [16] ralph-state.json not found — skipped');
  }

  // ── Step 17: Generate spec IDs ────────────────────────────────────────────
  const specsDir = join(cwd, '.threadwork', 'specs');
  if (existsSync(specsDir)) {
    try {
      const { generateSpecIds } = await import('../lib/spec-engine.js');
      const count = generateSpecIds();
      if (count > 0) {
        applied.push(`  [17] Generated ${count} spec IDs in specs/index.md`);
      } else {
        skipped.push('  [17] Spec IDs already generated (or no specs found)');
      }
    } catch { skipped.push('  [17] Spec ID generation skipped (spec-engine unavailable)'); }
  } else {
    skipped.push('  [17] .threadwork/specs/ not found — spec IDs skipped');
  }

  // ── Step 18: Print summary ────────────────────────────────────────────────
  console.log('Applied:');
  for (const line of applied) console.log(line);
  if (skipped.length > 0) {
    console.log('\nSkipped (already current or not applicable):');
    for (const line of skipped) console.log(line);
  }

  if (!isDryRun) {
    console.log('\n✅ Migration to v0.2.0 complete!\n');
    console.log('Next steps:');
    console.log('  1. Review .threadwork/specs/ — run /tw:specs reindex if spec IDs are missing');
    console.log('  2. Check quality-config.json entropy scanner categories');
    console.log('  3. Confirm store_domains in .threadwork/state/project.json');
    console.log('  4. Restart Claude Code to load updated hooks\n');
  } else {
    console.log('\nDRY RUN — no changes applied.');
  }
}

// ── v0.3.0 Migration ──────────────────────────────────────────────────────────

/**
 * Idempotent v0.2.x → v0.3.0 migration.
 * Safe to run multiple times — checks _version before each step.
 */
async function runMigrateV030({ cwd, stateDir, isDryRun }) {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   Threadwork — Migrate to v0.3.0             ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  if (isDryRun) console.log('DRY RUN — no changes will be applied\n');

  const { homedir } = await import('os');
  const projectPath = join(stateDir, 'project.json');
  let proj = {};
  try {
    proj = JSON.parse(readFileSync(projectPath, 'utf8'));
  } catch { /* project.json may not exist */ }

  if (proj._version === '0.3.0') {
    console.log('✅ Already at v0.3.0 — nothing to do.');
    return;
  }

  const applied = [];
  const skipped = [];

  // ── Step 1: Backup existing hooks ─────────────────────────────────────────
  const hooksDir = join(cwd, '.threadwork', 'hooks');
  const backupDir = join(cwd, '.threadwork', 'backup', 'v0.2.x-hooks');
  if (existsSync(hooksDir)) {
    applied.push('  [1] Backed up hooks/ → .threadwork/backup/v0.2.x-hooks/');
    if (!isDryRun) {
      mkdirSync(backupDir, { recursive: true });
      cpSync(hooksDir, backupDir, { recursive: true });
    }
  } else {
    skipped.push('  [1] Hooks backup skipped (.threadwork/hooks/ not found)');
  }

  // ── Step 2: Append .gitignore block (idempotent) ──────────────────────────
  const { writeGitignoreBlock } = await import('./claude-code.js');
  applied.push('  [2] Appending Threadwork block to .gitignore (idempotent)');
  if (!isDryRun) {
    try {
      writeGitignoreBlock(cwd);
    } catch { skipped.push('  [2] .gitignore write failed'); }
  }

  // ── Step 3: Create ~/.threadwork/pricing.json if absent ──────────────────
  const pricingPath = join(homedir(), '.threadwork', 'pricing.json');
  if (!existsSync(pricingPath)) {
    applied.push(`  [3] Creating ${pricingPath}`);
    if (!isDryRun) {
      mkdirSync(join(homedir(), '.threadwork'), { recursive: true });
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
    }
  } else {
    skipped.push(`  [3] ${pricingPath} already exists — preserved`);
  }

  // ── Step 4: Update hooks/ ─────────────────────────────────────────────────
  const hooksSourceDir = join(__dirname, '..', 'hooks');
  const hookFiles = ['pre-tool-use.js', 'session-start.js', 'post-tool-use.js', 'subagent-stop.js'];
  if (existsSync(hooksSourceDir) && existsSync(hooksDir)) {
    for (const file of hookFiles) {
      const src = join(hooksSourceDir, file);
      if (existsSync(src)) {
        applied.push(`  [4] Updated .threadwork/hooks/${file}`);
        if (!isDryRun) cpSync(src, join(hooksDir, file));
      }
    }
  } else {
    skipped.push('  [4] Hook update skipped (source or dest dir missing)');
  }

  // ── Step 5: Update lib/ with new modules ─────────────────────────────────
  const libSourceDir = join(__dirname, '..', 'lib');
  const libDestDir = join(cwd, '.threadwork', 'lib');
  if (existsSync(libSourceDir)) {
    applied.push('  [5] Updated .threadwork/lib/ (token-tracker.js, model-switcher.js, blueprint-diff.js, handoff.js)');
    if (!isDryRun) {
      mkdirSync(libDestDir, { recursive: true });
      cpSync(libSourceDir, libDestDir, { recursive: true });
    }
  } else {
    skipped.push('  [5] lib/ update skipped');
  }

  // ── Step 5b: Copy node_modules needed by lib/ ────────────────────────────
  const nmSourceDir030 = join(__dirname, '..', 'node_modules');
  const nmDestDir030 = join(cwd, '.threadwork', 'node_modules');
  if (existsSync(nmSourceDir030)) {
    applied.push('  [5b] Copied node_modules → .threadwork/node_modules/ (gray-matter deps)');
    if (!isDryRun) {
      mkdirSync(nmDestDir030, { recursive: true });
      cpSync(nmSourceDir030, nmDestDir030, { recursive: true });
    }
  }

  // ── Step 6: Install new slash commands ────────────────────────────────────
  const { getCommandsDir, detectRuntime } = await import('../lib/runtime.js');
  const runtime = detectRuntime();
  const commandsSrcDir = join(__dirname, '..', 'templates', 'commands');
  const commandsDest = getCommandsDir(runtime);
  const newCommands = ['tw-cost.md', 'tw-model.md', 'tw-blueprint-diff.md', 'tw-blueprint-lock.md'];
  if (existsSync(commandsSrcDir)) {
    mkdirSync(commandsDest, { recursive: true });
    for (const f of newCommands) {
      const src = join(commandsSrcDir, f);
      if (existsSync(src)) {
        applied.push(`  [6] Installed command: ${f}`);
        if (!isDryRun) cpSync(src, join(commandsDest, f.replace(/^tw-/, '')));
      }
    }
  }

  // ── Step 7: Patch project.json with v0.3.0 fields ────────────────────────
  applied.push('  [7] Patching project.json with v0.3.0 fields');
  if (!isDryRun) {
    // Recalibrate session_token_budget if it's 800K and default_context is 200k
    let budgetNote = '';
    if (!proj.default_context) {
      proj.default_context = '200k';
    }
    if (!proj.cost_budget) {
      proj.cost_budget = 5.00;
    }
    if (!proj.model_switch_policy) {
      proj.model_switch_policy = 'notify';
    }
    if (!proj.session_token_budget) {
      proj.session_token_budget = proj.sessionBudget ?? 400_000;
    }
    // Recalibrate: if budget is 800K and context is 200k, recalibrate to 400K
    if ((proj.sessionBudget === 800_000 || proj.session_token_budget === 800_000) &&
        proj.default_context === '200k') {
      proj.session_token_budget = 400_000;
      proj.sessionBudget = 400_000;
      budgetNote = ' (recalibrated from 800K to 400K for 200K context model)';
    }
    proj._version = '0.3.0';
    proj._updated = new Date().toISOString();
    writeFileSync(projectPath, JSON.stringify(proj, null, 2));
    if (budgetNote) applied.push(`  [7b] Token budget recalibrated: 800K → 400K (200K context model)`);
  }

  // ── Step 8: Create .threadwork/workspace/sessions/ ───────────────────────
  const sessionsDir = join(cwd, '.threadwork', 'workspace', 'sessions');
  if (!existsSync(sessionsDir)) {
    applied.push('  [8] Created .threadwork/workspace/sessions/');
    if (!isDryRun) mkdirSync(sessionsDir, { recursive: true });
  } else {
    skipped.push('  [8] sessions/ already exists');
  }

  // ── Step 9: Update token-log.json with cost fields ───────────────────────
  const tokenLogPath = join(stateDir, 'token-log.json');
  if (existsSync(tokenLogPath)) {
    try {
      const tokenLog = JSON.parse(readFileSync(tokenLogPath, 'utf8'));
      if (!('sessionCostUsed' in tokenLog)) {
        applied.push('  [9] Patched token-log.json: added sessionCostUsed: 0');
        if (!isDryRun) {
          tokenLog.sessionCostUsed = 0;
          tokenLog._updated = new Date().toISOString();
          writeFileSync(tokenLogPath, JSON.stringify(tokenLog, null, 2));
        }
      } else {
        skipped.push('  [9] token-log.json already has sessionCostUsed');
      }
    } catch { skipped.push('  [9] token-log.json patch skipped (parse error)'); }
  } else {
    skipped.push('  [9] token-log.json not found — skipped');
  }

  // ── Step 10: Add model-switch-log.json to .gitignore ──────────────────────
  // Already handled by writeGitignoreBlock() in step 2 — no extra action needed
  skipped.push('  [10] model-switch-log.json excluded via .gitignore (handled in step 2)');

  // ── Step 11: Update THREADWORK.md with new commands ───────────────────────
  const threadworkMdPath = join(cwd, 'THREADWORK.md');
  if (!existsSync(threadworkMdPath)) {
    skipped.push('  [11] THREADWORK.md not found — skipped');
  } else {
    applied.push('  [11] THREADWORK.md commands section will be updated at next /tw:new-project');
    // Actual update deferred — THREADWORK.md is a user document
  }

  // ── Step 12: Print summary ────────────────────────────────────────────────
  console.log('Applied:');
  for (const line of applied) console.log(line);
  if (skipped.length > 0) {
    console.log('\nSkipped (already current or not applicable):');
    for (const line of skipped) console.log(line);
  }

  if (!isDryRun) {
    console.log('\n✅ Migration to v0.3.0 complete!\n');
    console.log('Next steps:');
    console.log('  1. Run /tw:blueprint-lock to establish your first blueprint baseline');
    console.log('  2. Review ~/.threadwork/pricing.json and update model prices if needed');
    console.log('  3. Review the new model_switch_policy setting in project.json');
    console.log('  4. Restart Claude Code to load updated hooks\n');
  } else {
    console.log('\nDRY RUN — no changes applied.');
  }
}

// ── v0.3.2 Migration ──────────────────────────────────────────────────────────

/**
 * Idempotent v0.3.x → v0.3.2 migration.
 * Safe to run multiple times — checks _version before each step.
 *
 * New in v0.3.2:
 * 1. Create .threadwork/specs/enforcement/ directory
 * 2. Copy enforcement example spec template (if not already present)
 * 3. Create .threadwork/specs/frontend/ directory
 * 4. Copy frontend design-ref example spec template (if not already present)
 * 5. Create .threadwork/state/knowledge-notes.json (empty)
 * 6. Create .threadwork/state/gap-report.json (empty)
 * 7. Create .threadwork/state/spec-staleness-tracker.json (empty)
 * 8. Create verification-profiles/ dir in lib if missing
 * 9. Patch project.json with autonomyLevel and verificationType defaults
 * 10. Copy new lib modules: rule-evaluator.js, doc-freshness.js, knowledge-notes.js,
 *     design-ref.js, verification-profile.js, autonomy.js
 * 11. Copy updated hooks: pre-tool-use.js, post-tool-use.js, subagent-stop.js, session-start.js
 * 12. Copy new agent templates: tw-reviewer.md
 * 13. Copy new command templates: tw-docs-health, tw-readiness, tw-autonomy, tw-verify-manual
 * 14. Copy verification profile JSON templates
 * 15. Stamp _version = '0.3.2'
 */
async function runMigrateV032({ cwd, stateDir, isDryRun }) {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   Threadwork — Migrate to v0.3.2             ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  if (isDryRun) console.log('DRY RUN — no changes will be applied\n');

  const projectPath = join(stateDir, 'project.json');
  let proj = {};
  try {
    proj = JSON.parse(readFileSync(projectPath, 'utf8'));
  } catch { /* project.json may not exist */ }

  if (proj._version === '0.3.2') {
    console.log('✅ Already at v0.3.2 — nothing to do.');
    return;
  }

  const applied = [];
  const skipped = [];

  // ── Step 1: Backup existing hooks ─────────────────────────────────────────
  const hooksDir = join(cwd, '.threadwork', 'hooks');
  const backupDir = join(cwd, '.threadwork', 'backup', 'v0.3.x-hooks');
  if (existsSync(hooksDir)) {
    applied.push('  [1] Backed up hooks/ → .threadwork/backup/v0.3.x-hooks/');
    if (!isDryRun) {
      mkdirSync(backupDir, { recursive: true });
      cpSync(hooksDir, backupDir, { recursive: true });
    }
  } else {
    skipped.push('  [1] Hooks backup skipped (.threadwork/hooks/ not found)');
  }

  // ── Step 2: Create enforcement specs directory ─────────────────────────────
  const enforcementDir = join(cwd, '.threadwork', 'specs', 'enforcement');
  if (!existsSync(enforcementDir)) {
    applied.push('  [2] Creating .threadwork/specs/enforcement/');
    if (!isDryRun) mkdirSync(enforcementDir, { recursive: true });
  } else {
    skipped.push('  [2] .threadwork/specs/enforcement/ already exists');
  }

  // ── Step 3: Copy enforcement example spec template ─────────────────────────
  const enforcementTemplateSrc = join(__dirname, '..', 'templates', 'specs', 'core', 'enforcement', 'example-rules.md');
  const enforcementTemplateDest = join(enforcementDir, 'example-rules.md');
  if (existsSync(enforcementTemplateSrc) && !existsSync(enforcementTemplateDest)) {
    applied.push('  [3] Copying enforcement example spec template');
    if (!isDryRun) cpSync(enforcementTemplateSrc, enforcementTemplateDest);
  } else {
    skipped.push('  [3] Enforcement example spec already present or source missing');
  }

  // ── Step 4: Create frontend specs directory ────────────────────────────────
  const frontendDir = join(cwd, '.threadwork', 'specs', 'frontend');
  if (!existsSync(frontendDir)) {
    applied.push('  [4] Creating .threadwork/specs/frontend/');
    if (!isDryRun) mkdirSync(frontendDir, { recursive: true });
  } else {
    skipped.push('  [4] .threadwork/specs/frontend/ already exists');
  }

  // ── Step 5: Copy design-ref example spec template ─────────────────────────
  const designRefTemplateSrc = join(__dirname, '..', 'templates', 'specs', 'core', 'frontend', 'design-ref-example.md');
  const designRefTemplateDest = join(frontendDir, 'design-ref-example.md');
  if (existsSync(designRefTemplateSrc) && !existsSync(designRefTemplateDest)) {
    applied.push('  [5] Copying design-ref example spec template');
    if (!isDryRun) cpSync(designRefTemplateSrc, designRefTemplateDest);
  } else {
    skipped.push('  [5] Design-ref example spec already present or source missing');
  }

  // ── Step 6: Create knowledge-notes.json ───────────────────────────────────
  const knowledgeNotesPath = join(stateDir, 'knowledge-notes.json');
  if (!existsSync(knowledgeNotesPath)) {
    applied.push('  [6] Creating .threadwork/state/knowledge-notes.json');
    if (!isDryRun) {
      writeFileSync(knowledgeNotesPath, JSON.stringify({ notes: [] }, null, 2), 'utf8');
    }
  } else {
    skipped.push('  [6] knowledge-notes.json already exists');
  }

  // ── Step 7: Create gap-report.json ────────────────────────────────────────
  const gapReportPath = join(stateDir, 'gap-report.json');
  if (!existsSync(gapReportPath)) {
    applied.push('  [7] Creating .threadwork/state/gap-report.json');
    if (!isDryRun) {
      writeFileSync(gapReportPath, JSON.stringify({ gaps: [] }, null, 2), 'utf8');
    }
  } else {
    skipped.push('  [7] gap-report.json already exists');
  }

  // ── Step 8: Create spec-staleness-tracker.json ────────────────────────────
  const staleTrackerPath = join(stateDir, 'spec-staleness-tracker.json');
  if (!existsSync(staleTrackerPath)) {
    applied.push('  [8] Creating .threadwork/state/spec-staleness-tracker.json');
    if (!isDryRun) {
      writeFileSync(staleTrackerPath, JSON.stringify({}, null, 2), 'utf8');
    }
  } else {
    skipped.push('  [8] spec-staleness-tracker.json already exists');
  }

  // ── Step 9: Update hooks ──────────────────────────────────────────────────
  const hooksSourceDir = join(__dirname, '..', 'hooks');
  if (existsSync(hooksSourceDir)) {
    for (const file of ['pre-tool-use.js', 'post-tool-use.js', 'subagent-stop.js', 'session-start.js']) {
      const src = join(hooksSourceDir, file);
      const dest = join(hooksDir, file);
      if (existsSync(src)) {
        applied.push(`  [9] Updating hooks/${file}`);
        if (!isDryRun) cpSync(src, dest);
      }
    }
  }

  // ── Step 10: Update lib modules ───────────────────────────────────────────
  const libSourceDir = join(__dirname, '..', 'lib');
  const libDestDir = join(cwd, '.threadwork', 'lib');
  if (existsSync(libSourceDir)) {
    if (!isDryRun) cpSync(libSourceDir, libDestDir, { recursive: true });
    applied.push('  [10] Updated lib/ (all modules including new v0.3.2 modules)');
  }

  // ── Step 10b: Copy node_modules needed by lib/ ───────────────────────────
  const nmSourceDir032 = join(__dirname, '..', 'node_modules');
  const nmDestDir032 = join(cwd, '.threadwork', 'node_modules');
  if (existsSync(nmSourceDir032)) {
    if (!isDryRun) {
      mkdirSync(nmDestDir032, { recursive: true });
      cpSync(nmSourceDir032, nmDestDir032, { recursive: true });
    }
    applied.push('  [10b] Copied node_modules → .threadwork/node_modules/ (gray-matter deps)');
  }

  // ── Step 11: Copy new agent template: tw-reviewer.md ─────────────────────
  const { getCommandsDir, detectRuntime } = await import('../lib/runtime.js');
  const runtime = detectRuntime();
  const commandsDest = getCommandsDir(runtime);
  const agentTemplatesSrc = join(__dirname, '..', 'templates', 'agents');
  const reviewerSrc = join(agentTemplatesSrc, 'tw-reviewer.md');
  if (existsSync(reviewerSrc)) {
    applied.push('  [11] Installing tw-reviewer agent template');
    if (!isDryRun) cpSync(reviewerSrc, join(commandsDest, 'reviewer.md'));
  } else {
    skipped.push('  [11] tw-reviewer.md template source not found');
  }

  // ── Step 12: Update all command templates ─────────────────────────────────
  const commandsSrcDir = join(__dirname, '..', 'templates', 'commands');
  if (existsSync(commandsSrcDir)) {
    for (const file of readdirSync(commandsSrcDir)) {
      if (file.endsWith('.md')) {
        const destFile = file.replace(/^tw-/, '');
        const stalePath = join(commandsDest, file);
        if (file !== destFile && existsSync(stalePath)) {
          if (!isDryRun) {
            const { rmSync } = await import('fs');
            rmSync(stalePath);
          }
        }
        applied.push(`  [12] Updating command template: ${destFile}`);
        if (!isDryRun) cpSync(join(commandsSrcDir, file), join(commandsDest, destFile));
      }
    }
  }

  // ── Step 13: Copy verification profile templates ──────────────────────────
  const profilesSrcDir = join(__dirname, '..', 'templates', 'verification-profiles');
  const profilesDestDir = join(cwd, '.threadwork', 'verification-profiles');
  if (existsSync(profilesSrcDir)) {
    if (!isDryRun) {
      mkdirSync(profilesDestDir, { recursive: true });
      cpSync(profilesSrcDir, profilesDestDir, { recursive: true });
    }
    applied.push('  [13] Copied verification profile templates to .threadwork/verification-profiles/');
  } else {
    skipped.push('  [13] Verification profiles source not found');
  }

  // ── Step 14: Patch project.json with v0.3.2 fields ───────────────────────
  applied.push('  [14] Patching project.json with v0.3.2 fields');
  if (!isDryRun) {
    try {
      const currentProj = JSON.parse(readFileSync(projectPath, 'utf8'));
      if (!currentProj.autonomyLevel) currentProj.autonomyLevel = 'supervised';
      if (!currentProj.verificationType) currentProj.verificationType = null;
      currentProj._version = '0.3.2';
      currentProj._updated = new Date().toISOString();
      writeFileSync(projectPath, JSON.stringify(currentProj, null, 2), 'utf8');
    } catch (e) {
      skipped.push(`  [14] Could not patch project.json: ${e.message}`);
    }
  }

  // ── Print summary ─────────────────────────────────────────────────────────
  console.log('Applied:');
  for (const line of applied) console.log(line);
  if (skipped.length > 0) {
    console.log('\nSkipped (already current or not applicable):');
    for (const line of skipped) console.log(line);
  }

  if (!isDryRun) {
    console.log('\n✅ Migration to v0.3.2 complete!\n');
    console.log('Next steps:');
    console.log('  1. Restart Claude Code to load updated hooks');
    console.log('  2. Run /tw:docs-health to check your spec library health');
    console.log('  3. Run /tw:readiness to see the autonomy readiness score');
    console.log('  4. Add enforcement rules to .threadwork/specs/enforcement/ if desired');
    console.log('  5. Run /tw:discuss-phase N to set autonomyLevel and verificationType for your phase\n');
  } else {
    console.log('\nDRY RUN — no changes applied.');
  }
}

// ── Shared: collect standard framework file updates ───────────────────────────

async function collectFrameworkUpdates(cwd, isDryRun) {
  const lines = [];
  let updatedCount = 0;
  let newCount = 0;
  let sameCount = 0;
  const { homedir } = await import('os');

  /**
   * Evaluate one file: print status line, optionally copy, tally counters.
   * @param {string} src - absolute source path
   * @param {string} dest - absolute destination path
   * @param {string} label - display label shown in output
   */
  function syncFile(src, dest, label) {
    const status = diffStatus(src, dest);
    if (status === 'same') {
      lines.push(`  ✅ ${label}`);
      sameCount++;
    } else if (status === 'new') {
      lines.push(`  ✨ ${label} — new file`);
      newCount++;
      if (!isDryRun) { mkdirSync(dirname(dest), { recursive: true }); cpSync(src, dest); }
    } else {
      lines.push(`  ⬆  ${label} — needs update`);
      updatedCount++;
      if (!isDryRun) { mkdirSync(dirname(dest), { recursive: true }); cpSync(src, dest); }
    }
  }

  // ── .claude/settings.json — permissions ──────────────────────────────────────
  const projectSettingsPath = join(cwd, '.claude', 'settings.json');
  let projectSettings = {};
  if (existsSync(projectSettingsPath)) {
    try { projectSettings = JSON.parse(readFileSync(projectSettingsPath, 'utf8')); } catch { /* create fresh */ }
  }
  const THREADWORK_PERMISSIONS = ['Bash(git:*)', 'Bash(node:*)'];
  projectSettings.permissions = projectSettings.permissions ?? {};
  projectSettings.permissions.allow = projectSettings.permissions.allow ?? [];
  const missing = THREADWORK_PERMISSIONS.filter(p => !projectSettings.permissions.allow.includes(p));
  if (missing.length > 0) {
    lines.push(`  ⬆  .claude/settings.json — missing permissions: ${missing.join(', ')}`);
    updatedCount++;
    if (!isDryRun) {
      projectSettings.permissions.allow.push(...missing);
      mkdirSync(join(cwd, '.claude'), { recursive: true });
      writeFileSync(projectSettingsPath, JSON.stringify(projectSettings, null, 2), 'utf8');
    }
  } else {
    lines.push('  ✅ .claude/settings.json — permissions ok');
    sameCount++;
  }

  // ── ~/.threadwork/pricing.json ────────────────────────────────────────────────
  const pricingTemplate = join(__dirname, '..', 'templates', 'pricing.json');
  const pricingDest = join(homedir(), '.threadwork', 'pricing.json');
  if (existsSync(pricingTemplate)) {
    syncFile(pricingTemplate, pricingDest, '~/.threadwork/pricing.json');
  }

  // ── ~/.claude/settings.json — global hook commands ───────────────────────────
  const { getHooksConfig } = await import('../lib/runtime.js');
  const globalSettingsPath = join(homedir(), '.claude', 'settings.json');
  if (existsSync(globalSettingsPath)) {
    try {
      const globalSettings = JSON.parse(readFileSync(globalSettingsPath, 'utf8'));
      const expectedHooks = getHooksConfig('claude-code').hooks;
      let staleCommands = [];

      if (globalSettings.hooks) {
        for (const [eventName, expectedEntries] of Object.entries(expectedHooks)) {
          const existingEntries = globalSettings.hooks[eventName] ?? [];
          for (const expectedEntry of expectedEntries) {
            for (const expectedHook of expectedEntry.hooks ?? []) {
              const hookFile = expectedHook.command.match(/\.threadwork\/hooks\/(\S+\.js)/)?.[1];
              if (!hookFile) continue;
              const existingHook = existingEntries
                .flatMap(e => e.hooks ?? [])
                .find(h => h.command.includes(hookFile));
              if (existingHook && existingHook.command !== expectedHook.command) {
                staleCommands.push({ eventName, existingHook, newCommand: expectedHook.command });
              }
            }
          }
        }
      }

      if (staleCommands.length > 0) {
        lines.push(`  ⬆  ~/.claude/settings.json — ${staleCommands.length} hook command(s) need update (adding bash fallback wrapper)`);
        updatedCount++;
        if (!isDryRun) {
          for (const { existingHook, newCommand } of staleCommands) {
            existingHook.command = newCommand;
          }
          writeFileSync(globalSettingsPath, JSON.stringify(globalSettings, null, 2), 'utf8');
        }
      } else {
        lines.push('  ✅ ~/.claude/settings.json — hook commands up to date');
        sameCount++;
      }
    } catch {
      lines.push('  ⚠  ~/.claude/settings.json — could not read or parse (skipped)');
    }
  } else {
    lines.push('  ⚠  ~/.claude/settings.json — not found (run threadwork init to register hooks)');
  }

  // ── Hooks (.threadwork/hooks/) ────────────────────────────────────────────────
  lines.push('\nHooks:');
  const hooksSourceDir = join(__dirname, '..', 'hooks');
  const hooksDestDir = join(cwd, '.threadwork', 'hooks');
  if (existsSync(hooksSourceDir)) {
    for (const file of readdirSync(hooksSourceDir).sort()) {
      if (file.endsWith('.js') && file !== 'test-harness.js') {
        syncFile(join(hooksSourceDir, file), join(hooksDestDir, file),
          `.threadwork/hooks/${file}`);
      }
    }
  }

  // ── Lib (.threadwork/lib/) ────────────────────────────────────────────────────
  lines.push('\nLib:');
  const libSourceDir = join(__dirname, '..', 'lib');
  const libDestDir = join(cwd, '.threadwork', 'lib');
  if (existsSync(libSourceDir)) {
    if (!isDryRun) mkdirSync(libDestDir, { recursive: true });
    for (const file of readdirSync(libSourceDir).sort()) {
      if (file.endsWith('.js')) {
        syncFile(join(libSourceDir, file), join(libDestDir, file),
          `.threadwork/lib/${file}`);
      }
    }
  }

  // ── Node modules (.threadwork/node_modules/) ──────────────────────────────────
  // lib/ files import gray-matter; copy node_modules so they resolve in user projects
  const nmSourceDir = join(__dirname, '..', 'node_modules');
  const nmDestDir = join(cwd, '.threadwork', 'node_modules');
  if (existsSync(nmSourceDir)) {
    const grayMatterDest = join(nmDestDir, 'gray-matter');
    const needsSync = !existsSync(grayMatterDest);
    if (needsSync) {
      lines.push('  ✨ .threadwork/node_modules/ — new (required by lib/)');
      newCount++;
      if (!isDryRun) {
        mkdirSync(nmDestDir, { recursive: true });
        cpSync(nmSourceDir, nmDestDir, { recursive: true });
      }
    } else {
      lines.push('  ✅ .threadwork/node_modules/');
      sameCount++;
    }
  }

  // ── Commands (~/.claude/commands/tw/) ────────────────────────────────────────
  lines.push('\nCommands:');
  const commandsSrcDir = join(__dirname, '..', 'templates', 'commands');
  const { getCommandsDir, getAgentsDir, detectRuntime } = await import('../lib/runtime.js');
  const runtime = detectRuntime();
  const commandsDest = getCommandsDir(runtime);
  if (existsSync(commandsSrcDir)) {
    if (!isDryRun) mkdirSync(commandsDest, { recursive: true });
    for (const file of readdirSync(commandsSrcDir).sort()) {
      if (file.endsWith('.md')) {
        const destFile = file.replace(/^tw-/, '');
        // Remove stale tw-prefixed duplicate if present
        if (!isDryRun && file !== destFile && existsSync(join(commandsDest, file))) {
          const { rmSync } = await import('fs');
          rmSync(join(commandsDest, file));
        }
        syncFile(join(commandsSrcDir, file), join(commandsDest, destFile),
          `commands/tw/${destFile}`);
      }
    }
  }

  // ── Agents (~/.claude/agents/) ───────────────────────────────────────────────
  lines.push('\nAgents:');
  const agentsSrcDir = join(__dirname, '..', 'templates', 'agents');
  const agentsDest = getAgentsDir(runtime);
  if (existsSync(agentsSrcDir)) {
    if (!isDryRun) mkdirSync(agentsDest, { recursive: true });
    for (const file of readdirSync(agentsSrcDir).sort()) {
      if (file.endsWith('.md')) {
        syncFile(join(agentsSrcDir, file), join(agentsDest, file), `agents/${file}`);
      }
    }
  }

  // ── Spec templates (.threadwork/specs/) — new files only ─────────────────────
  lines.push('\nSpec templates (new files only — existing specs preserved):');
  const specsSrcDir = join(__dirname, '..', 'templates', 'specs');
  const specsDestDir = join(cwd, '.threadwork', 'specs');
  if (existsSync(specsSrcDir)) {
    for (const domain of readdirSync(specsSrcDir).sort()) {
      const domainSrc = join(specsSrcDir, domain);
      if (!statSync(domainSrc).isDirectory()) continue;
      const domainDest = join(specsDestDir, domain);
      for (const file of readdirSync(domainSrc).sort()) {
        const srcPath = join(domainSrc, file);
        if (!statSync(srcPath).isFile()) continue; // skip subdirectories
        const destFile = join(domainDest, file);
        if (existsSync(destFile)) {
          lines.push(`  ⚠  specs/${domain}/${file} — skipped (user spec preserved)`);
        } else {
          lines.push(`  ✨ specs/${domain}/${file} — new template`);
          newCount++;
          if (!isDryRun) { mkdirSync(domainDest, { recursive: true }); cpSync(srcPath, destFile); }
        }
      }
    }
  }

  return { lines, updatedCount, newCount, sameCount };
}
