/**
 * lib/rule-evaluator.js — Spec rule evaluation engine
 *
 * Evaluates machine-checkable rules from spec frontmatter against the current
 * working tree. Each of the 5 rule types has a dedicated evaluator function.
 * Returns structured violations with specId, file, message, and evidence.
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

// ── Violation shape ───────────────────────────────────────────────────────────
// { specId, ruleType, message, files: string[], evidence: string }

// ── Glob helpers ──────────────────────────────────────────────────────────────

/**
 * Convert a glob pattern to a RegExp. Handles ** and * correctly.
 * Escapes all regex special chars in literal parts before substituting wildcards.
 * @param {string} glob
 * @returns {RegExp}
 */
function globToRegex(glob) {
  let result = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      // ** — match anything including path separators
      result += '.*';
      i += 2;
      // swallow trailing / if present
      if (glob[i] === '/') i++;
    } else if (c === '*') {
      // * — match anything except /
      result += '[^/]*';
      i++;
    } else if ('.+^${}()|[]\\'.includes(c)) {
      result += '\\' + c;
      i++;
    } else {
      result += c;
      i++;
    }
  }
  return new RegExp('^' + result);
}

/**
 * Expand a glob pattern relative to projectRoot using the shell.
 * Returns matched absolute paths. Returns [] on no matches or error.
 * @param {string} pattern
 * @param {string} projectRoot
 * @returns {string[]}
 */
