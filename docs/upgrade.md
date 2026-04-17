# Threadwork — Upgrade Guide

> Single reference for upgrading from any version.

---

## v0.3.3 — Hook Resilience Patch (2026-04-17)

No migration command. Just run:

```bash
threadwork update
```

This patches `~/.claude/settings.json` in-place to use the new bash-wrapper hook commands, then restarts cleanly.

### What changed

| Component | Before | After |
|-----------|--------|-------|
| Hook commands in `~/.claude/settings.json` | `node .threadwork/hooks/X.js` | `bash -c '[ -f .threadwork/hooks/X.js ] && node ... \|\| exit 0'` |
| `threadwork update` output | No global settings check | Reports `~/.claude/settings.json` hook command status |

### Why

The bare `node` form threw `ERR_MODULE_NOT_FOUND` whenever Claude ran in a directory without a `.threadwork/hooks/` directory (any non-initialized project, including the Threadwork repo itself). The error was non-blocking but produced noisy output on every tool call.

### Post-upgrade step

Restart Claude Code after running `threadwork update` — hooks are loaded at session start.

### No breaking changes

Initialized projects work identically. Non-initialized directories now produce zero hook output instead of error noise.

---

## v0.3.2 → v0.3.3 — Self-Evolution (2026-04-15)

Run:
```bash
threadwork update --to v0.3.3
```

### What changes

| Step | What | Impact |
|------|------|--------|
| 1 | Spec templates restructured: `templates/specs/` → `templates/specs/core/` | Internal to Threadwork repo — no project-side impact |
| 2 | New learned spec directories: `templates/specs/learned/`, `templates/specs/proposals/` | Internal to Threadwork repo |
| 3 | New `lib/harvest.js` copied to `.threadwork/lib/` | Knowledge harvest engine for `/tw:done` |
| 4 | Updated `lib/spec-engine.js` with stack-aware relevance boosting | Better spec matching based on project techStack |
| 5 | New `/tw:harvest` command installed | Review/approve/reject learned specs |
| 6 | Updated `/tw:done` command with harvest step | Auto-extracts knowledge at session end |
| 7 | Updated `tw-reviewer.md` with Check 7: Anti-Pattern Detection | 12 named anti-patterns in code review |
| 8 | New core specs: `backend/db-schema.md`, `backend/ts-patterns.md`, `backend/python-patterns.md` | Richer starter specs with enforcement rules |
| 9 | Updated core specs: `backend/api-design.md`, `backend/auth.md`, `testing/testing-standards.md` | Two-tier format: agnostic rules + specIds |

### Manual steps (optional)

**Refresh your project's starter specs:**

If you want the upgraded Tier 1 specs in an existing project (recommended):

```bash
# From your project directory:
threadwork update
```

This copies new/updated framework files (hooks, lib, commands, agents) but does NOT overwrite your custom specs. To also get the new core specs:

```bash
# Preview what's new
threadwork update --verify

# Apply updates
threadwork update
```

New specs (`db-schema.md`, `ts-patterns.md`, `python-patterns.md`) are added automatically. Existing specs (`api-design.md`, `auth.md`, `testing-standards.md`) are NOT overwritten — your customizations are preserved. To get the upgraded versions, manually copy them:

```bash
cp templates/specs/core/backend/api-design.md .threadwork/specs/backend/api-design.md
cp templates/specs/core/backend/auth.md .threadwork/specs/backend/auth.md
cp templates/specs/core/testing/testing-standards.md .threadwork/specs/testing/testing-standards.md
```

### No breaking changes

- Existing projects continue to work without any changes
- The harvest step in `/tw:done` is additive — it writes proposals, never modifies existing project files
- Stack-aware relevance boosting is backward-compatible — projects without `techStack` in `project.json` use keyword-only scoring (same as before)

---

## v0.3.2 Patch — Output Filter (2026-04-14)

If you are already running v0.3.2 and want the output filter feature, add the `outputFilter` block to your project's `.threadwork/state/quality-config.json`:

