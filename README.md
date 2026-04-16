# Threadwork

**Production-grade AI coding workflow tool for Claude Code and Codex.**

Threadwork weaves tasks, specs, and sessions into a single thread — a structured AI workflow layer that combines spec-driven project orchestration with hook-enforced spec injection, automated quality gates, first-class **token budgeting**, **structured session handoffs**, and **skill-tier-aware output**.

---

## What's New in v0.3.3

**Self-Evolution: Threadwork learns from your projects.**

Three new capabilities turn the framework into a growing knowledge base:

| Feature | What It Does |
|---------|-------------|
| **Two-Tier Spec Library** | Core specs (language-agnostic rules, ~150 tokens) + stack-scoped reference specs (concrete code examples, on-demand). Tier 2 specs carry enforcement rules targeting specific file extensions. |
| **Stack-Aware Spec Injection** | `getRelevantSpecs()` reads `project.json.techStack` and boosts relevance for matching specs. A Next.js project surfaces TypeScript patterns; a FastAPI project surfaces Python patterns. |
| **Knowledge Harvest** | `/tw:done` extracts reusable patterns from plan decisions, Ralph Loop failures, knowledge notes, proven rules, and spec divergence — writes proposals to the Threadwork repo. |
| **Harvest Review** | `/tw:harvest review` lets you approve/reject proposals interactively, then commit learned specs to the repo for all future projects. |
| **Reviewer Anti-Patterns** | `tw-reviewer` gains Check 7: 12 named anti-patterns (API, DB, auth, testing) that AI agents frequently introduce. Security items are `critical` severity. |
| **Directory Restructure** | `templates/specs/` reorganized into `core/` (curated baseline), `learned/` (project-harvested), `proposals/` (pending review). |

**The evolution loop:**
```
Project A → /tw:done → harvest proposals → /tw:harvest review → learned specs committed
                                                                        ↓
Project B → threadwork init → seeds from core/ + stack-matched learned/ → starts smarter
```

**Upgrading from v0.3.2?** Run `threadwork update --to v0.3.3`. See [docs/upgrade.md](docs/upgrade.md).

---

## Previous Releases

<details>
<summary>v0.3.2 — Spec Enforcement, Knowledge, Design, Verification, Autonomy</summary>

Nine upgrades across three tiers — spec enforcement, knowledge retention, design fidelity, runtime verification, and autonomous operation:

**Tier 1 — Core Enforcement Loop**
- **Spec Rules Engine** — specs gain a `rules:` frontmatter array with 5 machine-checkable rule types (`grep_must_exist`, `grep_must_not_exist`, `import_boundary`, `naming_pattern`, `file_structure`). A new `spec-compliance` Ralph Loop gate enforces them on every commit. See `lib/rule-evaluator.js`.
- **Failure Classification** — `classifyFailure()` in `lib/quality-gate.js` returns structured `{ type, confidence, evidence, recommendation }` for each gate failure, enabling smarter retry strategies and fast-track spec proposals.
- **`tw-reviewer` Agent** — peer review agent (Sonnet) performs structured code review after executor tasks: spec compliance, naming, import boundaries, test coverage, and architectural decisions.

**Tier 2 — Knowledge, Verification, Design**
- **Knowledge Notes** — agents capture non-obvious implementation facts via `knowledge_note()` during implementation. Notes persist across sessions in `.threadwork/state/knowledge-notes.json`, are injected into future session prompts, and are promoted to the spec library after 2 sessions. See `lib/knowledge-notes.js`.
- **Doc-Freshness Gate** — detects stale documentation by comparing file references in docs against modified timestamps. New `doc-freshness` Ralph Loop gate. See `lib/doc-freshness.js`.
- **Enhanced Discuss-Phase** — `/tw:discuss-phase` now asks 12 questions (up from 5), including architectural rules, design files, verification profile, and autonomy preference. Answers auto-generate enforcement specs.
- **Runtime Verification** — `verification` object in `project.json` defines automated smoke tests (`file_exists`, `json_schema`, `no_forbidden_patterns`). New `smoke-test` Ralph Loop gate. See `lib/verification-profile.js`.
- **Design Reference System** — design files (HTML wireframes, PNGs, SVGs) referenced in spec frontmatter are injected into executor and verifier prompts. Fidelity levels: `exact`, `structural`, `reference`. See `lib/design-ref.js`.

