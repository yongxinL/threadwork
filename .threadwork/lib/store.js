/**
 * lib/store.js — Cross-session, cross-project memory Store
 *
 * The Store persists learnings that transcend project boundaries.
 * It lives at ~/.threadwork/store/ — shared across all projects.
 *
 * Promotion pipeline:
 *   Ralph Loop rejection → spec proposal (0.3)
 *   → developer accepts → (0.7)
 *   → survives 3+ sessions → auto-promoted to Store (0.85)
 *
 * Source: LangChain three-source context model (Runtime Context / State / Store)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STORE_VERSION = '1';

// The Store is global — shared across all Threadwork projects.
// THREADWORK_STORE_DIR env var overrides for testing.
function globalStoreDir() {
  if (process.env.THREADWORK_STORE_DIR) return process.env.THREADWORK_STORE_DIR;
  return join(homedir(), '.threadwork', 'store');
}

function storeIndexPath() {
  return join(globalStoreDir(), 'store-index.json');
}

function domainDir(domain) {
  return join(globalStoreDir(), domain);
}

function ensureStoreDir() {
  for (const domain of ['patterns', 'edge-cases', 'conventions']) {
    mkdirSync(domainDir(domain), { recursive: true });
  }
}

function readIndex() {
  const p = storeIndexPath();
  if (!existsSync(p)) return { _version: STORE_VERSION, entries: [] };
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch {
    return { _version: STORE_VERSION, entries: [] };
  }
}

function writeIndex(data) {
  ensureStoreDir();
  writeFileSync(storeIndexPath(), JSON.stringify({
    _version: STORE_VERSION,
    _updated: new Date().toISOString(),
    ...data
  }, null, 2), 'utf8');
}

// ── Core API ──────────────────────────────────────────────────────────────────

/**
 * Read all Store entries, optionally filtered by domain.
 * @param {string} [domain] - 'patterns', 'edge-cases', or 'conventions'
 * @returns {Array<object>} Array of entry index records
 */
export function readStore(domain) {
  const index = readIndex();
  const entries = index.entries ?? [];
  if (domain) return entries.filter(e => e.domain === domain);
  return entries;
}

/**
 * Write a new Store entry.
 * @param {string} domain - 'patterns', 'edge-cases', or 'conventions'
 * @param {string} key - Unique identifier (e.g. 'jwt-refresh-rotation')
 * @param {object} data - { content, tags, confidence, source, projects }
 * @returns {string} Entry ID (e.g. 'STORE:jwt-001')
 */
export function writeEntry(domain, key, data) {
  ensureStoreDir();
  const validDomains = ['patterns', 'edge-cases', 'conventions'];
  if (!validDomains.includes(domain)) {
    throw new Error(`Invalid Store domain: ${domain}. Must be one of: ${validDomains.join(', ')}`);
  }

  const index = readIndex();
  const entries = index.entries ?? [];

  // Generate entry ID
  const domainEntries = entries.filter(e => e.domain === domain);
  const entryNum = String(domainEntries.length + 1).padStart(3, '0');
  const domainShort = { patterns: 'pat', 'edge-cases': 'edge', conventions: 'conv' }[domain];
  const entryId = `STORE:${domainShort}-${entryNum}`;

  const date = new Date().toISOString().slice(0, 10);
  const filename = `${date}-${key.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.md`;
  const filePath = join(domainDir(domain), filename);

  // Write the entry file with frontmatter
  const frontmatter = [
    '---',
    `domain: ${domain}`,
    `key: ${key}`,
    `entryId: ${entryId}`,
    `created: ${date}`,
    `confidence: ${data.confidence ?? 0.85}`,
    `tags: [${(data.tags ?? []).join(', ')}]`,
    `projects: [${(data.projects ?? []).join(', ')}]`,
    `source: ${data.source ?? 'manual'}`,
    '---'
  ].join('\n');

  writeFileSync(filePath, `${frontmatter}\n\n${data.content ?? ''}`, 'utf8');

  // Update index
  entries.push({
    entryId,
    domain,
    key,
    confidence: data.confidence ?? 0.85,
    tags: data.tags ?? [],
    filename,
    createdAt: new Date().toISOString()
  });
  writeIndex({ entries });

  return entryId;
}

/**
 * Update an existing Store entry's confidence or content.
 * @param {string} key - The entry key
 * @param {object} data - Fields to update
 */
export function updateEntry(key, data) {
  const index = readIndex();
  const entries = index.entries ?? [];
  const entry = entries.find(e => e.key === key);
  if (!entry) throw new Error(`Store entry not found: ${key}`);

  const filePath = join(domainDir(entry.domain), entry.filename);
  if (!existsSync(filePath)) throw new Error(`Store entry file not found: ${filePath}`);

  const content = readFileSync(filePath, 'utf8');
  // Simple confidence update: replace in frontmatter
  let updated = content;
  if (data.confidence !== undefined) {
    updated = updated.replace(/^confidence:\s*.+$/m, `confidence: ${data.confidence}`);
    entry.confidence = data.confidence;
  }
  if (data.content !== undefined) {
    // Replace everything after frontmatter
    const fmEnd = updated.indexOf('\n---\n', 4) + 5;
    updated = updated.slice(0, fmEnd) + '\n' + data.content;
  }
  writeFileSync(filePath, updated, 'utf8');
  writeIndex({ entries });
}

/**
 * Read a specific Store entry by ID or key.
 * @param {string} idOrKey - Entry ID (e.g. 'STORE:pat-001') or key
 * @returns {string} Full entry content or error message
 */
