/**
 * lib/verification-profile.js — Runtime verification profile loader and runner
 *
 * Manages verification profiles stored in project.json under the `verification`
 * key. Profiles define automated checks for different project types (web-app,
 * CLI, library, Obsidian plugin, etc.) and manual verification steps.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import matter from 'gray-matter';

// ── Supported profile types ───────────────────────────────────────────────────

export const PROFILE_TYPES = [
  'web-app', 'cli-tool', 'library', 'obsidian-plugin',
  'vscode-extension', 'browser-extension', 'electron-app', 'custom'
];

// ── Load profile ──────────────────────────────────────────────────────────────

/**
 * Load the verification profile from project.json.
 * Returns null if no profile is configured.
 * @param {object} projectJson Parsed project.json content
 * @returns {object|null}
 */
export function loadProfile(projectJson) {
  if (!projectJson?.verification) return null;
  const profile = projectJson.verification;

  // Validate required fields
  if (!profile.type) return null;
  if (!PROFILE_TYPES.includes(profile.type) && profile.type !== 'custom') return null;

  return {
    type: profile.type,
    build: profile.build ?? null,
    automated: profile.automated ?? [],
    manual: profile.manual ?? []
  };
}

// ── Individual check runners ──────────────────────────────────────────────────

/**
 * Verify that a JSON file matches an expected schema shape.
 * @param {{ file: string, required_keys: string[] }} check
 * @param {string} root
 * @returns {{ passed: boolean, error?: string }}
 */
export function verifyJsonSchema(check, root) {
  const { file, required_keys = [] } = check;
  if (!file) return { passed: false, error: 'check.file is required' };

  const absPath = join(root, file);
  if (!existsSync(absPath)) {
    return { passed: false, error: `File not found: ${file}` };
  }

  try {
    const data = JSON.parse(readFileSync(absPath, 'utf8'));
    const missing = required_keys.filter(k => !(k in data));
    if (missing.length > 0) {
      return { passed: false, error: `Missing required keys in ${file}: ${missing.join(', ')}` };
    }
    return { passed: true };
  } catch (err) {
    return { passed: false, error: `Failed to parse ${file}: ${err.message}` };
  }
}

/**
 * Verify that a module exports specific names.
 * @param {{ file: string, exports: string[] }} check
 * @param {string} root
 * @returns {{ passed: boolean, error?: string }}
 */
export function verifyExports(check, root) {
  const { file, exports: expectedExports = [] } = check;
  if (!file) return { passed: false, error: 'check.file is required' };

  const absPath = join(root, file);
  if (!existsSync(absPath)) {
    return { passed: false, error: `File not found: ${file}` };
  }

  try {
    const content = readFileSync(absPath, 'utf8');
    const missing = expectedExports.filter(name => {
      // Check for: export function name, export const name, export { name }, export default name (if 'default')
      const patterns = [
        new RegExp(`export\\s+(?:default\\s+)?(?:function|class|const|let|var|async\\s+function)\\s+${name}\\b`),
        new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`),
        name === 'default' ? /export\s+default\s+/ : null
      ].filter(Boolean);
      return !patterns.some(p => p.test(content));
    });

    if (missing.length > 0) {
      return { passed: false, error: `${file} is missing exports: ${missing.join(', ')}` };
    }
    return { passed: true };
  } catch (err) {
    return { passed: false, error: `Failed to read ${file}: ${err.message}` };
  }
}

/**
 * Verify that a command runs successfully (exit code 0).
 * @param {{ command: string, timeout?: number }} check
 * @param {string} root
 * @returns {{ passed: boolean, error?: string }}
 */
export function verifyCommandRuns(check, root) {
  const { command, timeout = 30000 } = check;
  if (!command) return { passed: false, error: 'check.command is required' };

  try {
    const result = spawnSync('bash', ['-c', command], {
      encoding: 'utf8',
      cwd: root,
      timeout,
      stdio: 'pipe'
    });

    if (result.status !== 0) {
      const err = ((result.stderr ?? '') + (result.stdout ?? '')).trim();
      return { passed: false, error: `Command failed (exit ${result.status}): ${err.slice(0, 200)}` };
    }
    return { passed: true };
  } catch (err) {
    return { passed: false, error: `Command error: ${err.message}` };
  }
}

/**
 * Verify that all required files exist.
 * @param {{ files: string[] }} check
 * @param {string} root
 * @returns {{ passed: boolean, error?: string }}
 */
export function verifyFilesExist(check, root) {
  const { files = [] } = check;
  const missing = files.filter(f => !existsSync(join(root, f)));
  if (missing.length > 0) {
    return { passed: false, error: `Missing required files: ${missing.join(', ')}` };
  }
  return { passed: true };
}

/**
 * Verify that forbidden patterns don't appear in matching files.
 * @param {{ pattern: string, files: string }} check
 * @param {string} root
 * @returns {{ passed: boolean, error?: string }}
 */
export function verifyNoForbiddenPatterns(check, root) {
  const { pattern, files: fileGlob = '**/*' } = check;
  if (!pattern) return { passed: true };

  try {
    const result = spawnSync('bash', [
      '-c',
      `cd ${JSON.stringify(root)} && grep -rl ${JSON.stringify(pattern)} --include=${JSON.stringify(fileGlob.split('/').pop() || '*')} . 2>/dev/null | head -5`
    ], { encoding: 'utf8', stdio: 'pipe' });

    const found = (result.stdout ?? '').trim().split('\n').filter(Boolean);
    if (found.length > 0) {
      return { passed: false, error: `Forbidden pattern "${pattern}" found in: ${found.slice(0, 3).join(', ')}` };
    }
    return { passed: true };
  } catch {
    return { passed: true };
  }
}

// ── Profile check runner ──────────────────────────────────────────────────────

/**
 * Run all automated checks defined in a verification profile.
 * @param {object} profile Loaded profile from loadProfile()
 * @param {string} projectRoot
 * @returns {{ passed: boolean, results: object[] }}
 */
export function runProfileChecks(profile, projectRoot) {
  if (!profile) return { passed: true, results: [] };
  const root = projectRoot ?? process.cwd();
  const results = [];
  let allPassed = true;

  for (const check of profile.automated ?? []) {
    const checkType = check.type;
    let result = { passed: true };

    try {
      switch (checkType) {
        case 'json_schema':
          result = verifyJsonSchema(check, root);
          break;
        case 'export_exists':
          result = verifyExports(check, root);
          break;
        case 'command_runs':
          result = verifyCommandRuns(check, root);
          break;
        case 'file_exists':
          result = verifyFilesExist(check, root);
          break;
        case 'grep_must_not_exist':
          result = verifyNoForbiddenPatterns(check, root);
          break;
        default:
          result = { passed: true, skipped: true, reason: `Unknown check type: ${checkType}` };
      }
    } catch (err) {
      result = { passed: false, error: err.message };
    }

    const checkResult = { type: checkType, description: check.description ?? checkType, ...result };
    results.push(checkResult);

    if (!result.passed && !result.skipped && check.blocking !== false) {
      allPassed = false;
    }
  }

  return { passed: allPassed, results };
}