```json
{
  "outputFilter": {
    "enabled": true,
    "maxFailures": 10,
    "maxErrorsPerGroup": 3,
    "maxLineLength": 200,
    "strategies": {
      "smartFiltering": true,
      "grouping": true,
      "truncation": true,
      "deduplication": true
    }
  }
}
```

Then run `threadwork update` to pull in the updated `lib/output-filter.js` and `lib/quality-gate.js`.

**Tuning options:**

| Key | Default | Effect |
|-----|---------|--------|
| `enabled` | `true` | Master toggle — set `false` to disable all filtering |
| `maxFailures` | `10` | Max test failure blocks shown before `+N more` |
| `maxErrorsPerGroup` | `3` | Max file/rule locations per lint or TS group |
| `maxLineLength` | `200` | Truncation limit per output line (characters) |
| `strategies.smartFiltering` | `true` | Remove passing test lines and boilerplate noise |
| `strategies.grouping` | `true` | Aggregate lint by rule, TS errors by file |
| `strategies.truncation` | `true` | Cap output size with omission counts |
| `strategies.deduplication` | `true` | Collapse repeated messages with ×N counts |

New installations get this config automatically via `threadwork init`.

---

## Upgrading from v0.3.x → v0.3.2

### Prerequisites

- Threadwork v0.3.0 or v0.3.1 already initialized (`.threadwork/` exists)
- Node.js ≥ 18
- `threadwork` CLI available

### Migration Command

```bash
threadwork update --to v0.3.2
```

The command is **idempotent** — re-running it skips already-completed steps.

**What it does (14 steps):**

1. Backs up current hooks to `.threadwork/backup/v0.3.x-hooks/`
2. Creates `.threadwork/specs/enforcement/` directory
3. Copies enforcement example spec template (with rule types documented)
4. Creates `.threadwork/specs/frontend/` directory
5. Copies design-ref example spec template
6. Creates `.threadwork/state/knowledge-notes.json` (empty, if absent)
7. Creates `.threadwork/state/gap-report.json` (empty, if absent)
8. Creates `.threadwork/state/spec-staleness-tracker.json` (empty, if absent)
9. Updates hooks: `pre-tool-use.js`, `post-tool-use.js`, `subagent-stop.js`, `session-start.js`
10. Updates lib modules: `quality-gate.js`, `spec-engine.js`, `state.js`, `handoff.js` + installs 6 new modules (`rule-evaluator.js`, `doc-freshness.js`, `knowledge-notes.js`, `design-ref.js`, `verification-profile.js`, `autonomy.js`)
11. Installs `tw-reviewer.md` agent template
12. Updates all command templates (adds `tw-docs-health.md`, `tw-verify-manual.md`, `tw-readiness.md`, `tw-autonomy.md`)
13. Copies verification profile JSON templates to `.threadwork/verification-profiles/`
14. Patches `project.json` with `autonomyLevel: 'supervised'`, `verificationType: null`, `_version: '0.3.2'`

### Post-Upgrade Steps

1. **Run `/tw:readiness`** to see your harness readiness score across 7 dimensions. This gives you a quick view of what v0.3.2 features are configured and what still needs setup.

2. **Add rules to your specs** — edit any spec file and add a `rules:` array to the frontmatter. The enforcement spec at `.threadwork/specs/enforcement/` has commented examples of all 5 rule types. The `spec-compliance` Ralph Loop gate will now check these on every commit.

3. **Run `/tw:discuss-phase`** for your next phase — it now asks 12 questions including architectural rules, naming conventions, design files, and verification profile type. Answers are auto-converted into enforcement specs.

4. **Choose an autonomy level** with `/tw:autonomy set <level>` if you want less manual confirmation. Default is `supervised` (no change from prior behavior).

5. **Add a verification profile** to `project.json` if you want the `smoke-test` Ralph Loop gate. See `.threadwork/verification-profiles/` for templates.

---

### What Each Upgrade Changes for Your Workflow

#### Upgrade 1: Spec Rules Engine

**Before**: Specs were documentation only — agents were instructed to follow them but there was no enforcement at the code level.

**After**: Specs can now include a `rules:` frontmatter array. Each rule is checked by the `spec-compliance` gate in the Ralph Loop after every agent task. Violations block completion with a structured message showing the specId, rule type, and evidence.