**Tier 3 — Proactive Detection + Autonomy**
- **Capability Gap Detection** — `scanPlanForGaps()` detects tasks referencing tools/APIs not covered by any spec. `/tw:readiness` runs a 7-point harness readiness audit.
- **Autonomous Operation Mode** — three levels (`supervised`, `guided`, `autonomous`) control how much manual confirmation is needed. Safety rails always active. See `lib/autonomy.js` and `/tw:autonomy`.

**Output Filter (2026-04-14):** Quality gate output sent to agents is now filtered by four strategies — Smart Filtering (removes passing test lines and noise), Grouping (lint errors by rule, TS errors by file), Truncation (first N failures with `+N more` counts), and Deduplication (collapses identical errors with ×N counts). Enabled by default; fully configurable or disable-able per project via `outputFilter` in `.threadwork/state/quality-config.json`. See `lib/output-filter.js`.

**Upgrading from v0.3.x?** Run `threadwork update --to v0.3.2` — non-destructive, idempotent, 14 steps. See [docs/upgrade.md](docs/upgrade.md).

**Patch fixes (2026-04-13):** Model switching now works correctly in hooks — the previous `notify` policy caused a 10-second block that killed the hook before the model override was written. The hook now switches immediately and always stamps `tool_input.model` so the token log correctly tracks which model ran each task. `threadwork update` gained a `--verify` flag and now does content-diff comparison before copying (only changed files are written; agents directory included). Wave display in `/tw:execute-phase` shows the model tier per plan.

## What's New in v0.3.0

Five operational gap fixes for real-world v0.2.x deployments:

| Upgrade | What changed | Impact |
|---------|-------------|--------|
| **.gitignore automation** | `threadwork init` writes a delimited block excluding operational files (checkpoint, token-log, switch-log). Memory files (journals, handoffs, specs, plans) are committed. | No more accidental commits of operational state |
| **200K context default** | `default_context` in project.json. Init question for model choice. Session token budget default recalibrated: 400K for 200K model, 800K for 1M. Complexity advisory injected for 6+ file / architectural tasks. | Cost-appropriate defaults; context limit warnings before you hit them |
| **Dual cost + token budget** | Cost budget ($5.00 default) tracked alongside tokens. Global `~/.threadwork/pricing.json` (user-editable). `calculateCost()` uses 60/40 I/O split. `/tw:budget` now shows both token and cost lines. | Know what sessions actually cost in dollars, not just tokens |
| **Model switch policy** | New `lib/model-switcher.js`. Three policies: auto/notify/approve. Agent defaults: planner/researcher/debugger→Opus, executor/verifier/checker→Sonnet, dispatch/spec-writer/entropy→Haiku. Switch log in handoff Section 6. | Full audit trail of which model ran which task; approval workflow for tier changes |
| **Blueprint delta analysis** | `lib/blueprint-diff.js` — section-level deterministic diff. ADDITIVE / MODIFICATIONS / STRUCTURAL categories. Three migration options (restart/in-place/phased) with cost estimates. Recommendation at 15%/40% thresholds. | Mid-project blueprint changes become structured decisions, not ad-hoc patches |

**Upgrading from v0.2.x?** Run `threadwork update --to v0.3.0` — non-destructive, idempotent. See [docs/upgrade.md](docs/upgrade.md).

## What's New in v0.2.0

Five targeted upgrades informed by LangChain's harness taxonomy and OpenAI's harness engineering report:

| Upgrade | What changed | Impact |
|---------|-------------|--------|
| **Remediation-Injecting Ralph Loop** | Quality gate rejections now include a structured `remediation` block with `primary_violation`, `relevant_spec`, and a concrete `fix_template`. Every rejection teaches the agent how to fix it. | Agents fix errors faster; fewer Ralph Loop iterations |
| **Progressive Disclosure Spec Injection** | Replaced upfront full-spec injection (~3K–8K tokens) with a compact routing map (~150 tokens). Agents fetch full specs on demand via `spec_fetch` tool. | Saves ~20K–80K tokens per 14-task phase |
| **Background Entropy Collector** | New 9th agent (`tw-entropy-collector`) scans wave diffs for naming drift, orphaned files, and cross-output inconsistencies after each wave completes. Auto-fixes minor issues. | No more "AI slop" accumulation between waves |
| **Cross-Session Memory Store** | Global `~/.threadwork/store/` persists high-confidence patterns, edge cases, and conventions across projects. Promoted from spec proposals automatically. | Every project benefits from all previous projects |
| **Execution Plan Decision Logs** | Executor agents append `<decisions>` blocks to plan XML as they work, capturing _why_ choices were made. Handoff Section 4 is now auto-populated from these. | Architectural decisions survive session boundaries |

**Upgrading from v0.1.x?** Run `threadwork update --to v0.2.0` — non-destructive, idempotent. See [docs/upgrade.md](docs/upgrade.md).

</details>

---

## Quick Start

```bash
# 1. Install globally
npx threadwork-cc@latest

# 2. Register hooks globally (once per machine — required for Claude Code to fire hooks)
threadwork init --global

# 3. In each project: scaffold .threadwork/ (hook files, state, specs)
threadwork init

# 4. Start Claude Code in your project
# In Claude Code:
/tw:new-project
/tw:plan-phase 1
/tw:execute-phase 1
/tw:done
```

---

## Install from Repository

Use this if you want to run from source, contribute, or test before publishing.

### Prerequisites

- **Node.js ≥ 18** (Node 22 LTS recommended)
- **npm ≥ 10**

```bash
# Verify
node --version   # v22.x.x
npm --version    # 10.x.x
```

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/nexora/threadwork.git
cd threadwork

# 2. Install dependencies
npm install

# 3. Verify everything passes
npm run check        # syntax check all JS files
npm test             # unit tests
npm run test:all     # unit + integration tests (181 tests)

# 4. Test hooks manually
node hooks/test-harness.js all

# 5. Link globally so the `threadwork` command is available
npm link

# 6. Confirm the CLI is working
threadwork --version
```

### Use in a project

```bash
cd /your/project

# First time on this machine: register hooks globally (once only)
threadwork init --global