export function readEntry(idOrKey) {
  const index = readIndex();
  const entries = index.entries ?? [];
  const entry = entries.find(e => e.entryId === idOrKey || e.key === idOrKey);
  if (!entry) return `Store entry not found: ${idOrKey}. Run /tw:store list to see available entries.`;

  const filePath = join(domainDir(entry.domain), entry.filename);
  if (!existsSync(filePath)) return `Store entry file missing: ${filePath}`;
  return readFileSync(filePath, 'utf8');
}

/**
 * Promote a spec proposal to the Store.
 * Requires confidence >= 0.7 unless called from /tw:store promote (manual bypass).
 *
 * @param {object} specProposal - { filePath, content, manualPromotion }
 * @returns {string|null} Entry ID if promoted, null if ineligible
 */
export function promoteToStore(specProposal) {
  const { filePath, content, manualPromotion = false } = specProposal;

  // Parse confidence from content
  const confMatch = (content ?? '').match(/confidence:\s*([\d.]+)/);
  const confidence = confMatch ? parseFloat(confMatch[1]) : 0;

  if (!manualPromotion && confidence < 0.7) {
    return null; // Not eligible for auto-promotion
  }

  // Extract fields from proposal frontmatter
  const learningSignalMatch = content.match(/learningSignal:\s*"?([^"\n]+)"?/);
  const specNameMatch = content.match(/specName:\s*([^\n]+)/);
  const key = (learningSignalMatch?.[1] ?? specNameMatch?.[1] ?? 'unknown-pattern')
    .replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 50);

  // Extract actual content (after frontmatter)
  const contentBody = (content ?? '').replace(/^---[\s\S]*?---\n/, '').trim();
  const tagsMatch = content.match(/tags:\s*\[([^\]]*)\]/);
  const tags = tagsMatch ? tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean) : [];

  const entryId = writeEntry('patterns', key, {
    content: contentBody || `Pattern derived from spec proposal: ${key}`,
    confidence: manualPromotion ? Math.max(confidence, 0.75) : 0.85,
    tags,
    source: 'ralph-loop-finding',
    projects: []
  });

  // Mark the original proposal as promoted
  if (filePath && existsSync(filePath)) {
    try {
      const proposalContent = readFileSync(filePath, 'utf8');
      const markedContent = proposalContent.replace(
        /^---/,
        `---\npromoted: true\npromotedTo: ${entryId}\npromotedAt: ${new Date().toISOString()}`
      );
      writeFileSync(filePath, markedContent, 'utf8');
    } catch { /* never crash */ }
  }

  return entryId;
}

/**
 * Full-text + tag search across Store entries.
 * @param {string} query
 * @returns {Array<{ entryId: string, domain: string, key: string, excerpt: string }>}
 */
export function searchStore(query) {
  const q = (query ?? '').toLowerCase();
  const results = [];
  const index = readIndex();

  for (const entry of (index.entries ?? [])) {
    const tagMatch = entry.tags?.some(t => t.toLowerCase().includes(q));
    const keyMatch = entry.key?.toLowerCase().includes(q);
    if (!tagMatch && !keyMatch) {
      // Try content search
      try {
        const filePath = join(domainDir(entry.domain), entry.filename);
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, 'utf8');
          if (!content.toLowerCase().includes(q)) continue;
          const lines = content.split('\n');
          const matchLine = lines.find(l => l.toLowerCase().includes(q)) ?? '';
          results.push({ ...entry, excerpt: matchLine.trim().slice(0, 120) });
          continue;
        }
      } catch { /* skip */ }
      continue;
    }
    results.push({ ...entry, excerpt: `${entry.domain}/${entry.key}` });
  }

  return results;
}

/**
 * Get a compact Store summary block for session-start injection.
 * Target: under 100 tokens (~400 chars).
 * @returns {string|null} Formatted block or null if store is empty
 */
export function getStoreInjectionBlock() {
  const entries = readStore();
  if (entries.length === 0) return null;

  // Select top 3 by confidence
  const top = [...entries]
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, 3);

  const lines = [
    '── STORE ────────────────────────────────────────────'
  ];

  if (top.length > 0) {
    lines.push(`${top.length} relevant entries:`);
    for (const e of top) {
      lines.push(`  [${e.entryId}]  ${e.key} (conf: ${e.confidence?.toFixed(2) ?? '?'})`);
    }
  }

  lines.push('Fetch full entry: store_fetch <entry_id>');
  lines.push('─────────────────────────────────────────────────────');

  return lines.join('\n');
}

/**
 * Remove low-confidence Store entries below threshold.
 * @param {number} [threshold=0.4]
 * @returns {number} Number of entries removed
 */
export function pruneStore(threshold = 0.4) {
  const index = readIndex();
  const entries = index.entries ?? [];
  const keep = [];
  let pruned = 0;

  for (const entry of entries) {
    if ((entry.confidence ?? 1) < threshold) {
      // Attempt to delete the file
      try {
        const filePath = join(domainDir(entry.domain), entry.filename);
        if (existsSync(filePath)) unlinkSync(filePath);
      } catch { /* never crash */ }
      pruned++;
    } else {
      keep.push(entry);
    }
  }

  writeIndex({ entries: keep });
  return pruned;
}

/**
 * Get the confidence score for a Store entry by key or ID.
 * @param {string} key
 * @returns {number} Confidence 0.0–1.0, or 0 if not found
 */
export function getEntryConfidence(key) {
  const entries = readStore();
  const entry = entries.find(e => e.key === key || e.entryId === key);
  return entry?.confidence ?? 0;
}