function expandGlob(pattern, projectRoot) {
  try {
    const result = spawnSync('bash', ['-c', `cd ${JSON.stringify(projectRoot)} && echo ${pattern}`], {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    const output = (result.stdout ?? '').trim();
    if (!output || output === pattern) {
      // Try find-based expansion for recursive globs
      const findResult = spawnSync('bash', [
        '-c',
        `cd ${JSON.stringify(projectRoot)} && find . -path ${JSON.stringify('./' + pattern)} -type f 2>/dev/null`
      ], { encoding: 'utf8', stdio: 'pipe' });
      const paths = (findResult.stdout ?? '').trim().split('\n').filter(Boolean).map(p => join(projectRoot, p.replace(/^\.\//, '')));
      return paths;
    }
    return output.split(/\s+/).filter(Boolean).map(p => join(projectRoot, p));
  } catch {
    return [];
  }
}

/**
 * Find files matching a glob pattern using find + grep combination.
 * @param {string} pattern Glob pattern (e.g. "src/**\/*.ts")
 * @param {string} projectRoot
 * @returns {string[]} Absolute file paths
 */
function findFiles(pattern, projectRoot) {
  try {
    // Convert glob to find-compatible pattern
    const result = spawnSync('bash', [
      '-c',
      `cd ${JSON.stringify(projectRoot)} && find . -type f -name "${pattern.split('/').pop()}" 2>/dev/null | head -200`
    ], { encoding: 'utf8', stdio: 'pipe' });
    const allFiles = (result.stdout ?? '').trim().split('\n').filter(Boolean)
      .map(p => join(projectRoot, p.replace(/^\.\//, '')));

    // Filter by the directory prefix
    const dirPrefix = pattern.includes('/') ? pattern.split('/').slice(0, -1).join('/') : '';
    if (!dirPrefix || dirPrefix === '**') return allFiles;

    const dirRegex = globToRegex(dirPrefix);
    return allFiles.filter(f => {
      const rel = relative(projectRoot, f);
      return dirRegex.test(rel);
    });
  } catch {
    return [];
  }
}

/**
 * Grep for a pattern in files matching fileGlob. Returns matching lines with file paths.
 * @param {string} searchPattern Regex/string to grep for
 * @param {string} fileGlob Glob pattern for files to search
 * @param {string} projectRoot
 * @param {string[]} [excludes] Optional list of directory patterns to exclude
 * @returns {{ file: string, line: string }[]}
 */
function grepInFiles(searchPattern, fileGlob, projectRoot, excludes = []) {
  // Default exclusions: always skip node_modules and .threadwork/node_modules
  const defaultExcludes = ['node_modules', '.threadwork/node_modules', '.git'];
  const allExcludes = [...new Set([...defaultExcludes, ...excludes])];
  const excludeStr = allExcludes.map(e => `--exclude-dir=${e}`).join(' ');

  try {
    const result = spawnSync('bash', [
      '-c',
      `cd ${JSON.stringify(projectRoot)} && grep -rl ${excludeStr} ${JSON.stringify(searchPattern)} --include=${JSON.stringify(fileGlob.split('/').pop() || '*')} . 2>/dev/null | head -50`
    ], { encoding: 'utf8', stdio: 'pipe' });
    const matchingFiles = (result.stdout ?? '').trim().split('\n').filter(Boolean);

    const matches = [];
    for (const f of matchingFiles) {
      const absPath = join(projectRoot, f.replace(/^\.\//, ''));
      const lineResult = spawnSync('bash', [
        '-c',
        `grep -n ${JSON.stringify(searchPattern)} ${JSON.stringify(absPath)} 2>/dev/null | head -5`
      ], { encoding: 'utf8', stdio: 'pipe' });
      const lines = (lineResult.stdout ?? '').trim().split('\n').filter(Boolean);
      for (const line of lines) {
        matches.push({ file: absPath, line });
      }
    }
    return matches;
  } catch {
    return [];
  }
}

// ── Rule Evaluators ───────────────────────────────────────────────────────────

/**
 * grep_must_exist: Pattern MUST appear in at least one file matching the glob.
 * @param {{ type, pattern, files, message, specId }} rule
 * @param {string} projectRoot
 * @returns {{ passed: boolean, violations: object[] }}
 */
export function evaluateGrepMustExist(rule, projectRoot) {
  const { pattern, files: fileGlob, message, specId } = rule;
  if (!pattern || !fileGlob) return { passed: true, violations: [] };

  const defaultExcludes = ['node_modules', '.threadwork/node_modules', '.git'];
  const excludeStr = defaultExcludes.map(e => `--exclude-dir=${e}`).join(' ');

  try {
    const result = spawnSync('bash', [
      '-c',
      `cd ${JSON.stringify(projectRoot)} && grep -rl ${excludeStr} ${JSON.stringify(pattern)} --include=${JSON.stringify(fileGlob.split('/').pop() || '*')} . 2>/dev/null | head -1`
    ], { encoding: 'utf8', stdio: 'pipe' });
    const found = (result.stdout ?? '').trim();

    if (!found) {
      return {
        passed: false,
        violations: [{
          specId: specId ?? 'unknown',
          ruleType: 'grep_must_exist',
          message: message ?? `Pattern "${pattern}" must exist in ${fileGlob}`,
          files: [fileGlob],
          evidence: `No files matching "${fileGlob}" contain pattern "${pattern}"`
        }]
      };
    }
    return { passed: true, violations: [] };
  } catch {
    return { passed: true, violations: [] };
  }
}

/**
 * grep_must_not_exist: Pattern must NOT appear in files matching the glob.
 * @param {{ type, pattern, files, message, specId }} rule
 * @param {string} projectRoot
 * @returns {{ passed: boolean, violations: object[] }}
 */
export function evaluateGrepMustNotExist(rule, projectRoot) {
  const { pattern, files: fileGlob, message, specId, excludes: ruleExcludes = [] } = rule;
  if (!pattern || !fileGlob) return { passed: true, violations: [] };

  try {
    const matches = grepInFiles(pattern, fileGlob, projectRoot, ruleExcludes);
    if (matches.length > 0) {
      const filesWithViolations = [...new Set(matches.map(m => relative(projectRoot, m.file)))];
      return {
        passed: false,
        violations: [{
          specId: specId ?? 'unknown',
          ruleType: 'grep_must_not_exist',
          message: message ?? `Pattern "${pattern}" must not exist in ${fileGlob}`,
          files: filesWithViolations,
          evidence: matches.slice(0, 3).map(m => `${relative(projectRoot, m.file)}: ${m.line}`).join('\n')
        }]
      };
    }
    return { passed: true, violations: [] };
  } catch {
    return { passed: true, violations: [] };
  }
}

/**
 * import_boundary: Files in `from` glob cannot import from `cannot_import` globs.
 * @param {{ type, from, cannot_import, message, specId }} rule
 * @param {string} projectRoot
 * @returns {{ passed: boolean, violations: object[] }}
 */
export function evaluateImportBoundary(rule, projectRoot) {
  const { from: fromGlob, cannot_import: forbiddenGlobs, message, specId } = rule;
  if (!fromGlob || !forbiddenGlobs) return { passed: true, violations: [] };

  const forbidden = Array.isArray(forbiddenGlobs) ? forbiddenGlobs : [forbiddenGlobs];
  const violations = [];

  try {
    // Find source files in the `from` glob
    const result = spawnSync('bash', [
      '-c',
      `cd ${JSON.stringify(projectRoot)} && find . -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.mjs" \\) 2>/dev/null | head -500`
    ], { encoding: 'utf8', stdio: 'pipe' });

    const allFiles = (result.stdout ?? '').trim().split('\n').filter(Boolean)
      .map(p => p.replace(/^\.\//, ''));

    // Filter to files matching the `from` glob
    const fromRegex = globToRegex(fromGlob);
    const sourceFiles = allFiles.filter(f => fromRegex.test(f));

    for (const relFile of sourceFiles) {
      const absFile = join(projectRoot, relFile);
      let content = '';
      try { content = readFileSync(absFile, 'utf8'); } catch { continue; }

      // Extract import paths from the file
      const importMatches = [...content.matchAll(/(?:import|require)\s*(?:\(?\s*['"]([^'"]+)['"]|[^'"]*from\s+['"]([^'"]+)['"])/g)];
      const importPaths = importMatches.map(m => m[1] ?? m[2]).filter(Boolean);

      for (const importPath of importPaths) {
        // Only check relative imports
        if (!importPath.startsWith('.') && !importPath.startsWith('/')) continue;

        // Resolve to relative path from projectRoot
        let resolvedRelative;
        try {
          const dir = absFile.substring(0, absFile.lastIndexOf('/'));
          const resolved = join(dir, importPath).replace(projectRoot + '/', '');
          resolvedRelative = resolved;
        } catch { continue; }

        // Check if resolved path falls in any forbidden glob
        for (const forbiddenGlob of forbidden) {
          if (globToRegex(forbiddenGlob).test(resolvedRelative)) {
            violations.push({
              specId: specId ?? 'unknown',
              ruleType: 'import_boundary',
              message: message ?? `Files in "${fromGlob}" cannot import from "${forbiddenGlob}"`,
              files: [relFile],
              evidence: `${relFile} imports "${importPath}" which resolves to "${resolvedRelative}"`
            });
            break;
          }
        }
      }
    }
  } catch {
    return { passed: true, violations: [] };
  }

  return { passed: violations.length === 0, violations };
}

/**
 * naming_pattern: Exported names in matching files must match regex.
 * @param {{ type, pattern, files, target, message, specId }} rule
 * @param {string} projectRoot
 * @returns {{ passed: boolean, violations: object[] }}
 */
export function evaluateNamingPattern(rule, projectRoot) {
  const { pattern, files: fileGlob, target = 'export_names', message, specId } = rule;
  if (!pattern || !fileGlob) return { passed: true, violations: [] };

  const nameRegex = new RegExp(pattern);
  const violations = [];

  try {
    const result = spawnSync('bash', [
      '-c',
      `cd ${JSON.stringify(projectRoot)} && find . -type f -name ${JSON.stringify(fileGlob.split('/').pop() || '*')} 2>/dev/null | head -100`
    ], { encoding: 'utf8', stdio: 'pipe' });

    const files = (result.stdout ?? '').trim().split('\n').filter(Boolean)
      .map(p => p.replace(/^\.\//, ''));

    // Filter by directory glob prefix
    const dirPrefix = fileGlob.includes('/') ? fileGlob.split('/').slice(0, -1).join('/') : '';
    const prefixRegex = dirPrefix ? globToRegex(dirPrefix) : null;
    const matchingFiles = prefixRegex ? files.filter(f => prefixRegex.test(f)) : files;

    for (const relFile of matchingFiles) {
      const absFile = join(projectRoot, relFile);
      let content = '';
      try { content = readFileSync(absFile, 'utf8'); } catch { continue; }

      // Extract exported names
      const exportMatches = [
        ...content.matchAll(/^export\s+(?:default\s+)?(?:function|class|const|let|var|async\s+function)\s+(\w+)/gm),
        ...content.matchAll(/^export\s*\{([^}]+)\}/gm)
      ];

      const exportedNames = [];
      for (const m of exportMatches) {
        if (m[1] && !m[1].includes(',')) {
          exportedNames.push(m[1].trim());
        } else if (m[1]) {
          // Destructured export: { foo, bar as baz }
          m[1].split(',').forEach(part => {
            const name = part.includes(' as ') ? part.split(' as ')[1].trim() : part.trim();
            if (name) exportedNames.push(name);
          });
        }
      }

      for (const name of exportedNames) {
        if (!nameRegex.test(name)) {
          violations.push({
            specId: specId ?? 'unknown',
            ruleType: 'naming_pattern',
            message: message ?? `Exported names in "${fileGlob}" must match pattern "${pattern}"`,
            files: [relFile],
            evidence: `"${name}" in ${relFile} does not match pattern "${pattern}"`
          });
        }
      }
    }
  } catch {
    return { passed: true, violations: [] };
  }

  return { passed: violations.length === 0, violations };
}

/**
 * file_structure: Required file glob patterns must exist on disk.
 * @param {{ type, must_exist, message, specId }} rule
 * @param {string} projectRoot
 * @returns {{ passed: boolean, violations: object[] }}
 */
export function evaluateFileStructure(rule, projectRoot) {
  const { must_exist, message, specId } = rule;
  if (!must_exist) return { passed: true, violations: [] };

  const patterns = Array.isArray(must_exist) ? must_exist : [must_exist];
  const violations = [];

  for (const pattern of patterns) {
    try {
      const result = spawnSync('bash', [
        '-c',
        `cd ${JSON.stringify(projectRoot)} && ls ${JSON.stringify(pattern)} 2>/dev/null | head -1`
      ], { encoding: 'utf8', stdio: 'pipe' });

      // Also try find
      const findResult = spawnSync('bash', [
        '-c',
        `cd ${JSON.stringify(projectRoot)} && find . -path ${JSON.stringify('./' + pattern)} -type f 2>/dev/null | head -1`
      ], { encoding: 'utf8', stdio: 'pipe' });

      const lsFound = (result.stdout ?? '').trim();
      const findFound = (findResult.stdout ?? '').trim();

      if (!lsFound && !findFound) {
        violations.push({
          specId: specId ?? 'unknown',
          ruleType: 'file_structure',
          message: message ?? `Required file pattern "${pattern}" not found`,
          files: [pattern],
          evidence: `No file matching "${pattern}" exists in ${projectRoot}`
        });
      }
    } catch {
      // If check fails, skip (don't false-positive)
    }
  }

  return { passed: violations.length === 0, violations };
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Evaluate all rules from all specs against the project working tree.
 * @param {Array<{type: string, specId?: string, [key: string]: any}>} rules
 * @param {string} projectRoot
 * @returns {{ passed: boolean, violations: object[] }}
 */
export function evaluateRules(rules, projectRoot) {
  if (!rules || rules.length === 0) return { passed: true, violations: [] };

  const root = projectRoot ?? process.cwd();
  const allViolations = [];

  for (const rule of rules) {
    let result = { passed: true, violations: [] };
    try {
      switch (rule.type) {
        case 'grep_must_exist':
          result = evaluateGrepMustExist(rule, root);
          break;
        case 'grep_must_not_exist':
          result = evaluateGrepMustNotExist(rule, root);
          break;
        case 'import_boundary':
          result = evaluateImportBoundary(rule, root);
          break;
        case 'naming_pattern':
          result = evaluateNamingPattern(rule, root);
          break;
        case 'file_structure':
          result = evaluateFileStructure(rule, root);
          break;
        default:
          // Unknown rule type — skip gracefully
          continue;
      }
    } catch {
      // Never crash — skip this rule
      continue;
    }

    allViolations.push(...result.violations);
  }

  return {
    passed: allViolations.length === 0,
    violations: allViolations
  };
}