# Each project: scaffold .threadwork/ (hook files, state, specs)
threadwork init
```

### Unlink when done

```bash
npm unlink -g threadwork-cc
```

---

## What It Does

| Feature | Description |
|---------|-------------|
| **Hook-driven context** | 4 hooks inject specs, tier instructions, and token budget into every agent automatically |
| **Ralph Loop** | SubagentStop hook runs lint/typecheck/tests after every subagent — rejections include a structured remediation block that teaches the agent exactly how to fix the error |
| **Progressive spec injection** | Routing map (~150 tokens) injected at spawn; agents pull full specs on demand via `spec_fetch`. Saves ~20K–80K tokens per phase vs v0.1.x |
| **Token budgeting** | Tracks usage including spec fetch overhead; warns at 80%/90%; shows variance vs estimates per task |
| **Session handoffs** | `/tw:done` generates a 10-section handoff. Section 4 (Key Decisions) auto-populated from plan XML `<decisions>` blocks |
| **Skill tiers** | `beginner` / `advanced` / `ninja` — controls verbosity across all outputs uniformly |
| **Two-tier spec library** | Core specs (language-agnostic rules) + stack-scoped references (concrete code examples). Stack-aware injection surfaces the right patterns for your tech stack |
| **Self-evolution** | `/tw:done` harvests reusable patterns; `/tw:harvest review` curates them. Learned specs commit to the Threadwork repo and seed future projects |
| **Activity log** | `threadwork log` and `/tw:log` expose a merged, level-filtered view of all hook events, quality gate results, token warnings, and lib/ module traces. Two log sources merged by timestamp: `hook-log.json` (hooks) + `threadwork.log` (lib/ modules) |
| **Cross-session Store** | `~/.threadwork/store/` persists patterns, edge cases, and conventions across all projects |
| **Background entropy collector** | After each wave, the 9th agent scans diffs for naming drift, orphaned files, and cross-output inconsistencies. Auto-fixes minor issues |
| **Parallel execution** | Wave-based parallel subagent execution with topological dependency ordering |
| **Team model support** | Claude Code Team model with bidirectional escalation, per-worker budgets, and auto/legacy/team control |
| **Brownfield support** | `/tw:analyze-codebase` maps existing projects and generates starter specs |

---

## Team Mode (Parallel Agent Coordination)

Threadwork supports the Claude Code Team model for bidirectional multi-agent execution. Instead of fire-and-forget parallel tasks, agents join a named team and communicate via `SendMessage` — blocked executors escalate to the orchestrator; the orchestrator can recover rather than silently fail.

### Control

Set your default at init or change anytime:

```
# In Claude Code:
/tw:status set teamMode auto     # system decides per wave — recommended
/tw:status set teamMode team     # always use Team model
/tw:status set teamMode legacy   # always use fire-and-forget
```

Per-invocation overrides always win:

```
/tw:execute-phase 2              # uses project teamMode setting
/tw:execute-phase 2 --team       # force Team model this phase
/tw:execute-phase 2 --no-team    # force legacy this phase
/tw:execute-phase 2 --team --max-workers 2   # Team model, cap at 2 parallel workers
```

### Auto mode decision logic

When `teamMode=auto`, the system checks four conditions per wave before using Team model:
- Wave has 2+ plans (single plans use legacy — no overhead worth it)
- Remaining budget ≥ 30% of session budget
- Sum of wave plan estimates ≤ 50% of remaining budget
- Skill tier allows ≥ 2 workers (beginner=2, advanced=3, ninja=5)

### Token cost

Team mode runs multiple agents simultaneously — token consumption scales with worker count. Built-in controls:
- `--max-workers N` caps parallelism
- Auto mode falls back to legacy when budget is too low
- Each worker gets an individual budget cap (`floor(remaining × 0.6 / workers)`, min 50K)
- Workers send `BUDGET_LOW` before exceeding their cap — orchestrator can shut them down cleanly

---

## Slash Commands

### Project Setup
```
/tw:new-project           7 clarifying questions → PROJECT.md + REQUIREMENTS.md + ROADMAP.md
/tw:analyze-codebase      Map brownfield project → detect framework, generate starter specs
```

### Phase Workflow
```
/tw:discuss-phase <N>     Capture library/pattern decisions before planning
/tw:plan-phase <N>        Generate XML plans with token estimates + phase budget preview
/tw:execute-phase <N>     Parallel wave execution with spec injection + Ralph Loop
/tw:verify-phase <N>      Goal-backward verification + token variance report
/tw:clear                 Close phase, advance to next
/tw:audit-milestone <N>   Cross-phase milestone verification
```

### Task Execution
```
/tw:quick <desc>          Fast-path task — shows estimate, executes, commits
/tw:parallel <desc>       Isolated worktree execution → draft PR
```

### Token Budget
```
/tw:budget                Session budget dashboard
/tw:estimate <desc>       Token estimate before committing to a task
/tw:tokens                Full session token log
/tw:variance              Phase variance report (estimated vs actual per task)
```

### Session Handoff
```
/tw:done                  End session — generate 10-section handoff + resume prompt
/tw:handoff [list|show N] Manage past handoffs
/tw:resume                Load latest handoff, announce readiness
/tw:recover               Restore from checkpoint after crash
```

### Knowledge & Self-Evolution
```
/tw:recall <query>        Search journals, specs, handoffs, history
/tw:specs [subcommand]    Manage spec library
/tw:harvest review        Review and approve learned specs harvested from projects
/tw:harvest list          List pending harvest proposals
/tw:harvest stats         Learned library statistics and contributing projects
/tw:journal [subcommand]  View/search session journals
/tw:store                 Cross-session Store dashboard (patterns, edge-cases, conventions)
/tw:store list            List all Store entries with confidence scores
/tw:store show <key>      Display a specific Store entry
/tw:store promote <id>    Manually promote a spec proposal to the Store
/tw:store prune           Remove low-confidence Store entries
/tw:entropy               Latest entropy report for current phase/wave
/tw:entropy history       List all entropy reports with issue counts
/tw:entropy show <N>      Show entropy report for a specific wave
```

### Cost & Model
```
/tw:cost                  Cost budget dashboard — by model tier, session total, projected end
/tw:cost history          Cost across all sessions from committed session-summary files
/tw:model                 Current model assignments, switch policy, session switch log
/tw:model policy <mode>   Change switch policy mid-session (auto/notify/approve)
```

### Observability
```
/tw:log                           Last 20 WARN+ entries — quick error summary
/tw:log --level debug             Show all entries including DEBUG traces
/tw:log --tail 100 --since 1h    Last 100 entries from the past hour
/tw:log --errors-only             ERROR entries only
```

CLI equivalent:
```bash
threadwork log                    # last 50 INFO+ entries
threadwork log --level warn       # WARN and ERROR only
threadwork log --follow           # live-tail (Ctrl+C to stop)
threadwork log --json             # raw JSONL output (pipe-friendly)
```

### Blueprint Management
```
/tw:blueprint-diff <file>                    Analyze blueprint changes — categorize and estimate migration
/tw:blueprint-diff --since-phase <N> <file>  Impact on remaining phases only
/tw:blueprint-lock [note]                    Snapshot current blueprint as versioned baseline
```

### Configuration
```
/tw:tier [set <tier>]                  View or change skill tier
/tw:status                             Full project status dashboard
/tw:status set teamMode <value>        Set parallel execution mode (legacy|auto|team)
/tw:status set maxWorkers <N|auto>     Set max parallel workers per wave
```

---

## Hook Architecture

Threadwork registers 4 hooks into `~/.claude/settings.json`:

```
SessionStart   → session-start.js   Injects project context, budget, tier, Store entries
PreToolUse     → pre-tool-use.js    Injects routing map; intercepts spec_fetch/store_fetch calls
PostToolUse    → post-tool-use.js   Tracks tokens, detects wave completion, triggers entropy collector
SubagentStop   → subagent-stop.js   Ralph Loop — structured remediation block on rejection
```

**Hooks never crash sessions.** All hooks catch errors and exit 0 — quality failures result in retry messages, not session crashes.

For Codex: equivalent behavioral instructions are injected into `AGENTS.md`.

---

## Skill Tier System

Set at `threadwork init`. Change with `/tw:tier set <tier>`.

| Tier | Description |
|------|-------------|
| `beginner` | Step-by-step explanations, inline comments in all generated code, "you are here" orientation |
| `advanced` | Concise summaries, comments for non-obvious logic only, terse status updates *(default)* |
| `ninja` | Code only, no narration, raw error output, single emoji warnings |

The tier is injected into every subagent prompt — it applies uniformly across all commands and agents.

---

## Token Budget System

Default budget: 400K tokens (Sonnet 200K model) or 800K (Sonnet 1M model). Configurable at init.
Cost budget: $5.00 per session (configurable at init). Tracked via `~/.threadwork/pricing.json`.

```
< 80%  ✅ Healthy — normal operation
≥ 80%  ⚠️ Warning — injected into next prompt ("consider wrapping up")
≥ 90%  🚨 Critical — stderr warning + visible in every output
≥ 95%  Auto-generates handoff even without /tw:done
```

```
/tw:budget     — current dashboard
/tw:estimate   — pre-task estimate (verdict: ✅ Safe / ⚠️ Caution / 🚨 Risk)
/tw:tokens     — full log with variance per task
/tw:variance   — phase-level variance with improvement recommendations
```

---

## Session Handoff Workflow

Threadwork guarantees you can always resume from exactly where you left off.

```
# End of session:
/tw:done
# → Generates .threadwork/workspace/handoffs/YYYY-MM-DD-N.md
# → Prints resume prompt to terminal — paste it as your first message next session

