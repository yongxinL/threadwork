#!/usr/bin/env node
/**
 * threadwork.js — CLI entry point for threadwork-cc
 *
 * Usage:
 *   threadwork init       Scaffold Threadwork into the current project
 *   threadwork update     Update framework files without overwriting user config
 *   threadwork status     Show project state dashboard
 */

import { program } from 'commander';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

program
  .name('threadwork')
  .description('Production-grade AI coding workflow tool for Claude Code and Codex')
  .version(pkg.version);

// ── threadwork init ────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Scaffold the Threadwork framework into the current project')
  .option('--runtime <type>', 'Force runtime: claude, codex, or auto (default: auto)', 'auto')
  .option('--global', 'Install hooks globally to ~/.claude/settings.json', false)
  .option('--dry-run', 'Preview what would be installed without making changes', false)
  .action(async (options) => {
    try {
      const { runInit } = await import('../install/init.js');
      await runInit(options);
    } catch (err) {
      console.error(`\nError during init: ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    }
  });

// ── threadwork update ──────────────────────────────────────────────────────────
program
  .command('update')
  .description('Update Threadwork framework files (preserves user specs and state)')
  .option('--to <version>', 'Migrate to a specific version (e.g. v0.2.0)')
  .option('--dry-run', 'Preview what would change without applying', false)
  .option('--verify', 'Check sync status of all framework files without applying changes', false)
  .action(async (options) => {
    try {
      const { runUpdate } = await import('../install/update.js');
      await runUpdate(options);
    } catch (err) {
      console.error(`\nError during update: ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    }
  });

// ── threadwork status ──────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show current project state, token budget, and quality gate status')
  .action(async () => {
    try {
      const { runStatus } = await import('../install/status.js');
      await runStatus();
    } catch (err) {
      console.error(`\nError reading status: ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    }
  });

program.parse();
