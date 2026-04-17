/**
 * lib/git.js — Git operations
 *
 * Wraps common git operations used by executor agents and state management.
 * Uses child_process.execSync for all git calls.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Run a git command and return trimmed stdout.
 * Throws with a clean message on failure.
 * @param {string} cmd
 * @param {string} [cwd]
 * @returns {string}
 */
function git(cmd, cwd) {
  try {
    return execSync(`git ${cmd}`, {
      encoding: 'utf8',
      cwd: cwd ?? process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch (err) {
    const stderr = err.stderr?.toString().trim() ?? '';
    throw new Error(`git ${cmd.split(' ')[0]} failed: ${stderr || err.message}`);
  }
}

/**
 * Get the current git branch name.
 * @param {string} [cwd]
 * @returns {string}
 */
export function getCurrentBranch(cwd) {
  try {
    return git('rev-parse --abbrev-ref HEAD', cwd);
  } catch {
    return 'unknown';
  }
}

/**
 * Get the SHA of the last commit.
 * @param {string} [cwd]
 * @returns {string}
 */
export function getLastCommitSha(cwd) {
  try {
    return git('rev-parse HEAD', cwd);
  } catch {
    return 'unknown';
  }
}

/**
 * Get list of uncommitted files (modified, staged, untracked).
 * @param {string} [cwd]
 * @returns {string[]}
 */
export function getUncommittedFiles(cwd) {
  try {
    const output = git('status --porcelain', cwd);
    return output
      .split('\n')
      .filter(Boolean)
      .map(line => line.slice(3).trim());
  } catch {
    return [];
  }
}

/**
 * Stage all changes and create an atomic commit.
 * Uses conventional commit format: "type(scope): description"
 * @param {string} message Commit message
 * @param {string} [cwd]
 */
export function writeAtomicCommit(message, cwd) {
  git('add -A', cwd);
  // Use execSync directly to handle quotes in message safely
  execSync(`git commit -m ${JSON.stringify(message)}`, {
    encoding: 'utf8',
    cwd: cwd ?? process.cwd(),
    stdio: 'inherit'
  });
}

/**
 * Create a git worktree at .threadwork/worktrees/<name>.
 * @param {string} name Worktree name (also used as branch name)
 * @param {string} [branch] Branch to create (defaults to name)
 * @param {string} [cwd]
 * @returns {string} Path to created worktree
 */
export function createWorktree(name, branch, cwd) {
  const worktreePath = join(cwd ?? process.cwd(), '.threadwork', 'worktrees', name);
  const branchName = branch ?? `tw-parallel/${name}`;

  if (!existsSync(join(cwd ?? process.cwd(), '.threadwork', 'worktrees'))) {
    mkdirSync(join(cwd ?? process.cwd(), '.threadwork', 'worktrees'), { recursive: true });
  }

  git(`worktree add -b ${JSON.stringify(branchName)} ${JSON.stringify(worktreePath)}`, cwd);
  return worktreePath;
}

/**
 * Remove a git worktree by name.
 * @param {string} name
 * @param {string} [cwd]
 */
export function removeWorktree(name, cwd) {
  const worktreePath = join(cwd ?? process.cwd(), '.threadwork', 'worktrees', name);
  git(`worktree remove --force ${JSON.stringify(worktreePath)}`, cwd);
}

/**
 * Get files changed since a specific commit SHA.
 * @param {string} sinceSha
 * @param {string} [cwd]
 * @returns {string[]}
 */
export function getFilesChangedSince(sinceSha, cwd) {
  try {
    const output = git(`diff --name-only ${sinceSha} HEAD`, cwd);
    return output.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Check if the current directory is a git repository.
 * @returns {boolean}
 */
export function isGitRepo() {
  try {
    git('rev-parse --is-inside-work-tree');
    return true;
  } catch {
    return false;
  }
}