# Start of next session:
/tw:resume
# → "Phase 2 | Task T-2-1-3 | Branch feature/auth | 488K tokens remaining. Ready."
```

The **10-section handoff** includes:
1. Session Overview
2. Completed Tasks
3. In Progress
4. Key Decisions
5. Files Modified
6. Token Usage
7. Git State
8. Quality Gate Status
9. Recommended Next Action
10. Self-contained Resume Prompt

The resume prompt contains everything needed to restore context — no file reading required.

---

## Directory Structure

```
.threadwork/                 (per-project, created by threadwork init)
├── state/                   project.json, checkpoint.json, token-log.json, quality-config.json
│   └── phases/              per-phase context, plans (with <decisions>), execution logs
├── specs/                   project spec library (seeded from core/ + stack-matched learned/)
│   ├── backend/             API, auth, DB, stack-specific patterns
│   ├── frontend/            React, styling, design refs
│   ├── testing/             Testing standards
│   ├── enforcement/         Machine-checkable rules
│   ├── learned/             Stack-matched specs from Threadwork knowledge base
│   └── proposals/           AI-proposed updates (pending review)
├── store/                   cross-session Store (patterns/, edge-cases/, conventions/)
└── workspace/               journals, handoffs, archive
```

```
templates/specs/             (in Threadwork repo — the shared knowledge base)
├── core/                    curated baseline specs (always seeded)
├── learned/                 project-harvested patterns (grows over time)
│   ├── patterns/
│   ├── anti-patterns/
│   └── architecture/
└── proposals/               pending human review (from /tw:done harvest)
```

The global Store lives at `~/.threadwork/store/` — shared across all your projects.

---

## Agent Roster

| Agent | Model | Role |
|-------|-------|------|
| `tw-planner` | Opus | Generates XML plans with token estimates |
| `tw-researcher` | Opus | Domain research and library recommendations |
| `tw-executor` | Sonnet | Implements tasks with atomic commits + decision logging |
| `tw-verifier` | Sonnet | Goal-backward requirements verification |
| `tw-plan-checker` | Sonnet | Validates plans across 6 quality dimensions |
| `tw-debugger` | Opus | Hypothesis-driven debugging |
| `tw-dispatch` | Haiku | Parallel work coordinator |
| `tw-spec-writer` | Haiku | Writes spec entries from detected patterns |
| `tw-reviewer` | Sonnet | Semantic code review with anti-pattern detection (7 checks + 12 AI anti-patterns) |
| `tw-entropy-collector` | Haiku | Post-wave codebase integrity scan |

All agents receive skill tier instructions, token budget status, and a spec routing map automatically via the pre-tool-use hook.

---

## Starting from an Existing Blueprint or PRD

If you already have a requirements document, blueprint, or PRD, skip the interactive questions and feed it directly to Threadwork.

**Step 1:** Place your document anywhere in the project — the convention is `docs/`:

```
your-project/
└── docs/
    └── blueprint.md   ← your requirements or blueprint
