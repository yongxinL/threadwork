/**
 * lib/runtime.js — Runtime detection layer
 *
 * Abstracts Claude Code vs Codex differences so all other code is runtime-agnostic.
 * Never throws — returns 'unknown' gracefully when environment is unclear.
 */

import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/** @typedef {'claude-code' | 'codex' | 'unknown'} Runtime */

/**
 * Detect the current AI runtime environment.
 * @returns {Runtime}
 */
export function detectRuntime() {
  // Claude Code: CLAUDE_CODE env var OR ~/.claude/ directory exists
  if (process.env.CLAUDE_CODE || existsSync(join(homedir(), '.claude'))) {
    return 'claude-code';
  }
  // Codex: CODEX_API_KEY env var OR .codex/ directory in cwd
  if (process.env.CODEX_API_KEY || existsSync(join(process.cwd(), '.codex'))) {
    return 'codex';
  }
  return 'unknown';
}

/**
 * Get the slash commands directory for the given runtime.
 * @param {Runtime} runtime
 * @returns {string} Absolute directory path
 */
export function getCommandsDir(runtime) {
  if (runtime === 'claude-code') {
    return join(homedir(), '.claude', 'commands', 'tw');
  }
  if (runtime === 'codex') {
    return join(process.cwd(), '.codex', 'commands');
  }
  // Fallback: local project commands
  return join(process.cwd(), '.claude', 'commands', 'tw');
}

/**
 * Get the agents directory for the given runtime.
 * @param {Runtime} runtime
 * @returns {string} Absolute directory path
 */
export function getAgentsDir(runtime) {
  if (runtime === 'claude-code') {
    return join(homedir(), '.claude', 'agents');
  }
  if (runtime === 'codex') {
    return join(process.cwd(), '.codex', 'agents');
  }
  return join(process.cwd(), '.claude', 'agents');
}

/**
 * Get the hook registration config format for the given runtime.
 * Returns the hooks block structure used by the installer.
 * @param {Runtime} runtime
 * @returns {object}
 */
export function getHooksConfig(runtime) {
  if (runtime === 'claude-code') {
    return {
      hooks: {
        SessionStart: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: "bash -c '[ -f .threadwork/hooks/session-start.js ] && node .threadwork/hooks/session-start.js || exit 0'" }]
          }
        ],
        PreToolUse: [
          {
            matcher: 'Task',
            hooks: [{ type: 'command', command: "bash -c '[ -f .threadwork/hooks/pre-tool-use.js ] && node .threadwork/hooks/pre-tool-use.js || exit 0'" }]
          }
        ],
        PostToolUse: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: "bash -c '[ -f .threadwork/hooks/post-tool-use.js ] && node .threadwork/hooks/post-tool-use.js || exit 0'" }]
          }
        ],
        SubagentStop: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: "bash -c '[ -f .threadwork/hooks/subagent-stop.js ] && node .threadwork/hooks/subagent-stop.js || exit 0'" }]
          }
        ]
      }
    };
  }

  if (runtime === 'codex') {
    // Codex uses AGENTS.md behavioral injection; no native hook system
    return { type: 'agents-md', hooks: [] };
  }

  return { hooks: {} };
}

/**
 * Get the path to the runtime's settings file.
 * @param {Runtime} runtime
 * @param {boolean} [global=false] Use global settings (Claude Code only)
 * @returns {string}
 */
export function getSettingsPath(runtime, global = false) {
  if (runtime === 'claude-code') {
    if (global) {
      return join(homedir(), '.claude', 'settings.json');
    }
    return join(process.cwd(), '.claude', 'settings.json');
  }
  if (runtime === 'codex') {
    return join(process.cwd(), 'codex.json');
  }
  return join(process.cwd(), '.claude', 'settings.json');
}

/**
 * Check whether a hook type is supported by the given runtime.
 * Codex lacks native hook events; guard against registering them.
 * @param {Runtime} runtime
 * @param {'SessionStart' | 'PreToolUse' | 'PostToolUse' | 'SubagentStop'} hookType
 * @returns {boolean}
 */
export function isHookSupported(runtime, hookType) {
  if (runtime === 'claude-code') return true;
  // Codex has no native hook event system
  if (runtime === 'codex') return false;
  return false;
}