Example spec frontmatter:
```yaml
---
specId: SPEC:arch-001
name: Architecture Boundaries
rules:
  - type: grep_must_not_exist
    pattern: "console\\.log"
    files: "src/**/*.ts"
    message: "No console.log in production source"
  - type: import_boundary
    from: "src/services/**"
    cannot_import: ["src/ui/**"]
    message: "Services cannot import from UI layer"
---
```

**What you'll notice**: The Ralph Loop rejection payload now includes a `spec-compliance` gate section. Violations show specId, file, and line evidence. Fix the violation and the gate passes.

---

#### Upgrade 4: Knowledge Notes

**Before**: Non-obvious implementation facts discovered during a session were lost when the session ended. The next session had to rediscover the same gotchas.

**After**: Agents call `knowledge_note({category, scope, summary, evidence, critical})` inline during implementation (intercepted by `pre-tool-use.js`). Notes are scoped by file glob (`src/hooks/**`) and persist in `.threadwork/state/knowledge-notes.json`. Notes that survive 2 sessions are automatically promoted to the spec library.

**What you'll notice**: Session-start now shows a `Knowledge Notes` block with notes relevant to the current working files. Critical notes appear at the top of every agent prompt. Over time, the spec library grows organically from discovered implementation facts.

---

#### Upgrade 6: Runtime Verification

**Before**: "Done" meant quality gates passed. There was no check that the actual running output (built artifact, extension manifest, CLI entrypoint) was correct.

**After**: A `verification` object in `project.json` defines automated checks (`file_exists`, `json_schema`, `no_forbidden_patterns`) and manual steps with expected outcomes. The `smoke-test` gate runs automated checks in the Ralph Loop. `/tw:verify-manual` generates a printable manual test checklist.

**What you'll notice**: If you define a `browser-extension` profile, the `smoke-test` gate checks that `dist/manifest.json` exists and has the required keys before marking a task complete.

---

#### Upgrade 8: Autonomous Operation Mode

**Before**: Every plan required manual approval. Every session required a manual resume command.

**After**: Three autonomy levels control how much manual confirmation Threadwork requires:
- `supervised` (default) — no change; all approvals required
- `guided` — shows plans and waits 10 seconds (auto-approves if no input)
- `autonomous` — auto-approves plans with no blocking issues; auto-resumes sessions; auto-generates handoffs at budget thresholds

Safety rails are always active regardless of level. The following always require explicit confirmation: `git push`, `rm -rf`, `DROP TABLE`, `--force`, security configuration changes, budget overruns.

**What you'll notice**: In `autonomous` mode, phases execute with minimal interruption. The session-start shows `Autonomy: autonomous — auto-resume active`. Handoffs are generated automatically when the token budget hits 80%.

---

## Upgrading from v0.2.x → v0.3.0

### Prerequisites

- Threadwork v0.2.x already initialized (`.threadwork/` exists, `_version: "0.2.0"` in `project.json`)
- Node.js ≥ 18
- `threadwork` CLI available (`npm link` or globally installed)

### Migration Command

```bash
threadwork update --to v0.3.0
```

The command is **idempotent** — if it fails partway through, re-running it will skip already-completed steps and continue from where it stopped.

**What it does (12 steps):**

1. Backs up current hooks to `.threadwork/backup/v0.2.x-hooks/`
2. Writes a `.gitignore` block (idempotent — skipped if block already present) that excludes operational files: `checkpoint.json`, `ralph-state.json`, `token-log.json`, `hook-log.json`, `model-switch-log.json`, `blueprint-migration.json`
3. Creates `~/.threadwork/pricing.json` if absent (global pricing file; never overwritten)
4. Updates hooks: `pre-tool-use.js`, `session-start.js`, `post-tool-use.js`
5. Updates `lib/token-tracker.js` with cost tracking functions (`calculateCost`, `getCostUsed`, `getDualBudgetReport`)
6. Creates `lib/model-switcher.js`
7. Creates `lib/blueprint-diff.js`
8. Patches `project.json` with three new fields: `default_context`, `cost_budget`, `model_switch_policy`
9. Recalibrates `session_token_budget` from 800K → 400K for the 200K context model — **requires confirmation**; skipped if you decline
10. Creates `.threadwork/workspace/sessions/` directory for session cost history
11. Creates `.threadwork/state/blueprint-index.json`
12. Updates `THREADWORK.md` (or `CLAUDE.md`) with 7 new commands