```

**Step 2:** Initialize Threadwork:

```bash
threadwork init
```

**Step 3:** Run `/tw:new-project` with `--from-prd`:

```
/tw:new-project --from-prd docs/blueprint.md
```

This skips all seven clarifying questions and instead reads your document to generate:

- `.threadwork/state/PROJECT.md` — vision, principles, stack
- `.threadwork/state/REQUIREMENTS.md` — structured REQ-001/REQ-002 requirements
- `.threadwork/state/ROADMAP.md` — milestone and phase breakdown
- `.threadwork/state/STATE.json` — machine-readable project state
- Initial spec entries in `.threadwork/specs/`

**Step 4:** Continue with the standard phase workflow:

```
/tw:discuss-phase 1
/tw:plan-phase 1
/tw:execute-phase 1
/tw:verify-phase 1
/tw:clear
```

---

## Model Tier Management

v0.3.0 adds runtime model tier enforcement via `lib/model-switcher.js`. Each agent has a default tier (Opus for planning/research/debug, Sonnet for execution/verification, Haiku for coordination). When task complexity warrants a tier upgrade, the switcher fires according to your policy.

**Three policies** (apply to CLI commands; hooks always use auto-switch with a stderr line):
- `auto` — switches happen silently and are logged
- `notify` — a one-line stderr message is printed before any switch (hooks) or a 10-second countdown in interactive CLI commands
- `approve` — an explicit y/n prompt before each switch (CLI commands only)

Set policy at init (question 9) or change anytime mid-session:

```
/tw:model policy notify
/tw:model policy auto
/tw:model policy approve
```

Use `/tw:model` to see current model assignments and the session switch log. The switch log is included in handoff Section 6.

---

## Blueprint Evolution

When your project requirements change mid-implementation, `/tw:blueprint-diff` gives you structured options instead of ad-hoc patching.

Changes are categorized automatically:
- **ADDITIVE** — new requirements with no conflicts to existing work
- **MODIFICATIONS** — changes that may affect in-progress phases
- **STRUCTURAL** — scope, architecture, or technology changes requiring assessment

For each change category, three migration paths are estimated (restart / in-place patch / phased adoption). A recommendation is made at 15% and 40% scope change thresholds.

Run `/tw:blueprint-lock` before making blueprint edits to establish a clean baseline. Then run `/tw:blueprint-diff <updated-file>` to see the structured analysis before deciding how to proceed.

```
/tw:blueprint-lock                         # snapshot current state
/tw:blueprint-diff docs/blueprint-v2.md   # analyze changes
/tw:blueprint-diff --since-phase 3 docs/blueprint-v2.md  # analyze impact on remaining phases only
```

---

## Upgrading

```bash
# From v0.3.2 → v0.3.3
threadwork update --to v0.3.3

