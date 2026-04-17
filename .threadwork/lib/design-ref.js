/**
 * lib/design-ref.js — Design reference resolution, validation, and injection
 *
 * Resolves design references from spec frontmatter, validates that referenced
 * files exist on disk, and builds context injection blocks for executors and
 * reviewers. Supports image, HTML/CSS, and SVG file formats.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';
import matter from 'gray-matter';

// ── Constants ─────────────────────────────────────────────────────────────────

const HTML_PREVIEW_LINES = 200;
const SVG_MAX_FULL_LINES = 500;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp']);
const SVG_EXTENSIONS = new Set(['.svg']);
const HTML_EXTENSIONS = new Set(['.html', '.htm', '.css']);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Check if a file path is an image.
 * @param {string} filePath
 * @returns {boolean}
 */
function isImage(filePath) {
  return IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

/**
 * Check if a file path is SVG.
 * @param {string} filePath
 * @returns {boolean}
 */
function isSvg(filePath) {
  return SVG_EXTENSIONS.has(extname(filePath).toLowerCase());
}

/**
 * Check if a file path is HTML or CSS.
 * @param {string} filePath
 * @returns {boolean}
 */
function isHtmlOrCss(filePath) {
  return HTML_EXTENSIONS.has(extname(filePath).toLowerCase());
}

/**
 * Match a task file path against a scope glob.
 * Supports ** and * wildcards.
 * @param {string} scope Glob pattern
 * @param {string} filePath
 * @returns {boolean}
 */
function scopeMatches(scope, filePath) {
  if (!scope) return true;
  const regexStr = scope
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape special regex chars (except * and ?)
    .replace(/\\\*\\\*/g, '.*')
    .replace(/\\\*/g, '[^/]*')
    .replace(/\?/g, '.');
  try {
    return new RegExp('^' + regexStr + '(/.*)?$').test(filePath) ||
           new RegExp(regexStr).test(filePath);
  } catch {
    return filePath.includes(scope.replace(/\*\*/g, '').replace(/\*/g, ''));
  }
}

/**
 * Fidelity sort order: exact (0) > structural (1) > reference (2)
 */
function fidelityOrder(fidelity) {
  switch (fidelity) {
    case 'exact': return 0;
    case 'structural': return 1;
    case 'reference': return 2;
    default: return 1;
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Scan all specs for design_refs frontmatter and return a flat array.
 * @param {string} specsDir Path to .threadwork/specs/
 * @param {string} projectRoot
 * @returns {object[]} Array of DesignRef objects
 */
export function loadDesignRefs(specsDir, projectRoot) {
  const refs = [];

  if (!existsSync(specsDir)) return refs;

  function walkDir(dir) {
    try {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        try {
          const stat = statSync(full);
          if (stat.isDirectory()) {
            walkDir(full);
          } else if (entry.endsWith('.md') && entry !== 'index.md') {
            const parsed = matter(readFileSync(full, 'utf8'));
            const specId = parsed.data.specId ?? relative(specsDir, full).replace('.md', '');
            const designRefs = parsed.data.design_refs ?? [];

            for (const ref of designRefs) {
              if (!ref.path) continue;
              const absolutePath = join(projectRoot, ref.path);
              refs.push({
                specId,
                path: ref.path,
                absolutePath,
                label: ref.label ?? ref.path,
                scope: ref.scope ?? '',
                fidelity: ref.fidelity ?? 'structural',
                exists: existsSync(absolutePath)
              });
            }
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  walkDir(specsDir);
  return refs;
}

/**
 * Given a list of task file paths, find all design refs whose scope matches.
 * Returns sorted by fidelity (exact first).
 * @param {object[]} designRefs DesignRef objects from loadDesignRefs()
 * @param {string[]} taskFiles File paths from the task XML
 * @returns {object[]}
 */
export function resolveDesignRefsForFiles(designRefs, taskFiles) {
  if (!designRefs || designRefs.length === 0) return [];
  if (!taskFiles || taskFiles.length === 0) return designRefs.filter(r => !r.scope);

  const matched = designRefs.filter(ref => {
    if (!ref.scope) return true; // Global refs apply to all files
    return taskFiles.some(file => scopeMatches(ref.scope, file));
  });

  return matched.sort((a, b) => fidelityOrder(a.fidelity) - fidelityOrder(b.fidelity));
}

/**
 * Validate that all design refs point to existing files.
 * @param {object[]} designRefs
 * @param {string} projectRoot
 * @returns {{ valid: object[], missing: object[] }}
 */
export function validateDesignRefs(designRefs, projectRoot) {
  const valid = [];
  const missing = [];

  for (const ref of designRefs) {
    const absPath = ref.absolutePath ?? join(projectRoot, ref.path);
    if (existsSync(absPath)) {
      valid.push({ ...ref, absolutePath: absPath, exists: true });
    } else {
      missing.push({ specId: ref.specId, path: ref.path, label: ref.label });
    }
  }

  return { valid, missing };
}

/**
 * Build a context block for injection into executor or reviewer prompts.
 * - Images: instruction to Read the file path (agent reads it visually via multimodal)
 * - HTML/CSS: truncated preview (first HTML_PREVIEW_LINES lines) + full path
 * - SVG: full content if < SVG_MAX_FULL_LINES lines, else just path
 *
 * @param {object[]} matchedRefs Matched design refs with absolutePath
 * @param {string} projectRoot
 * @returns {string} Markdown block
 */
export function buildDesignInjectionBlock(matchedRefs, projectRoot) {
  if (!matchedRefs || matchedRefs.length === 0) return '';

  const lines = [
    '── DESIGN REFERENCES ────────────────────────────────',
  ];

  for (const ref of matchedRefs) {
    if (!ref.exists && !existsSync(ref.absolutePath ?? join(projectRoot, ref.path))) {
      lines.push(`⚠ [${ref.specId}] ${ref.label} — FILE NOT FOUND: ${ref.path}`);
      continue;
    }

    const absPath = ref.absolutePath ?? join(projectRoot, ref.path);
    const fidelityLabel = ref.fidelity === 'exact' ? 'pixel-perfect' :
      ref.fidelity === 'structural' ? 'structural fidelity' : 'reference/inspiration';

    lines.push(`\n### ${ref.label} (${fidelityLabel})`);
    lines.push(`Spec: ${ref.specId} | Path: ${ref.path}`);

    if (isImage(ref.path)) {
      lines.push(`**Action required**: Read the design file to see the visual reference:`);
      lines.push(`  File path: ${absPath}`);
      lines.push(`  Use the Read tool on this path to view the image before implementing.`);
    } else if (isHtmlOrCss(ref.path)) {
      try {
        const content = readFileSync(absPath, 'utf8');
        const allLines = content.split('\n');
        const preview = allLines.slice(0, HTML_PREVIEW_LINES).join('\n');
        const truncated = allLines.length > HTML_PREVIEW_LINES;
        lines.push(`**HTML/CSS prototype** (${allLines.length} lines total):`);
        lines.push('```html');
        lines.push(preview);
        if (truncated) lines.push(`... (${allLines.length - HTML_PREVIEW_LINES} more lines — full file at: ${absPath})`);
        lines.push('```');
      } catch {
        lines.push(`Full file at: ${absPath}`);
      }
    } else if (isSvg(ref.path)) {
      try {
        const content = readFileSync(absPath, 'utf8');
        const svgLines = content.split('\n');
        if (svgLines.length <= SVG_MAX_FULL_LINES) {
          lines.push('```svg');
          lines.push(content);
          lines.push('```');
        } else {
          lines.push(`SVG file (${svgLines.length} lines) — read from: ${absPath}`);
        }
      } catch {
        lines.push(`SVG at: ${absPath}`);
      }
    } else {
      lines.push(`Design file at: ${absPath}`);
    }
  }

  lines.push('\n─────────────────────────────────────────────────────');
  return lines.join('\n');
}

/**
 * Build a review checklist for tw-reviewer to compare implementation against design.
 * Checklist items are fidelity-appropriate.
 * @param {object[]} matchedRefs
 * @returns {string}
 */
export function buildDesignReviewBlock(matchedRefs) {
  if (!matchedRefs || matchedRefs.length === 0) return '';

  const lines = ['### Design Fidelity Review'];

  for (const ref of matchedRefs) {
    lines.push(`\n**${ref.label}** (${ref.path}, ${ref.fidelity ?? 'structural'} fidelity)`);

    switch (ref.fidelity) {
      case 'exact':
        lines.push('- [ ] Layout matches design exactly (spacing, alignment, proportions)');
        lines.push('- [ ] Colors, fonts, and visual hierarchy match the design file');
        lines.push('- [ ] All UI elements present and positioned as shown');
        lines.push('- [ ] Responsive behavior matches design at specified breakpoints');
        lines.push('- [ ] No visual regressions vs. reference image');
        break;
      case 'structural':
        lines.push('- [ ] Overall layout structure matches the design reference');
        lines.push('- [ ] All required UI sections/components are present');
        lines.push('- [ ] Visual hierarchy is preserved (what is prominent, what is secondary)');
        lines.push('- [ ] Functional flow matches the prototype intent');
        break;
      case 'reference':
      default:
        lines.push('- [ ] Key design concepts and patterns are reflected in implementation');
        lines.push('- [ ] Implementation serves the same user goals as the reference');
        lines.push('- [ ] No major structural divergences from reference intent');
        break;
    }
  }

  return lines.join('\n');
}
