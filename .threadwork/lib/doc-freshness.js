/**
 * lib/doc-freshness.js — Spec reference integrity and staleness gate
 *
 * Detects stale or broken references in spec files: dead file references,
 * dead cross-spec references, missing library references, empty rule targets,
 * and age-based staleness. Registered as the doc-freshness quality gate.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { spawnSync } from 'child_process';
import matter from 'gray-matter';

// ── Constants ─────────────────────────────────────────────────────────────────

const AGE_STALENESS_DAYS = 90;     // Specs older than this + with changed files are stale
const FILE_CHANGE_THRESHOLD = 0.5; // 50% of referenced files changed → age staleness warning

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAllSpecFiles(specsDir) {
  const files = [];
  if (!existsSync(specsDir)) return files;

  function walk(dir) {
    try {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        try {
          const stat = statSync(full);
          if (stat.isDirectory()) {
            walk(full);
          } else if (entry.endsWith('.md') && entry !== 'index.md') {
            files.push(full);
          }
        } catch { /* skip unreadable */ }
      }
    } catch { /* skip unreadable dir */ }
  }

  walk(specsDir);
  return files;
}

function parseSpec(filePath) {
  try {
    return matter(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Build a map of all specIds in the library.
 * @param {string[]} specFiles
 * @returns {Set<string>}
 */
function buildSpecIdSet(specFiles) {
  const ids = new Set();
  for (const f of specFiles) {
    const parsed = parseSpec(f);
    if (parsed?.data?.specId) ids.add(parsed.data.specId);
  }
  return ids;
}

/**
 * Extract file references from spec content.
 * Looks for: markdown links [text](path), inline code paths `src/...`, and backtick paths.
 * @param {string} content
 * @param {string} projectRoot
 * @returns {string[]} Relative file paths mentioned in the spec
 */
export function extractFileReferences(content, projectRoot) {
  const refs = new Set();

  // Markdown links: [text](path/to/file.ts)
  const linkMatches = content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
  for (const m of linkMatches) {
    const href = m[2].trim();
    // Only local file references (not http/https/anchors)
    if (!href.startsWith('http') && !href.startsWith('#')) {
      refs.add(href.split('#')[0]); // strip anchor
    }
  }

  // Inline code paths: `src/lib/auth.ts` or `src/components/Button.tsx`
  const codeMatches = content.matchAll(/`((?:src|lib|tests?|hooks?|components?|pages?|app|dist|build)[/\\][^`\s]+)`/g);
  for (const m of codeMatches) {
    refs.add(m[1]);
  }

  // Filter to paths that look like files (have an extension or are clearly paths)
  return [...refs].filter(ref => {
    // Keep paths with common code extensions or slashes
    return ref.includes('/') || /\.\w{1,5}$/.test(ref);
  });
}

/**
 * Extract specId cross-references from spec content.
 * Looks for: SPEC:xxx-NNN patterns.
 * @param {string} content
 * @returns {string[]}
 */
function extractSpecIdRefs(content) {
  const matches = [...content.matchAll(/SPEC:[a-zA-Z0-9_-]+-\d{3}/g)];
  return [...new Set(matches.map(m => m[0]))];
}

/**
 * Get the number of days since a file was last modified.
 * @param {string} filePath
 * @returns {number}
 */
function daysSinceModified(filePath) {
  try {
    const stat = statSync(filePath);
    const mtime = stat.mtimeMs;
    return Math.floor((Date.now() - mtime) / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
}

/**
 * Get files changed since a given date using git.
 * @param {string} since ISO date string or relative date like "90 days ago"
 * @param {string} projectRoot
 * @returns {string[]}
 */
function getFilesChangedSince(since, projectRoot) {
  try {
    const result = spawnSync('git', [
      'log', '--since', since, '--name-only', '--pretty=format:', '--diff-filter=M'
    ], { encoding: 'utf8', cwd: projectRoot, stdio: 'pipe' });
    return (result.stdout ?? '').trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// ── Main check function ───────────────────────────────────────────────────────

/**
 * Check all specs for reference integrity and staleness.
 *
 * Issue types:
 *   dead_reference (error, blocking) — spec references a file that doesn't exist
 *   dead_cross_reference (error, blocking) — spec references a specId that doesn't exist
 *   dead_library_reference (warning) — spec references a library not in package.json
 *   empty_rule_target (warning) — rule glob matches no files
 *   age_staleness (warning) — spec is old and >50% of referenced files have changed
 *   dead_design_reference (error, blocking) — design_refs path doesn't exist
 *
 * @param {string} specsDir Path to .threadwork/specs/
 * @param {string} projectRoot
 * @returns {{ passed: boolean, issues: object[] }}
 */
export function checkDocFreshness(specsDir, projectRoot) {
  const issues = [];
  const root = projectRoot ?? process.cwd();
  const specFiles = getAllSpecFiles(specsDir);
  const allSpecIds = buildSpecIdSet(specFiles);

  // Load package.json for library reference checking
  let packageDeps = new Set();
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
    packageDeps = new Set(Object.keys(allDeps));
  } catch { /* no package.json */ }

  // Files changed in the last AGE_STALENESS_DAYS days
  const recentlyChangedFiles = getFilesChangedSince(`${AGE_STALENESS_DAYS} days ago`, root);

  for (const specFile of specFiles) {
    const parsed = parseSpec(specFile);
    if (!parsed) continue;

    const { data, content } = parsed;
    const specId = data.specId ?? relative(specsDir, specFile);
    const specUpdated = data.updated ? new Date(data.updated) : null;

    // ── dead_reference ─────────────────────────────────────────────────────
    const fileRefs = extractFileReferences(content, root);
    for (const ref of fileRefs) {
      const absRef = join(root, ref);
      if (!existsSync(absRef)) {
        issues.push({
          type: 'dead_reference',
          severity: 'error',
          specId,
          message: `Spec "${specId}" references file "${ref}" which does not exist`,
          file: ref
        });
      }
    }

    // ── dead_cross_reference ───────────────────────────────────────────────
    const crossRefs = extractSpecIdRefs(content);
    for (const ref of crossRefs) {
      if (ref === specId) continue; // Self-reference is fine
      if (!allSpecIds.has(ref)) {
        issues.push({
          type: 'dead_cross_reference',
          severity: 'error',
          specId,
          message: `Spec "${specId}" references spec ID "${ref}" which does not exist in the library`,
          file: relative(specsDir, specFile)
        });
      }
    }

    // ── dead_library_reference ─────────────────────────────────────────────
    if (packageDeps.size > 0) {
      const libraryRefs = [...content.matchAll(/\b(?:install|use|import|require)\s+[`'"]?([a-z@][a-z0-9/_-]+)[`'"]?/gi)];
      for (const m of libraryRefs) {
        const lib = m[1].split('/')[0]; // Get package root (e.g. "@scope/pkg" → "@scope/pkg")
        if (lib.length > 1 && !packageDeps.has(lib) && !lib.startsWith('node:') && !lib.startsWith('.')) {
          // Only warn for well-known package patterns (not typos or words)
          if (/^[@a-z][a-z0-9-]*$/.test(lib) || lib.startsWith('@')) {
            issues.push({
              type: 'dead_library_reference',
              severity: 'warning',
              specId,
              message: `Spec "${specId}" references library "${lib}" which is not in package.json`,
              file: lib
            });
            break; // Only report once per spec for library refs
          }
        }
      }
    }

    // ── empty_rule_target ─────────────────────────────────────────────────
    const rules = data.rules ?? [];
    for (const rule of rules) {
      const fileGlob = rule.files ?? rule.from;
      if (!fileGlob) continue;

      try {
        const result = spawnSync('bash', [
          '-c',
          `cd ${JSON.stringify(root)} && find . -type f -name ${JSON.stringify(fileGlob.split('/').pop() || '*')} 2>/dev/null | head -1`
        ], { encoding: 'utf8', stdio: 'pipe' });
        const found = (result.stdout ?? '').trim();
        if (!found) {
          issues.push({
            type: 'empty_rule_target',
            severity: 'warning',
            specId,
            message: `Spec "${specId}" rule targets glob "${fileGlob}" which matches no files`,
            file: fileGlob
          });
        }
      } catch { /* skip */ }
    }

    // ── age_staleness ──────────────────────────────────────────────────────
    if (specUpdated && fileRefs.length > 0) {
      const ageDays = Math.floor((Date.now() - specUpdated.getTime()) / (1000 * 60 * 60 * 24));
      if (ageDays >= AGE_STALENESS_DAYS) {
        const changedCount = fileRefs.filter(ref =>
          recentlyChangedFiles.some(cf => cf.includes(ref) || ref.includes(cf))
        ).length;
        const changeFraction = changedCount / fileRefs.length;
        if (changeFraction >= FILE_CHANGE_THRESHOLD) {
          issues.push({
            type: 'age_staleness',
            severity: 'warning',
            specId,
            message: `Spec "${specId}" is ${ageDays} days old and ${Math.round(changeFraction * 100)}% of referenced files have changed recently`,
            file: relative(specsDir, specFile)
          });
        }
      }
    }

    // ── dead_design_reference ──────────────────────────────────────────────
    const designRefs = data.design_refs ?? [];
    for (const ref of designRefs) {
      if (!ref.path) continue;
      const absRef = join(root, ref.path);
      if (!existsSync(absRef)) {
        issues.push({
          type: 'dead_design_reference',
          severity: 'error',
          specId,
          message: `Spec "${specId}" has dead design reference: "${ref.path}" (${ref.label ?? 'no label'})`,
          file: ref.path
        });
      }
    }
  }

  // Passed = no blocking errors (warnings are allowed)
  const hasBlockingIssues = issues.some(i => i.severity === 'error');

  return {
    passed: !hasBlockingIssues,
    issues
  };
}