# From older versions — run sequentially
threadwork update --to v0.2.0
threadwork update --to v0.3.0
threadwork update --to v0.3.2
threadwork update --to v0.3.3
```

All migration commands are idempotent — safe to run multiple times. User specs, journals, handoffs, and plan files are **never modified**. See [docs/upgrade.md](docs/upgrade.md) for the full migration guide including step-by-step details and troubleshooting.

**Standard update (apply latest framework files to current project):**

```bash
# Check what's out of sync — no changes applied
threadwork update --verify

# Preview what would change
threadwork update --dry-run

# Apply all out-of-sync files
threadwork update
```

`threadwork update` compares every framework file by content (not modification date) before copying. Output shows ✅ up to date, ⬆ needs update, or ✨ new file per file. Covers: hooks, lib, commands, agents, and spec templates (new-only for specs — existing user specs are never overwritten).

---

## Development

```bash
npm install
npm test          # unit tests
npm run test:all  # unit + integration tests
npm run check     # syntax check all JS files

# Test hooks manually
node hooks/test-harness.js all
node hooks/test-harness.js session-start --tier ninja
echo '{}' | node hooks/session-start.js
```

---

## Contributing

Issues and PRs welcome at [github.com/nexora/threadwork](https://github.com/nexora/threadwork).

---

## License

MIT — see [LICENSE](LICENSE).