### Post-Upgrade Steps

1. **Review `~/.threadwork/pricing.json`** — check that the prices reflect Anthropic's current rates. The template uses the rates from the time of this release; if Anthropic has changed pricing, edit this file manually. It is never overwritten by future migrations.

2. **Run `/tw:blueprint-lock`** to snapshot your current project intent as a baseline. This is required before `/tw:blueprint-diff` can show meaningful comparisons.

3. **Run `/tw:budget`** to see the new dual token + cost dashboard. You should see both a token line and a cost line.

4. **Review `model_switch_policy`** in `.threadwork/state/project.json`. The default is `notify` (advanced tier) — agents will show a 10-second countdown before switching model tiers. Change to `auto` if you want silent switches, or `approve` for explicit confirmation before each switch.

---

### What Each Upgrade Changes for Your Workflow

#### Gap 1: .gitignore Automation

**Before**: Operational state files (`checkpoint.json`, `token-log.json`, etc.) had to be excluded from git manually. Missing this meant accidentally committing session state on every commit.

**After**: `threadwork init` (and the migration) writes a delimited `.gitignore` block:

```
# <threadwork-managed>
.threadwork/state/checkpoint.json
.threadwork/state/ralph-state.json
.threadwork/state/token-log.json
.threadwork/workspace/hook-log.json
.threadwork/state/model-switch-log.json
.threadwork/state/blueprint-migration.json
.threadwork/worktrees/
.threadwork/backup/
# </threadwork-managed>
```

Memory files — journals, handoffs, specs, plan XMLs — are **not** excluded and continue to be committed.

**What you'll notice**: No more accidental commits of operational state. The `.gitignore` block is idempotent — if you re-run the migration, the block is not duplicated.

---

#### Gap 2: 200K Context Default

**Before**: `session_token_budget` defaulted to 800K (80% of Sonnet's 1M context). No warning was given when tasks were approaching context limits for the 200K model.

**After**: A new `default_context` field in `project.json` declares which Sonnet model variant you're using (`"200k"` or `"1m"`). At init, question 7 asks for your choice. The budget is calibrated accordingly:
- 200K model: 400K token budget (80% of 500K usable window)
- 1M model: 800K token budget (unchanged)

A `⚠️ CONTEXT ADVISORY` block is injected into agent prompts when a task is detected to be complex (6+ files, architectural keywords, debugger or planner agents) and `default_context` is `"200k"`.

**What you'll notice**: Context limit warnings appear before you hit them. The session-start orientation block shows the context model (`Context model: Sonnet 200K`). Agents working on large tasks are warned proactively.

---

#### Gap 3: Dual Cost Budget

**Before**: Token usage was tracked, but actual dollar cost was invisible. You had to calculate it manually based on model pricing.

**After**: Cost tracking runs alongside token tracking. `~/.threadwork/pricing.json` holds per-model input/output rates. `calculateCost()` uses a 60/40 input/output split to estimate cost from token counts. Both a token budget and a cost budget ($5.00 default, configurable at init) are tracked simultaneously.

**What you'll notice**: `/tw:budget` now shows two lines:

```
Token Budget   Used: 180K / 400K  (45%)   ✅ Healthy
Cost Budget    Used: $0.87 / $5.00 (17%)  ✅ Healthy
```

New command `/tw:cost` shows a cost-only dashboard broken down by model tier (Haiku / Sonnet / Opus), with a projected session-end cost. `/tw:cost history` shows costs across past sessions from committed session-summary files.

---

#### Gap 4: Model Switch Policy

**Before**: There was no runtime enforcement of which model ran which task. Agents could silently run on any model.

**After**: `lib/model-switcher.js` defines agent defaults:

| Agent | Default Tier |
|-------|-------------|
| `tw-planner` | Opus |
| `tw-researcher` | Opus |
| `tw-debugger` | Opus |
| `tw-executor` | Sonnet |
| `tw-verifier` | Sonnet |
| `tw-plan-checker` | Sonnet |
| `tw-dispatch` | Haiku |
| `tw-spec-writer` | Haiku |
| `tw-entropy-collector` | Haiku |

When a task's complexity (file count, architectural keywords) suggests a tier upgrade, `requestSwitch()` fires according to the policy:
- `auto` — switch silently, log to `model-switch-log.json`
- `notify` — show a 10-second countdown: "Upgrading tw-executor to Opus. Cancel? (10s)"
- `approve` — explicit y/n required before switching

The switch log is included in handoff Section 6 so you can audit which model ran each task.

**What you'll notice**: New `/tw:model` command shows current assignments and the session switch log. `/tw:model policy notify|auto|approve` changes the policy mid-session.

---

#### Gap 5: Blueprint Drift Detection

**Before**: When your project requirements changed mid-implementation, there was no structured way to assess the impact. Changes were applied ad-hoc.

**After**: `lib/blueprint-diff.js` performs section-level deterministic diff between two blueprint snapshots. Changes are categorized into three types:
- **ADDITIVE** — new sections or requirements with no conflicts
- **MODIFICATIONS** — changes to existing sections that may affect in-progress work
- **STRUCTURAL** — fundamental scope, architecture, or technology changes

For each detected change, the tool maps it to affected phases and estimates migration cost using three options:
- **Restart** — start the phase over with the new blueprint
- **In-place patch** — amend the current plan XML and re-execute affected tasks
- **Phased adoption** — continue the current phase with the old blueprint; adopt changes in the next phase

At 15% scope change: a recommendation is shown. At 40%: restart is strongly recommended.

The decision is written to `.threadwork/state/blueprint-migration.json` (excluded from git). It does not automatically start any implementation.

**What you'll notice**: New commands `/tw:blueprint-diff <file>` and `/tw:blueprint-lock [note]`. Run `blueprint-lock` before making significant blueprint edits to establish a clean baseline, then `blueprint-diff` to see the impact.

---

### New Init Questions (v0.3.0)

v0.3.0 adds 3 new questions at `threadwork init`. Total is now 9:

| # | Question | Options / Default |
|---|----------|--------------------|
| 1 | Project name | Free text |
| 2 | Tech stack | Next.js+TS / React+Vite+TS / Express / FastAPI / Other |
| 3 | Quality thresholds | Coverage % + lint level |
| 4 | Team mode | Solo / Small team / Team |
| 5 | Skill tier | Beginner / Advanced (default) / Ninja |
| 6 | Session token budget | Default: 400K (200K model) or 800K (1M model) |
| 7 | Context model | Sonnet 200K (recommended) / Sonnet 1M |
| 8 | Per-session cost budget | Default: $5.00 |
| 9 | Model switch policy | `notify` (advanced default) / `auto` (ninja default) / `approve` (beginner default) |

---

### What Is NOT Changed

| Item | Status |
|------|--------|
| `.threadwork/specs/` user-authored specs | **Preserved exactly** |
| `.threadwork/workspace/journals/` | **Preserved exactly** |
| `.threadwork/workspace/handoffs/` | **Preserved exactly** |
| `.threadwork/state/phases/*/plans/*.xml` | **Preserved exactly** |
| `token-log.json` existing entries | **Preserved** — new entries will gain cost data; old entries show $0.00 |
| `project.json` fields other than the 3 new fields | **Preserved exactly** |

---

## Upgrading from v0.1.x → v0.2.0

### Prerequisites

- Threadwork v0.1.x initialized (`threadwork init` completed, `.threadwork/` directory exists)
- Node.js ≥ 18
- `threadwork` CLI available (`npm link` or globally installed)

### Step 1: Run the migration command

```bash
cd /your/project
threadwork update --to v0.2.0
```

The command is **idempotent** — safe to run multiple times. It checks `_version` in `project.json` at the start: if already `"0.2.0"`, it exits immediately.

### Step 2: Verify the migration

```bash
cat .threadwork/state/project.json | grep _version
# → "_version": "0.2.0"

ls .threadwork/store/
# → edge-cases/  patterns/  conventions/  store-index.json
```

### Step 3: Generate spec IDs (if not auto-generated)

The routing map requires spec IDs (`SPEC:auth-001`, `SPEC:test-001`, etc.) in your spec files. The migration command runs `generateSpecIds()` automatically, but if your specs didn't get IDs, run:

```
/tw:specs reindex
```

This adds a `specId` frontmatter field to each spec that lacks one. Existing content is not changed.

### Step 4: Review entropy scanner settings (optional)

The entropy collector scans for 6 categories by default. If some don't apply to your project, disable them in `quality-config.json`:

```json
{
  "entropy": {
    "naming_drift": true,
    "import_boundaries": true,
    "orphaned_artifacts": true,
    "documentation_staleness": false,
    "inconsistent_error_handling": true,
    "duplicate_logic": false
  }
}
```

### Step 5: Confirm Store domain settings (optional)

The Store tracks three domains by default. If you want to restrict or add domains, update `project.json`:

```json
{
  "store_domains": ["patterns", "edge-cases", "conventions"]
}
```

### Step 6: Restart Claude Code

Hooks are loaded at session start. Restart your Claude Code session to load the updated hooks.

---

### What Each Upgrade Changes for Your Workflow (v0.2.0)

#### Upgrade 1: Remediation-Injecting Ralph Loop

**Before**: When the Ralph Loop catches an error, it re-invokes the agent with "Fix these errors: [raw output]".

**After**: The Ralph Loop re-invokes with a structured remediation block:

```
QUALITY GATE REJECTION (iteration 2 of 5)
Primary violation: TypeScript type error in auth module
Relevant spec: backend/auth-patterns — Section: User type definition
Fix required: The User type lacks a 'token' field. Add 'token?: string' to src/types/user.ts.
```

**What you'll notice**: Agents fix errors more precisely on the first retry. Fewer Ralph Loop iterations overall.

#### Upgrade 2: Progressive Disclosure Spec Injection

**Before**: On agent spawn, all relevant spec files are injected in full (~3K–8K tokens per spawn).

**After**: A compact routing map (~150 tokens) is injected. Agents call `spec_fetch SPEC:auth-001` to pull a specific spec when needed.

**What you'll notice**: Sessions run longer before hitting token limits. The `/tw:budget` dashboard now shows a `Spec fetches` line so you can see the overhead separately.

#### Upgrade 3: Background Entropy Collector

**Before**: No automatic process to detect cross-task quality drift. "AI slop" accumulates silently.

**After**: After each wave completes, `tw-entropy-collector` (Haiku model, cheap) scans the wave's git diff. Minor issues (naming drift, orphaned files) are auto-fixed with `chore: [entropy-collector]` commits. Larger issues are queued for the next wave.

**What you'll notice**: Occasional `chore:` commits appearing in your git log after wave completion. Run `/tw:entropy` to see what was scanned and fixed.

#### Upgrade 4: Cross-Session Memory Store

**Before**: Each project starts cold. Patterns learned in one project don't carry over.

**After**: `~/.threadwork/store/` accumulates patterns and edge cases across all projects. Session start injects the top 3 most relevant Store entries. High-confidence spec proposals are auto-promoted to the Store.

**What you'll notice**: New projects get relevant knowledge from day one. Run `/tw:store` to browse accumulated entries.

#### Upgrade 5: Execution Plan Decision Logs

**Before**: Executor agents write `SUMMARY.md` after completion. Architectural choices made during implementation are lost unless manually captured.

**After**: Executor agents append `<decisions>` blocks to the plan XML as they work. Handoff Section 4 (Key Decisions) is auto-populated from these blocks.

**What you'll notice**: Handoffs now have detailed architectural rationale. When debugging or reviewing a session, you can see why choices were made directly in the plan XML.

---

### New Commands Reference (v0.2.0)

| Command | Description |
|---------|-------------|
| `threadwork update --to v0.2.0` | Run the v0.2.0 migration (idempotent) |
| `/tw:entropy` | Show latest entropy report |
| `/tw:entropy history` | List all entropy reports |
| `/tw:entropy show <N>` | Show entropy report for wave N |
| `/tw:store` | Store dashboard |
| `/tw:store list` | List all Store entries |
| `/tw:store show <key>` | Show a specific entry |
| `/tw:store promote <id>` | Manually promote a proposal |
| `/tw:store prune` | Remove low-confidence entries |

---

## Troubleshooting

### Hook errors: `ERR_MODULE_NOT_FOUND` / `PostToolUse:Bash hook error`

If you see errors like:

```
PostToolUse:Bash hook error
Failed with non-blocking status code: node:internal/modules/cjs/loader:1478
ERR_MODULE_NOT_FOUND
Shell cwd was reset to /your/project
```

Your global `~/.claude/settings.json` has the old bare `node .threadwork/hooks/X.js` hook commands, which fail in any directory without a `.threadwork/hooks/` folder. Fix:

```bash
# From any initialized project:
threadwork update
```

This patches `~/.claude/settings.json` to use the bash-wrapper form. Then restart Claude Code.

If you haven't yet initialized any project, manually edit `~/.claude/settings.json` and replace each hook command:

```json
// Old (throws ERR_MODULE_NOT_FOUND in uninitialized dirs):
"command": "node .threadwork/hooks/post-tool-use.js"

// New (silent no-op when hooks dir is absent):
"command": "bash -c '[ -f .threadwork/hooks/post-tool-use.js ] && node .threadwork/hooks/post-tool-use.js || exit 0'"
```

---

### "Already at v0.2.0" but hooks aren't working

The idempotency check only looks at `_version`. If you need to re-run framework file updates:

```bash
threadwork update
```

### "Already at v0.3.0" but new features aren't working

Same approach — force re-copy of all framework files:

```bash
threadwork update
```

If specific lib files seem missing, check that `lib/model-switcher.js` and `lib/blueprint-diff.js` exist in `.threadwork/lib/`.

### Spec IDs aren't appearing in the routing map

The routing map uses `specId` frontmatter. Check that your specs have it:

```bash
grep -r "specId:" .threadwork/specs/
```

If missing, run `/tw:specs reindex` or add IDs manually:

```yaml
---
title: Auth Patterns
specId: SPEC:auth-001
tags: [auth, jwt]
---
```

### Store entries not appearing at session start

The Store injection is skipped when token budget is >80% used. If your budget resets between sessions, the injection will resume. Also check that `~/.threadwork/store/store-index.json` has `entries` with `confidence >= 0.5`.

### entropy-collector not triggering

The entropy collector fires when `isWaveComplete()` returns true — when all tasks in `execution-log.json` have status `DONE` or `SKIPPED`. If tasks are stalling at other statuses, check the execution log.

### pricing.json not found

Run `threadwork update --to v0.3.0` to create it, or create it manually at `~/.threadwork/pricing.json`. A template is available at `templates/pricing.json` in the Threadwork package.

### Model switch countdown not appearing

The countdown only shows when `model_switch_policy` is `notify` or `approve`. If policy is `auto`, switches happen silently. Check your current setting:

```bash
cat .threadwork/state/project.json | grep model_switch_policy
```

### Blueprint diff shows "No baseline found"

Run `/tw:blueprint-lock` first to snapshot the current project intent. If you have a blueprint document, provide its path:

```
/tw:blueprint-lock --file docs/blueprint.md
```

### Cost tracking shows $0.00

Cost tracking requires `recordUsage()` to be called with the `model` parameter. Existing entries in `token-log.json` from before v0.3.0 have no cost data — only new entries after upgrading will show costs.

### session_token_budget still shows 800K after v0.3.0 migration

The migration recalibrates 800K → 400K only with user confirmation. If you declined during the migration, set it manually:

1. Open `.threadwork/state/project.json`
2. Set `"session_token_budget": 400000`

Only do this if you are using the Sonnet 200K model. If you are using Sonnet 1M, 800K is correct.

---

## Known Issues

No known issues in v0.3.0.
