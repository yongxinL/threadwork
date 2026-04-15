# Threadwork User Guide

**Version:** 1.2 | **Package:** `threadwork-cc` | **Runtime:** Claude Code / Codex

---

## Table of Contents

1. [What is Threadwork?](#1-what-is-threadwork)
2. [Installation](#2-installation)
3. [Core Concepts](#3-core-concepts)
4. [Getting Started](#4-getting-started)
5. [The Phase Workflow](#5-the-phase-workflow)
6. [Slash Command Reference](#6-slash-command-reference)
7. [Skill Tier System](#7-skill-tier-system)
8. [Token Budget System](#8-token-budget-system)
9. [Session Handoff System](#9-session-handoff-system)
10. [Spec Library](#10-spec-library)
11. [Hook System](#11-hook-system)
12. [Agent Roster](#12-agent-roster)
13. [Directory Structure](#13-directory-structure)
14. [Configuration Reference](#14-configuration-reference)
15. [Starting from an Existing Blueprint](#15-starting-from-an-existing-blueprint)
16. [Troubleshooting](#16-troubleshooting)
17. [Team Mode](#17-team-mode)
18. [Cost & Model Tier Management](#18-cost--model-tier-management)
19. [Blueprint Evolution](#19-blueprint-evolution)
20. [Design Reference System](#20-design-reference-system)
21. [Self-Evolution: Knowledge Harvest](#21-self-evolution-knowledge-harvest)
22. [Activity Log & Debugging](#22-activity-log--debugging)

---

## 1. What is Threadwork?

Threadwork is an AI workflow orchestration layer that sits on top of Claude Code (or Codex). It gives AI coding sessions structure, memory, and quality enforcement that survive across multiple sessions.

It provides:

- **Spec-driven project orchestration** — phases, milestones, planning, and parallel execution
- **Hook-enforced spec injection** — conventions and patterns injected automatically into every agent
- **Automated quality gates** — the Ralph Loop blocks completion until lint, typecheck, and tests pass
- **Token budgeting** — track and estimate usage before you run out of context
- **Structured session handoffs** — end every session with a resume prompt that restores full context
- **Skill-tier-aware output** — the AI adjusts verbosity to your experience level

The core principle is **hook-first architecture**: all intelligence is driven by four JavaScript hooks registered in Claude Code settings, not passive CLAUDE.md files. Specs, tier instructions, and budget warnings are injected automatically at the right moment — you don't have to remember to ask.

---

## 2. Installation

### Requirements

- Node.js ≥ 18 (Node 22 LTS recommended)
- npm ≥ 10
- Claude Code or Codex

```bash
node --version   # v22.x.x
npm --version    # 10.x.x
```

### Install from npm (recommended)

```bash
# Install globally
npx threadwork-cc@latest

# In your project directory:
threadwork init
```

### Install from source

```bash
git clone https://github.com/nexora/threadwork.git
cd threadwork

npm install
npm test              # unit tests (40 tests)
npm run test:all      # unit + integration tests (78 tests)

# Link globally
npm link

# Confirm
threadwork --version
```

### Unlink when done developing

```bash
npm unlink -g threadwork-cc
```

---

## 3. Core Concepts

Before diving into commands, it helps to understand the five systems that Threadwork runs.

### Phases and Milestones

Work is organized into **phases** (discrete units of work with plans and tasks) grouped under **milestones** (higher-level goals). You plan a phase before executing it, verify it after, and clear it when done.

### The Ralph Loop

The Ralph Loop is Threadwork's quality enforcement mechanism. After every subagent finishes work, the `subagent-stop` hook automatically runs your quality gates (lint, typecheck, tests). If any gate fails, the agent receives a correction prompt and retries — up to 5 times. Completion is blocked until gates pass or retries are exhausted.

Gates auto-detect available tools: `eslint`, `biome`, `oxlint`, `tsc`, and your `npm test` script. Results are cached per git commit SHA so unchanged code is never rechecked.

### Spec Library

Specs are markdown files describing your project's conventions — API design patterns, auth approach, testing standards, component structure. They live in `.threadwork/specs/` and are injected automatically into every subagent that handles relevant tasks. The spec engine uses keyword matching and an 8K token injection budget to select only what's needed.

### Skill Tiers

Your declared experience level (`beginner`, `advanced`, `ninja`) controls how the AI communicates — explanation depth, comment density, error message verbosity, and orientation blocks. The tier is injected into every subagent prompt automatically.

### Token Budget

Every Claude session has a finite context window. Threadwork tracks estimated token usage, warns you at 80% and 90%, and at 95% auto-generates a handoff to preserve your work before context is lost.

---

## 4. Getting Started

### Step 1: Run `threadwork init`

In your project directory:

```bash
threadwork init
```

This walks you through nine questions:

| # | Question | Options / Default |
|---|----------|--------------------|
| 1 | Project name | Free text |
| 2 | Tech stack | Next.js+TS / React+Vite+TS / Express / FastAPI / Other |
| 3 | Quality thresholds | Coverage % + lint level (strict / standard / relaxed) |
| 4 | Team mode | Solo / Small team (2–3) / Team (4+) |
| 5 | Skill tier | Beginner / Advanced (default) / Ninja |
| 6 | Session token budget | Default: 400K (200K model) or 800K (1M model) |
| 7 | Context model | Sonnet 200K (recommended) / Sonnet 1M |
| 8 | Per-session cost budget | Default: $5.00 |
| 9 | Model switch policy | `auto` (ninja) / `notify` (advanced, default) / `approve` (beginner) |

After answering, `threadwork init` will:

- Scaffold `.threadwork/` with all required subdirectories
- Write `project.json`, `quality-config.json`, `token-log.json`
- Copy 4 hooks into `.threadwork/hooks/`
- Register hooks in `~/.claude/settings.json` (Claude Code) or inject into `AGENTS.md` (Codex)
- Install 35 slash commands to `~/.claude/commands/tw/`
- Install 9 agent definitions to `~/.claude/agents/`
- Copy the project-level guide as `CLAUDE.md` (or `AGENTS.md` for Codex)
- Copy the starter spec library into `.threadwork/specs/`
- Creates `~/.threadwork/pricing.json` if absent
- Writes a `.gitignore` block with operational file exclusions
- Creates `.threadwork/workspace/sessions/` for session cost history

**Dry run mode** (preview without writing files):

```bash
threadwork init --dry-run
```

**Force a specific runtime** (skip auto-detection):

```bash
threadwork init --runtime claude-code
threadwork init --runtime codex
```

### Step 2: Start a new Claude Code session

After `threadwork init`, start a fresh Claude Code session in your project. The `session-start` hook fires automatically and injects:

- Project name, phase, milestone, and active task
- Token budget status
- Skill tier instructions
- A checkpoint warning if an incomplete session was detected

### Step 3: Initialize your project

In Claude Code, run:

```
/tw:new-project
```

This asks seven clarifying questions and generates three files:

- `PROJECT.md` — goals, scope, constraints, success criteria
- `REQUIREMENTS.md` — structured functional and non-functional requirements
- `ROADMAP.md` — milestone and phase breakdown with acceptance criteria

For an existing codebase:

```
/tw:analyze-codebase
```

This maps the project structure, detects your framework, generates an architecture summary, and creates a starter spec library tailored to what it finds.

---

## 5. The Phase Workflow

The standard workflow for each phase follows this sequence:

```
discuss-phase → plan-phase → execute-phase → verify-phase → clear
```

For milestone-level review, add `audit-milestone` at the end of each milestone.

### `/tw:discuss-phase <N>`

Before planning, capture developer preferences and decisions:

- Which libraries or patterns to use
- Architectural constraints
- Things to avoid
- Open questions

Output is saved to `.threadwork/state/phases/phase-N/discussion.md` and injected into the planner.

### `/tw:plan-phase <N>`

Spawns the `tw-planner` agent (Opus) to generate XML execution plans with token estimates.

- Reads your `REQUIREMENTS.md`, `ROADMAP.md`, and phase discussion notes
- Produces `PLAN-N-*.xml` files in `.threadwork/state/phases/phase-N/plans/`
- Each plan includes task IDs, dependencies, and per-task token estimates
- Displays a phase budget preview before finalizing

The `tw-plan-checker` agent (Sonnet) validates plans across six quality dimensions before they're accepted.

Preview the token cost of a plan before committing:

```
/tw:estimate generate the auth middleware for phase 2
```

### `/tw:execute-phase <N>`

Executes all plans using parallel wave execution:

1. Reads all plan XMLs and a `deps.json` dependency graph
2. Topologically sorts plans into parallel waves
3. Displays the wave structure:

```
Phase 2 Execution Plan:
  Wave 1 (parallel): PLAN-2-1, PLAN-2-2, PLAN-2-3
  Wave 2 (parallel): PLAN-2-4, PLAN-2-5
  Wave 3 (sequential): PLAN-2-6
Total: 6 plans, 18 tasks
```

4. Spawns `tw-executor` agents in parallel for each plan in a wave
5. Each executor receives its plan XML, project context, git branch info, and relevant specs (via hook)
6. After each wave, checks token budget and git commits
7. Ralph Loop runs after every executor completes

**Flags:**

| Flag | Effect |
|------|--------|
| `--wave <N>` | Execute only wave N |
| `--plan <ID>` | Execute only one plan |
| `--yolo` | Skip all interactive checkpoints, auto-continue |

### `/tw:verify-phase <N>`

Spawns the `tw-verifier` agent (Sonnet) to perform goal-backward verification:

- Reads requirements and maps each one to completed tasks
- Checks that all acceptance criteria are met
- Identifies any gaps or regressions
- Generates a token variance report: estimated vs actual per task, with improvement recommendations

### `/tw:clear`

Closes the current phase and advances to the next:

- Writes a phase handoff document
- Clears the active checkpoint
- Updates `currentPhase` in `project.json`
- Archives phase state

### `/tw:audit-milestone <N>`

After completing all phases in a milestone, runs a cross-phase verification:

- Reviews every completed phase against the milestone's acceptance criteria
- Checks for inter-phase inconsistencies
- Produces a milestone sign-off report

---

## 6. Slash Command Reference

All commands use the `/tw:` prefix. They are installed to `~/.claude/commands/tw/`.

### Project Setup

| Command | Description |
|---------|-------------|
| `/tw:new-project` | 7 clarifying questions → `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md` |
| `/tw:analyze-codebase` | Map brownfield project → detect framework, generate starter specs |

### Phase Workflow

| Command | Description |
|---------|-------------|
| `/tw:discuss-phase <N>` | Capture library/pattern decisions before planning |
| `/tw:plan-phase <N>` | Generate XML plans with token estimates + phase budget preview |
| `/tw:execute-phase <N>` | Parallel wave execution with spec injection + Ralph Loop |
| `/tw:verify-phase <N>` | Goal-backward verification + token variance report |
| `/tw:clear` | Close phase, write phase handoff, advance to next |
| `/tw:audit-milestone <N>` | Cross-phase milestone verification |

### Task Execution

| Command | Description |
|---------|-------------|
| `/tw:quick <desc>` | Fast-path task — shows estimate, executes, commits |
| `/tw:parallel <desc>` | Isolated worktree execution → creates a draft PR |

### Token Budget

| Command | Description |
|---------|-------------|
| `/tw:budget` | Session budget dashboard |
| `/tw:estimate <desc>` | Token estimate before committing to a task |
| `/tw:tokens` | Full session token log with per-task breakdown |
| `/tw:variance` | Phase variance report — estimated vs actual, recommendations |

### Session Handoff

| Command | Description |
|---------|-------------|
| `/tw:done` | End session — generate 10-section handoff + paste-able resume prompt |
| `/tw:resume` | Load latest handoff, announce readiness to continue |
| `/tw:recover` | Restore context after a crash or unexpected session end |
| `/tw:handoff [list\|show N]` | List or view past handoff documents |

### Knowledge

| Command | Description |
|---------|-------------|
| `/tw:recall <query>` | Search journals, specs, handoffs, and project history |
| `/tw:specs [subcommand]` | Manage the spec library (list, show, search, add, edit, review) |
| `/tw:journal [subcommand]` | View or search session journals (30-day rolling window) |
| `/tw:docs-health` | Doc freshness report — stale documentation detected by file reference analysis |

### Cost & Model

| Command | Description |
|---------|-------------|
| `/tw:cost` | Cost budget dashboard — session total by model tier, projected session end |
| `/tw:cost history` | Cost across all sessions from committed session-summary files |
| `/tw:model` | Current model assignments, switch policy, session switch log |
| `/tw:model policy <mode>` | Change switch policy mid-session (auto/notify/approve) |

### Blueprint Management

| Command | Description |
|---------|-------------|
| `/tw:blueprint-diff <file>` | Analyze blueprint changes — categorize (ADDITIVE/MODIFICATIONS/STRUCTURAL) and estimate migration options |
| `/tw:blueprint-diff --since-phase <N> <file>` | Analyze impact on remaining phases only |
| `/tw:blueprint-lock [note]` | Snapshot current blueprint as versioned baseline |

### Observability

| Command | Description |
|---------|-------------|
| `/tw:log` | Last 20 WARN+ entries — quick error/warning summary across hooks and lib/ modules |
| `/tw:log --level debug` | All entries including verbose DEBUG traces from lib/ modules |
| `/tw:log --tail 100 --since 1h` | Last 100 entries from the past hour |
| `/tw:log --errors-only` | ERROR entries only |

CLI equivalent (outside Claude Code):

```bash
threadwork log                   # last 50 INFO+ entries
threadwork log --level warn      # WARN and ERROR only
threadwork log --follow          # live-tail (Ctrl+C to stop)
threadwork log --json            # raw JSONL output — one object per line
```

### Configuration

| Command | Description |
|---------|-------------|
| `/tw:tier [set <tier>]` | View current tier, or change it |
| `/tw:status` | Full project status dashboard |

### Enforcement & Verification *(New in v0.3.2)*

| Command | Description |
|---------|-------------|
| `/tw:readiness` | 7-point harness readiness audit — spec coverage, gaps, knowledge notes, doc freshness |
| `/tw:verify-manual` | Generate printable manual test checklist from verification profile |
| `/tw:autonomy [set <level>]` | View or set autonomy level (supervised/guided/autonomous) |

---

## 7. Skill Tier System

The skill tier controls how the AI communicates — not what it does, but how it explains it. Set at `threadwork init`. Change anytime with `/tw:tier set <tier>`.

### Tiers

| Tier | Best for | Behavior |
|------|----------|----------|
| `beginner` | Learning, onboarding | Step-by-step reasoning, inline code comments throughout, "what just happened" summaries, orientation blocks at phase transitions, explained token warnings |
| `advanced` | Most developers *(default)* | 1–2 sentence reasoning summaries, comments only for non-obvious logic, terse status updates, brief one-liner token warnings |
| `ninja` | Experienced, fast-paced | Code only, no narration, raw errors with minimal fix, machine-readable compact output, single indicator for warnings (e.g. `🚨 91%`) |

### How it works

The tier value from `project.json` is read by the `session-start` hook and the `pre-tool-use` hook. It's injected into every subagent prompt as an `## Output Style` block. Every command, every agent, every quality gate message adapts uniformly.

### Changing your tier

```
/tw:tier set beginner
/tw:tier set advanced
/tw:tier set ninja

# View current tier:
/tw:tier
```

The change takes effect immediately — the next subagent invocation picks it up.

---

## 8. Token Budget System

Claude models have a finite context window. Without tracking, you can silently run into the limit mid-task and lose progress. Threadwork makes token usage a first-class concern.

### How budgeting works

Default budget: 400K tokens for Sonnet 200K (configurable at init). 800K for Sonnet 1M.
Cost budget: $5.00 per session (configurable at init).

Both are tracked simultaneously. Use `/tw:budget` for the dual dashboard or `/tw:cost` for cost-only view.

Each completed task's token usage is recorded in `.threadwork/state/token-log.json`. Usage is estimated using a `chars / 4` heuristic — no API call required. Cost is calculated via `calculateCost()` using a 60/40 input/output split against rates in `~/.threadwork/pricing.json`.

### Thresholds

| Usage | Status | Action |
|-------|--------|--------|
| < 80% | Healthy | Normal operation |
| ≥ 80% | Warning | Injected into next prompt: "consider wrapping up" |
| ≥ 90% | Critical | Stderr warning + visible in every output |
| ≥ 95% | Auto-handoff | Handoff generated even without running `/tw:done` |

### Commands

**Dashboard:**
```
/tw:budget
```
```
Token Budget — my-project
  Used:      180K / 400K  (45%)   ✅ Healthy
  Remaining: 220K

Cost Budget — my-project
  Used:      $0.87 / $5.00 (17%) ✅ Healthy
  Remaining: $4.13
```

**Pre-task estimate:**
```
/tw:estimate add JWT refresh token rotation to the auth middleware
```
```
Task: "add JWT refresh token rotation to the auth middleware"
Complexity: medium
Estimated:  15K–40K tokens (midpoint: 27K)
Remaining:  488K
Verdict:    ✅ Safe to proceed
```

Verdict bands:
- `✅ Safe` — estimate well within budget
- `⚠️ Caution` — estimate pushes you past 80%
- `🚨 Risk` — estimate pushes you past 90%

**Cost dashboard:**
```
/tw:cost
```

Shows cost by model tier (Haiku / Sonnet / Opus), session total, and projected session-end cost.

```
/tw:cost history
```

Shows costs across past sessions from committed session-summary files.

**Full token log:**
```
/tw:tokens
```

**Variance report:**
```
/tw:variance
```

Shows estimated vs actual per task with accuracy ratings:
- **Excellent** — within 10% of estimate
- **Good** — within 20%
- **Needs Improvement** — over 20% off

Recommendations are generated to improve future estimates (e.g. "complex auth tasks consistently run 30% over — adjust your estimates upward").

### Complexity heuristics

The estimator classifies tasks by description:

| Complexity | Triggers | Range |
|------------|----------|-------|
| Simple | `add`, `fix`, `rename`, `remove` + short description | 5K–15K |
| Medium | Mixed signals, moderate description length | 15K–40K |
| Complex | `auth`, `migration`, `database`, `integration`, `refactor`, long descriptions | 40K–80K |

Planning phases (phase ≤ 1) apply a 0.7× multiplier — they're cheaper than execution.

---

## 9. Session Handoff System

The handoff system ensures you can always resume from exactly where you left off, even after a crash.

### Ending a session

```
/tw:done
```

This command:
1. Reads all session state files
2. Asks you to record any key decisions (optional)
3. Generates a 10-section handoff document at `.threadwork/workspace/handoffs/YYYY-MM-DD-N.md`
4. Writes a checkpoint to `.threadwork/state/checkpoint.json`
5. Prints a self-contained resume prompt to the terminal

### The 10-section handoff

| Section | Content |
|---------|---------|
| 1. Session Overview | Date, phase, milestone, estimated duration |
| 2. Completed This Session | Task IDs with one-line descriptions |
| 3. In Progress | Active task and completion percentage |
| 4. Key Decisions | Architectural and design decisions recorded |
| 5. Files Modified | From `git diff` since session start |
| 6. Token Usage | Used/budget/% + per-task table |
| 7. Git State | Branch, last commit SHA, uncommitted file count |
| 8. Quality Gate Status | Last Ralph Loop result |
| 9. Recommended Next Action | Single sentence — what to do first next session |
| 10. Resume Prompt | Self-contained paste-able block |

### The resume prompt

```
── THREADWORK RESUME ──────────────────────────────
Project: my-project | Phase: 2 | Milestone: 1
Last session: 2026-02-27 | Branch: feature/auth
Completed: T-2-1, T-2-2, T-2-3
In progress: T-2-4 — JWT refresh rotation (60%)
Next action: Complete T-2-4, then run /tw:verify-phase 2
Token budget remaining: 488K / 800K
Skill tier: advanced
─────────────────────────────────────────────────
Continue from where we left off. Load checkpoint
and resume task T-2-4.
```

Paste this as your first message in the next session. Everything needed to restore context is in this block — no file reading required.

### Resuming a session

```
/tw:resume
```

Reads the latest handoff, announces readiness, and restores the checkpoint state.

### Recovering after a crash

If a session ends unexpectedly (crash, timeout, manual close):

```
/tw:recover
```

Reads `.threadwork/state/checkpoint.json` and the latest handoff to reconstruct session context. Use this instead of `/tw:resume` when the session didn't end cleanly.

### Viewing past handoffs

```
/tw:handoff list        # show all handoffs with dates and phases
/tw:handoff show 3      # display the 3rd most recent handoff
```

---

## 10. Spec Library

Specs are the long-term memory of your project's conventions. They tell the AI how your project works — not what to build, but how to build it.

### Two-Tier Architecture (v0.3.3)

Specs are organized into two tiers:

**Tier 1 — Core specs** (language-agnostic, always available):
- Rules, tables, and principles without code examples
- Fit within the routing map budget (~150 tokens)
- Tags span all stacks: `[api, rest, http, backend, fastapi, express, django]`

**Tier 2 — Stack-scoped references** (on-demand via `spec_fetch`):
- Concrete, runnable code examples for a specific stack
- Enforcement rules live here (they target specific file extensions)
- Tags are stack-specific: `[typescript, nextjs, prisma]` or `[python, fastapi, pydantic]`

Each spec is a markdown file with YAML frontmatter:

```markdown
---
domain: backend
name: api-design
specId: SPEC:be-001
updated: 2026-04-15
confidence: 0.95
tags: [api, rest, http, endpoint, route, service, backend]
rules:
  - type: grep_must_not_exist
    pattern: "stackTrace|stack_trace"
    files: "src/**/*.{ts,py}"
    message: "Never expose stack traces in API responses (SPEC:be-001)"
---

# API Design Standards

## 7 Iron Rules
1. Resources map to domain concepts, not database tables...
```

### Starter specs

Installed at `threadwork init` from `templates/specs/core/`:

| Tier | Spec | Content |
|------|------|---------|
| 1 | `backend/api-design.md` (SPEC:be-001) | 7 iron rules, HTTP status table, response envelope, anti-pattern table |
| 1 | `backend/auth.md` (SPEC:be-002) | JWT security principles, middleware ordering, auth method selection |
| 1 | `backend/db-schema.md` (SPEC:be-003) | 7 core rules, PK strategy, indexes, zero-downtime migrations |
| 1 | `testing/testing-standards.md` (SPEC:test-001) | Testing pyramid, 7 rules, endpoint coverage matrix, isolation strategies |
| 2 | `backend/ts-patterns.md` (SPEC:be-ts-001) | Zod, jose, bcrypt, Prisma, httpOnly cookies, Jest/Vitest patterns |
| 2 | `backend/python-patterns.md` (SPEC:be-py-001) | Pydantic, FastAPI, SQLAlchemy, Alembic, factory_boy, Django patterns |
| — | `frontend/react-patterns.md` | Component structure, hooks, composition, typed props |
| — | `frontend/styling.md` | CSS conventions, responsive patterns |

Additionally, `threadwork init` seeds stack-matched specs from `templates/specs/learned/` — patterns harvested from previous projects that match your tech stack.

### Stack-aware injection

The `pre-tool-use` hook fires before every `Task()` call. It:

1. Reads all specs from `.threadwork/specs/`
2. Matches specs to the task by keyword + tag overlap
3. Reads `project.json.techStack` and boosts relevance for matching Tier 2 specs (+3 score)
4. Builds a routing map (~150 tokens) listing the top 5 relevant specs
5. Agents fetch full spec content on demand via `spec_fetch`

A Next.js project surfaces `ts-patterns.md` automatically; a FastAPI project surfaces `python-patterns.md`.

### Managing specs

```
/tw:specs list                     # show all specs with tags
/tw:specs show backend/api-design  # display a spec
/tw:specs search "authentication"  # find specs by content
/tw:specs add                      # interactively create a new spec
/tw:specs edit backend/auth        # edit an existing spec
/tw:specs proposals                # list pending AI-proposed updates
/tw:specs accept <id>              # approve a proposal
```

### AI-proposed spec updates

When the Ralph Loop catches repeated failures or the `tw-spec-writer` agent notices new patterns, spec updates are proposed via `proposeSpecUpdate()`. Proposals are stored in `.threadwork/specs/proposals/`.

Proposals gain confidence over time:
- Initial: 0.3 (from Ralph Loop)
- Developer accepts: 0.7
- Survives 3+ sessions: auto-promoted to global Store (0.85)

---

## 11. Hook System

Threadwork registers four hooks into `~/.claude/settings.json`. They fire automatically — you don't invoke them manually.

### Hook 1: `session-start.js`

**Fires:** When Claude Code starts a session in your project.

**What it does:**
- Reads `project.json` and `token-log.json`
- Composes an orientation block with: project name, current phase/milestone/task, token budget dashboard, skill tier, checkpoint warning if an unfinished session was detected
- Injects this block as the first system message of the session

### Hook 2: `pre-tool-use.js`

**Fires:** Before every tool call where the tool name is `Task` or `task` (i.e., before spawning any subagent).

**What it does:**
- Reads relevant specs via the spec engine (8K limit)
- Reads current token budget
- Reads skill tier instructions
- Prepends a context block to the agent prompt

This is why every agent automatically follows your conventions and knows the budget state — they receive the context before they start.

### Hook 3: `post-tool-use.js`

**Fires:** After every tool call.

**What it does:**
- Estimates tokens used by the tool call and records them
- Detects learning signals (new patterns, convention deviations) and logs them
- Writes a checkpoint to `.threadwork/state/checkpoint.json` (async, deferred 100ms to avoid blocking)
- Logs to `.threadwork/workspace/hook-log.json` for debugging

### Hook 4: `subagent-stop.js` — The Ralph Loop

**Fires:** When a subagent completes (SubagentStop event).

**What it does:**
1. Reads the quality config from `.threadwork/state/quality-config.json`
2. Runs all enabled quality gates: typecheck → lint → tests → build → security scan
3. Gates are cached per git commit SHA — unchanged code is not re-run
4. **If gates pass:** records success, the subagent is done
5. **If gates fail:** generates a tier-appropriate correction prompt and re-runs the agent (up to 5 retries)
6. After 5 failed retries: escalates with an error message, marks the plan as FAILED

**Key guarantee:** All hooks catch errors and exit 0. Hooks never crash your session. Quality gate failures result in retry prompts, not session crashes.

### Structured logging

Every hook writes structured log entries to `.threadwork/state/hook-log.json` (JSONL format — one JSON object per line). Lib/ modules (`quality-gate`, `spec-engine`, `harvest`) write to `.threadwork/logs/threadwork.log` using the same format. Both sources are merged and displayed together by `threadwork log` and `/tw:log`.

```bash
threadwork log                    # quick view: last 50 INFO+ entries
threadwork log --level warn       # see only warnings and errors
threadwork log --follow           # live-tail during active session
```

See [Section 22 — Activity Log & Debugging](#22-activity-log--debugging) for the full reference.

### Codex compatibility

For Codex, hooks are not available. Instead, the equivalent behavioral instructions are injected into `AGENTS.md` at init time. Codex will follow these instructions as its system prompt. The spec library and state directory work identically.

### Testing hooks manually

```bash
# Simulate all hook events at all tiers and budget levels
node hooks/test-harness.js all

# Simulate a specific hook
node hooks/test-harness.js session-start --tier ninja
echo '{}' | node hooks/session-start.js
```

---

## 12. Agent Roster

Threadwork installs ten specialized agents into `~/.claude/agents/`. They are invoked automatically by commands — you don't call them directly in most cases.

| Agent | Model | Role |
|-------|-------|------|
| `tw-planner` | Opus | Generates XML execution plans with task IDs, dependencies, and per-task token estimates |
| `tw-researcher` | Opus | Domain research — library recommendations, API docs, pattern analysis |
| `tw-executor` | Sonnet | Implements tasks with atomic commits, spec compliance, quality gate adherence |
| `tw-verifier` | Sonnet | Goal-backward requirements verification — maps tasks to requirements, identifies gaps; checks design fidelity |
| `tw-plan-checker` | Sonnet | Validates plans across 6 quality dimensions before execution |
| `tw-debugger` | Opus | Hypothesis-driven debugging with systematic root cause identification |
| `tw-dispatch` | Haiku | Parallel work coordinator — orchestrates wave execution, manages task assignment |
| `tw-spec-writer` | Haiku | Detects patterns from completed tasks, proposes spec updates |
| `tw-reviewer` | Sonnet | **New in v0.3.2** — Structured peer review of executor output: spec compliance, naming, import boundaries, test coverage, and design fidelity (when design refs are present) |
| `tw-entropy-collector` | Haiku | **Updated in v0.3.2** — Post-wave codebase integrity scan; now checks spec staleness as 7th category |

All agents receive:
- Skill tier instructions (via `pre-tool-use` hook)
- Token budget status (via `pre-tool-use` hook)
- Relevant specs (via `pre-tool-use` hook)
- A checkpoint protocol (save state before stopping)

---

## 13. Directory Structure

### Package structure (installed globally)

```
threadwork-cc/
├── bin/
│   └── threadwork.js          CLI entry point
├── hooks/
│   ├── session-start.js       Hook 1 — session init
│   ├── pre-tool-use.js        Hook 2 — spec + budget injection
│   ├── post-tool-use.js       Hook 3 — token tracking + checkpoint
│   ├── subagent-stop.js       Hook 4 — Ralph Loop quality gates
│   └── test-harness.js        Manual hook simulation
├── lib/
│   ├── runtime.js             Runtime detection (Claude Code vs Codex)
│   ├── state.js               State read/write, phase/task/checkpoint management
│   ├── token-tracker.js       Budget tracking, estimation, variance reporting
│   ├── skill-tier.js          Tier get/set, instruction generation, output formatting
│   ├── git.js                 Branch, commits, worktrees, atomic commit writes
│   ├── journal.js             Session journals (30-day rolling window)
│   ├── handoff.js             10-section handoff generation and parsing
│   ├── spec-engine.js         Spec parsing, relevance matching, injection building
│   ├── quality-gate.js        Lint/typecheck/test/build/security/spec-compliance runners, SHA caching
│   ├── rule-evaluator.js      Spec rule evaluation engine — 5 machine-checkable rule types
│   ├── knowledge-notes.js     Knowledge note lifecycle — capture, retrieval, promotion
│   ├── doc-freshness.js       Doc staleness detection via file reference analysis
│   ├── design-ref.js          Design reference injection — HTML/PNG/SVG wireframes into prompts
│   ├── verification-profile.js Runtime verification profiles — smoke tests for built artifacts
│   ├── autonomy.js            Autonomous operation mode — 3 levels, safety rails
│   └── logger.js              Centralized structured logger — writes JSONL to .threadwork/logs/
├── install/
│   ├── init.js                Interactive setup — 6 questions
│   ├── claude-code.js         Settings.json hook merge, commands + agents install
│   ├── codex.js               AGENTS.md injection
│   ├── update.js              Framework file updates (preserves user specs)
│   ├── status.js              CLI status dashboard
│   └── log.js                 CLI log viewer — merges hook-log.json + threadwork.log
├── templates/
│   ├── commands/              28 slash command markdown files
│   ├── agents/                10 agent definition files
│   ├── specs/                 Starter spec library
│   └── AGENTS.md              Project-level guide (installed as CLAUDE.md or AGENTS.md)
└── tests/
    ├── unit/                  Unit tests for lib/ modules
    └── integration/           Integration tests for hooks, install, handoff
```

### Per-project directory (created by `threadwork init`)

```
.threadwork/
├── state/
│   ├── project.json           Project config — name, stack, phase, tier, budget
│   ├── checkpoint.json        Current session checkpoint (written after every tool call)
│   ├── token-log.json         Session token usage + per-task breakdown
│   ├── quality-config.json    Gate thresholds — coverage %, lint level, enabled gates
│   ├── .gate-cache.json       Quality gate results cached per git SHA
│   └── phases/
│       └── phase-N/
│           ├── discussion.md  Notes from /tw:discuss-phase N
│           ├── plans/         PLAN-N-*.xml execution plans
│           ├── deps.json      Plan dependency graph
│           ├── execution-log.json  Wave execution results
│           └── verification.md    /tw:verify-phase N output
├── logs/
│   └── threadwork.log         Structured JSONL log from lib/ modules (quality-gate, spec-engine, harvest)
├── specs/
│   ├── frontend/              react-patterns.md, styling.md
│   ├── backend/               api-design.md, auth.md
│   ├── testing/               testing-standards.md
│   ├── proposals/             AI-proposed spec updates (pending review)
│   └── index.md               Spec index with tags and descriptions
└── workspace/
    ├── journals/              Session journals (one per session, 30-day window)
    ├── handoffs/              Session handoff documents (YYYY-MM-DD-N.md)
    └── archive/               Archived phase state
```

---

## 14. Configuration Reference

### `project.json`

```json
{
  "_version": "0.3.0",
  "_updated": "2026-03-05T12:00:00.000Z",
  "projectName": "my-project",
  "techStack": "Next.js + TypeScript",
  "currentPhase": 2,
  "currentMilestone": 1,
  "activeTask": "T-2-4",
  "skillTier": "advanced",
  "sessionBudget": 400000,
  "teamMode": "solo",
  "default_context": "200k",
  "cost_budget": 5.00,
  "model_switch_policy": "notify",
  "qualityConfig": {
    "minCoverage": 80,
    "lintLevel": "strict"
  }
}
```

### `quality-config.json`

```json
{
  "_version": "1",
  "typecheck": { "enabled": true, "blocking": true },
  "lint":      { "enabled": true, "blocking": true },
  "tests":     { "enabled": true, "blocking": true, "minCoverage": 80 },
  "build":     { "enabled": false, "blocking": false },
  "security":  { "enabled": true, "blocking": false },
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

**Notes:**
- `blocking: true` means a failure blocks agent completion (triggers Ralph Loop retry)
- `blocking: false` means a failure is logged but doesn't block
- `build` is disabled by default — enable it for production pipelines
- `security` is non-blocking by default — findings are reported but don't halt work
- Lint tool is auto-detected: `eslint` → `biome` → `oxlint` (first found wins)

### Output Filter

The `outputFilter` block in `quality-config.json` controls how raw command output is compressed before being embedded in agent correction prompts (Ralph Loop remediation blocks). It applies four strategies:

| Strategy | What it removes / compresses | Safe to disable? |
|----------|------------------------------|-----------------|
| **Smart Filtering** | Passing test lines (`✔`, `ok N`), TAP boilerplate (`# pass`, `# tests`), lint summary lines (`N problems`) | Yes — raw output is passed through unchanged |
| **Grouping** | Lint violations → aggregated by rule name; TypeScript errors → aggregated by file | Yes — flat list used instead |
| **Truncation** | Caps failures at `maxFailures`; caps locations per group at `maxErrorsPerGroup`; always appends `... +N more` | Yes — full output passed |
| **Deduplication** | Identical failure headers collapsed with `×N` count | Yes — duplicates retained |

**What is never removed:** error messages, stack trace lines, file paths, line numbers, error codes. Only passing noise is filtered — the LLM always receives full failure context. The `... +N more` counts also tell the agent how many issues were omitted.

**Tuning:**

```json
"outputFilter": {
  "enabled": true,
  "maxFailures": 20,          ← show up to 20 failure blocks (default 10)
  "maxErrorsPerGroup": 5,     ← show 5 locations per lint rule / TS file (default 3)
  "maxLineLength": 300,       ← longer lines before truncation (default 200)
  "strategies": {
    "smartFiltering": true,
    "grouping": false,        ← disable grouping if you prefer flat lists
    "truncation": true,
    "deduplication": true
  }
}
```

**Disable entirely** (pass all raw output to the LLM unchanged):

```json
"outputFilter": { "enabled": false }
```

### Skill tier

Set at init. Change with `/tw:tier set <tier>`. Stored in `project.json` as `skillTier`.

Valid values: `beginner`, `advanced`, `ninja`. Falls back to `advanced` if unset or invalid.

### Token budget

Set at init (in thousands). Stored in `token-log.json` as `sessionBudget` (in tokens, not thousands).

Thresholds are fixed at 80% (warning) and 90% (critical). The auto-handoff threshold is fixed at 95%.

### Updating framework files

After a `threadwork-cc` package update, update the framework files in your project (hooks, lib) while preserving your custom specs:

```bash
threadwork update
```

---

## 15. Starting from an Existing Blueprint

If you already have a requirements document, blueprint, or PRD before starting a Threadwork project, use the `--from-prd` flag to skip the interactive questions and let Threadwork read your document instead.

### Where to put your document

Place it anywhere in the project — the convention is `docs/`:

```
your-project/
├── docs/
│   ├── blueprint.md        ← your blueprint or PRD
│   └── requirements.md     ← optional separate requirements doc
└── ...
```

The file can be any name with any extension (`.md`, `.txt`, `.pdf`, `.docx`). It just needs to be readable from the project root.

### Procedure

**Step 1: Initialize Threadwork**

```bash
threadwork init
```

Answer the six setup questions (project name, stack, quality thresholds, team mode, skill tier, session budget). These configure the runtime — not the project requirements, which will come from your document.

**Step 2: Run `/tw:new-project --from-prd`**

```
/tw:new-project --from-prd docs/blueprint.md
```

This skips all seven clarifying questions and instead:

1. Reads your document
2. Spawns a `tw-researcher` agent to analyze the domain and identify patterns
3. Spawns a `tw-planner` agent to generate project files from your document's content

**Step 3: Review generated files**

Threadwork generates four files in `.threadwork/state/`:

| File | Contents |
|------|----------|
| `PROJECT.md` | Vision (2–3 sentences), core principles, confirmed tech stack, constraints |
| `REQUIREMENTS.md` | Functional requirements in REQ-001/REQ-002 format, non-functional requirements, explicitly out-of-scope items |
| `ROADMAP.md` | Milestone and phase breakdown derived from your document |
| `STATE.json` | Machine-readable project state |

Initial spec entries are also written to `.threadwork/specs/` based on stack decisions found in your document.

Review the generated files and correct anything that was misread. You can edit them directly — they're plain markdown.

**Step 4: Continue with the standard phase workflow**

```
/tw:discuss-phase 1     ← capture preferences before planning
/tw:plan-phase 1        ← generate XML execution plans
/tw:execute-phase 1     ← run parallel wave execution
/tw:verify-phase 1      ← verify output meets requirements
/tw:clear               ← close phase, advance to next
```

### What if my document is partial or informal?

`--from-prd` works with any level of detail. If your document is a rough outline or a one-page summary, the planner will ask clarifying questions about gaps before generating the roadmap. If your document is a formal specification, the planner will use it directly.

For very early-stage projects where no document exists yet, use `/tw:new-project` without `--from-prd` — the interactive questions produce the same output from scratch.

---

## 16. Troubleshooting

### Hooks not firing

1. Check that hooks are registered in `~/.claude/settings.json`:
   ```bash
   cat ~/.claude/settings.json | grep threadwork
   ```
2. Ensure you're in a project where `threadwork init` was run (`.threadwork/` exists)
3. Run the test harness to verify hooks work in isolation:
   ```bash
   node hooks/test-harness.js all
   node hooks/test-harness.js session-start
   ```

### Quality gates not running

1. Check `.threadwork/state/quality-config.json` — confirm the gates you expect are `"enabled": true`
2. The gate auto-detection requires the tool to be in your `PATH`. Verify:
   ```bash
   which eslint   # or biome, oxlint
   which tsc
   ```
3. If gates pass but still retry: check the SHA cache at `.threadwork/state/.gate-cache.json`. Delete it to force a fresh run.

### Token tracking seems off

Token estimation uses `chars / 4` — it's a heuristic, not an exact count. Large tool outputs (file reads, bash output) can add untracked tokens. The variance report (`/tw:variance`) will show where estimates diverge most.

### `threadwork init` fails or hangs

- Check Node.js version: `node --version` (requires ≥ 18)
- Try dry-run mode to isolate where it fails: `threadwork init --dry-run`
- Check write permissions in your project directory and `~/.claude/`

### Recovering from a crashed session

```
/tw:recover
```

This reads `.threadwork/state/checkpoint.json` written by the last `post-tool-use` hook. If the checkpoint is missing (crash before the first tool call), use `/tw:handoff show 1` to get the most recent handoff and manually restore context.

### Hooks log location

Hook events are written to `.threadwork/state/hook-log.json` (JSONL). Lib/ module output goes to `.threadwork/logs/threadwork.log`. Use `threadwork log` to view both sources merged:

```bash
threadwork log                   # last 50 INFO+ entries
threadwork log --level warn      # WARN and ERROR only — fastest triage
threadwork log --tail 200        # wider window
threadwork log --follow          # live-tail during an active session
```

For raw inspection:

```bash
tail -50 .threadwork/state/hook-log.json
tail -50 .threadwork/logs/threadwork.log
```

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

### session_token_budget still shows 800K after v0.3.0 upgrade

The migration recalibrates 800K → 400K only with user confirmation. If you declined, edit `.threadwork/state/project.json` and set `"session_token_budget": 400000` manually — but only if you are using the Sonnet 200K model.

---

## 17. Team Mode

### 17.1 What is Team Mode?

By default, `/tw:execute-phase` uses **legacy mode**: each plan in a wave is spawned as a fire-and-forget `Task()` call. Executors write `SUMMARY.md` when done — but if an executor hits a blocking issue mid-task, it fails silently.

**Team mode** upgrades this to Claude Code's Team model:
- Executors join a named team and communicate via `SendMessage`
- A blocked executor sends `BLOCKED` to the orchestrator with the specific reason
- The orchestrator can send recovery guidance and retry — rather than silently failing the plan
- The orchestrator sees real-time status per plan (`DONE` / `BLOCKED` / `BUDGET_LOW`)
- The Ralph Loop still runs after each executor stops — quality gates are enforced regardless

### 17.2 `teamMode` Setting

Set at `threadwork init` (question 4) or change anytime with `/tw:status set teamMode <value>`:

| Value | Behavior |
|---|---|
| `legacy` | Always use fire-and-forget Task() execution. Predictable, lower token overhead. |
| `auto` | **Recommended.** System decides per wave based on plan count and budget (see 17.3). |
| `team` | Always use Team model when budget allows (≥10% remaining). Fastest for large phases. |

### 17.3 Auto-Decision Logic

When `teamMode=auto`, the system evaluates four conditions before each wave:

| Condition | Threshold | Why |
|---|---|---|
| Plan count | ≥ 2 | Single plans don't benefit from team overhead |
| Remaining budget | ≥ 30% of session budget | Ensures enough budget for all workers + future waves |
| Wave estimate | ≤ 50% of remaining budget | Prevents a single wave from exhausting the budget |
| Tier max workers | ≥ 2 | Beginner=2, Advanced=3, Ninja=5 |

If any condition fails, the wave uses legacy mode. The decision is shown inline:

```
Wave 1: 3 plans — Team mode  (budget: 420K/800K, est: 95K, workers: 3)
Wave 2: 1 plan  — Legacy mode (single plan)
```

### 17.4 Token Budget in Team Mode

Running multiple agents in parallel multiplies token consumption. Threadwork manages this with:

**Per-worker budget cap:**
```
workerBudget = floor(remainingBudget × 0.6 / numWorkers)
minimum: 50,000 tokens
```

The 0.6 factor reserves 40% for the orchestrator and future waves. Each executor receives its cap in the `[TEAM: ... workerBudget=<N>]` marker.

**`BUDGET_LOW` protocol:**
When a worker's remaining budget drops below 10% of its cap:
1. It writes a checkpoint with remaining tasks listed
2. Sends `BUDGET_LOW planId=<P> remaining=<task IDs>` to the orchestrator
3. Stops cleanly — the orchestrator notes the partial completion

This prevents workers from silently consuming more than their allocation.

**See also:** [Section 8 — Token Budget System](#8-token-budget-system) for session-level budget controls.

### 17.5 Flags Reference

| Flag | Description |
|---|---|
| `--team` | Force Team model for this invocation (overrides project teamMode) |
| `--no-team` | Force legacy mode for this invocation (always wins) |
| `--max-workers N` | Cap parallel workers per wave (1–10; overrides tier default) |

Examples:
```
/tw:execute-phase 2                        # use project teamMode
/tw:execute-phase 2 --team                 # force Team model
/tw:execute-phase 2 --no-team              # force legacy (budget-conscious)
/tw:execute-phase 2 --team --max-workers 2 # Team model, max 2 workers per wave
/tw:parallel "add dark mode" --team        # parallel feature with mini-team
/tw:parallel "add dark mode" --no-team     # parallel feature, legacy dispatch
```

### 17.6 `team-session.json`

When a team wave is active, Threadwork writes `.threadwork/state/team-session.json`:

```json
{
  "_version": "1",
  "_updated": "2026-03-01T10:00:00.000Z",
  "teamName": "tw-phase-2-1-12345678",
  "phase": 2,
  "waveIndex": 1,
  "mode": "execute-phase",
  "leadName": "tw-orchestrator",
  "workerNames": ["tw-executor-plan-2-1", "tw-executor-plan-2-2"],
  "workerBudget": 160000,
  "activePlans": ["PLAN-2-1", "PLAN-2-2"],
  "completedPlans": [],
  "failedPlans": [],
  "startedAt": "2026-03-01T09:58:00.000Z",
  "status": "active",
  "cleared": false
}
```

This file is visible in `/tw:status` when a team session is active. It is cleared (set to `{ cleared: true }`) after each wave completes.

### 17.7 Troubleshooting Team Mode

**`TeamCreate` failed / Team model not available**

The system automatically falls back to legacy mode for that wave and logs:
```
TeamCreate failed, falling back to legacy wave execution
```
This usually means you're on an older version of Claude Code that doesn't support the Team tools. Upgrade Claude Code or use `--no-team` to always use legacy.

**No messages received from executor (executor crashed)**

If an executor completes (all Task() calls finish) but never sent a `SendMessage`, the orchestrator reads `SUMMARY.md` as an implicit result. This is the same as legacy behavior — backward compatible.

**Stale team session showing in `/tw:status`**

Team sessions older than 2 hours are automatically considered stale and hidden from the status display. To clear one manually:
```bash
echo '{"cleared":true}' > .threadwork/state/team-session.json
```

**Executor stuck in BLOCKED loop**

The orchestrator retries up to 3 times with recovery guidance. If the plan is still blocked, it's marked FAILED in `execution-log.json` and the wave continues with remaining plans. You can re-run just the failed plan next session:
```
/tw:execute-phase 2 --plan PLAN-2-3
```

---

## 18. Cost & Model Tier Management

### Cost Budget

v0.3.0 adds a cost budget that runs alongside the existing token budget. Both are tracked simultaneously and surfaced via `/tw:budget`.

**How it works:**
1. `recordUsage(tokens, model)` is called after each tool call
2. `calculateCost(tokens, model)` applies a 60/40 input/output split against rates in `~/.threadwork/pricing.json`
3. Cost accumulates in `sessionCostUsed` in `token-log.json`
4. When cost exceeds `cost_budget` in `project.json`, the same threshold warnings apply as for tokens (80% warning, 90% critical)

**Pricing file (`~/.threadwork/pricing.json`):**

This is a global file shared across all projects. Edit it to reflect current Anthropic pricing if rates change:

```json
{
  "haiku":  { "input_per_million": 0.80,  "output_per_million": 4.00 },
  "sonnet": { "input_per_million": 3.00,  "output_per_million": 15.00 },
  "opus":   { "input_per_million": 15.00, "output_per_million": 75.00 }
}
```

The file is created at init and never overwritten by updates or migrations.

**Commands:**
- `/tw:budget` — dual dashboard: token line + cost line side by side
- `/tw:cost` — cost-only view broken down by model tier (Haiku / Sonnet / Opus) with projected session-end cost
- `/tw:cost history` — cost across all committed session-summary files

### Model Tier Defaults

Each agent has a default model tier:

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

### Switch Policies

When task complexity (file count, architectural keywords) suggests a tier upgrade, the model switcher fires. The behavior is governed by `model_switch_policy`:

| Policy | Behavior |
|--------|----------|
| `auto` | Switch silently, log to `model-switch-log.json` |
| `notify` | Show 10-second countdown: "Upgrading tw-executor to Opus. Cancel? (10s)" |
| `approve` | Explicit y/n prompt required before each switch |

Set at `threadwork init` (question 9) or change anytime mid-session:

```
/tw:model policy notify
/tw:model policy auto
/tw:model policy approve
```

### Reading the /tw:model Dashboard

`/tw:model` shows:
- Current model assignments per agent
- Active switch policy
- Session switch log: which agent switched, from which tier to which, and why

### Switch Log in Handoffs

The switch log is included in handoff Section 6 so you can audit model tier decisions across sessions. The log file itself (`.threadwork/state/model-switch-log.json`) is excluded from git.

---

## 19. Blueprint Evolution

### What Blueprint Drift Is

Blueprint drift occurs when your project requirements change after implementation has begun. Without a structured process, mid-project blueprint changes often result in:
- Ad-hoc patches to in-progress plans
- Inconsistent understanding between sessions
- Uncounted scope increases

v0.3.0 provides two commands to handle blueprint changes as structured decisions.

### /tw:blueprint-lock — Establishing a Baseline

Before making significant edits to your blueprint or PRD, snapshot the current state:

```
/tw:blueprint-lock
/tw:blueprint-lock "baseline before adding multi-tenant support"
/tw:blueprint-lock --file docs/blueprint.md
```

This stores a versioned snapshot at `.threadwork/state/blueprint-vN.md` (committed to git). Without a baseline, `/tw:blueprint-diff` cannot produce a meaningful comparison.

**When to lock:**
- Before any substantial blueprint edit
- At the start of each milestone as a baseline for that milestone
- After a scope negotiation that you want to record

### /tw:blueprint-diff — Analyzing Changes

After editing your blueprint, run:

```
/tw:blueprint-diff docs/blueprint-updated.md
```

Or for mid-project analysis that only looks at remaining phases:

```
/tw:blueprint-diff --since-phase 3 docs/blueprint-updated.md
```

Changes are categorized at the section level:

| Category | Description |
|----------|-------------|
| **ADDITIVE** | New sections or requirements with no conflicts to existing work |
| **MODIFICATIONS** | Changes to existing sections that may affect in-progress phases |
| **STRUCTURAL** | Fundamental scope, architecture, or technology changes |

For each category, three migration paths are presented with token cost estimates:

| Option | Description |
|--------|-------------|
| **Restart** | Restart the affected phase(s) with the updated blueprint |
| **In-place patch** | Amend the current plan XML and re-execute affected tasks |
| **Phased adoption** | Continue current phase with the old blueprint; adopt changes in the next phase |

A recommendation is generated at:
- **15% scope change** — suggests phased adoption or in-place patch
- **40% scope change** — strongly recommends restart

### Blueprint Migration Decision File

Your choice is written to `.threadwork/state/blueprint-migration.json` (excluded from git). This file does not trigger any implementation — it records the decision for your next session to act on.

---

---

## 20. Design Reference System

**New in v0.3.2.** Design references make visual design files first-class inputs to the AI coding workflow. Agents read your mockups, wireframes, and HTML prototypes before implementing UI tasks — and `tw-reviewer` checks the output against the design before quality gates run.

### 20.1 The Problem It Solves

Before v0.3.2, agents implemented UI components from text descriptions alone. Designs lived in Figma, mockup folders, or the designer's head — the coding agent never saw them. This caused frontend implementations to drift from the intended visual design, requiring manual review cycles to catch layout and styling gaps.

Design references give the agent the same artifact the designer produced.

### 20.2 Supported File Formats

| Format | Extensions | How agents use it |
|--------|-----------|-------------------|
| **Image** | `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.avif`, `.bmp` | Agent uses the Read tool to view the file visually (Claude is multimodal — it sees the image) |
| **HTML / CSS** | `.html`, `.htm`, `.css` | First 200 lines are inlined into the prompt; the full path is provided for the remainder |
| **SVG** | `.svg` | Full content is inlined if under 500 lines; otherwise the file path is provided |

Design files can live anywhere in the project. The convention is `designs/`, `mockups/`, or co-located next to component directories. Threadwork never copies or moves them — it only stores pointers in spec frontmatter.

### 20.3 Adding Design References to a Spec

Design references are declared in the `design_refs` array in any spec's YAML frontmatter. Existing specs without `design_refs` continue to work unchanged.

```yaml
---
specId: SPEC:fe-login-001
name: Login Page Design
domain: frontend
tags: [ui, auth, login]
design_refs:
  - path: designs/login-desktop.png
    label: Login page — desktop layout
    scope: src/app/login/**
    fidelity: exact
  - path: designs/login-mobile.png
    label: Login page — mobile breakpoint
    scope: src/app/login/**
    fidelity: structural
  - path: designs/login-prototype.html
    label: Interactive HTML prototype with final CSS
    scope: src/app/login/**
    fidelity: exact
---

# Login Page Design Spec

The login page uses a centered card layout...
```

**Field reference:**

| Field | Required | Description |
|-------|----------|-------------|
| `path` | Yes | Path to the design file, relative to the project root |
| `label` | Yes | Human-readable description shown in the agent's context block |
| `scope` | Yes | Glob pattern matching the source files this design applies to (e.g. `src/app/login/**`) |
| `fidelity` | No | Implementation expectation — see section 20.4. Default: `structural` |

### 20.4 Fidelity Levels

Fidelity tells the agent and reviewer how closely the implementation must match the design file.

| Fidelity | Meaning | Reviewer checks |
|----------|---------|-----------------|
| `exact` | Pixel-perfect match — layout, spacing, colors, fonts, and all visual elements must match the design exactly | Layout, colors, fonts, all elements present, responsive behavior at breakpoints, no visual regressions |
| `structural` | Same layout hierarchy and visual structure, but styling details may adapt to the project's design system | Overall layout structure, all required sections/components present, visual hierarchy preserved, functional flow matches prototype intent |
| `reference` | Inspired by the design — the agent uses it as guidance, not a strict specification | Key design concepts reflected, implementation serves the same user goals, no major structural divergences |

When in doubt, use `structural`. Use `exact` only for designs produced by a designer that represent the final approved look.

### 20.5 Capturing Design References During Discuss Phase

`/tw:discuss-phase` (question 11 and 12) is the natural place to register design files for a phase before planning begins.

```
/tw:discuss-phase 1
```

The discuss phase asks:

- **Question 11** — Do you have mockups, wireframes, or design files for this phase? (provide image paths, HTML prototype paths, or Figma export paths)
- **Question 12** — What fidelity level is required? (`exact` / `structural` / `reference`)

Answers are written to `.threadwork/state/phases/phase-N/CONTEXT.md` under `## Design References`. The planner reads this context when generating task XML and adds `<design-refs>` elements to tasks that touch matching source files.

You can also skip the discuss phase and add `design_refs` directly to spec frontmatter at any time.

### 20.6 How Design References Flow Through the System

```
Spec frontmatter (design_refs)
        │
        ▼
Routing map (pre-tool-use hook)
  ↳ 15 tokens per ref: "Use spec_fetch SPEC:fe-login-001 to load spec + design refs"
        │
        ▼ (when executor fetches the spec)
Design injection block appended to prompt
  ↳ Images: "Read this file path with the Read tool before implementing"
  ↳ HTML:   First 200 lines inlined + full path for remainder
  ↳ SVG:    Full content inlined (if < 500 lines) or path
        │
        ▼
tw-reviewer (after executor completes)
  ↳ Design fidelity check added as review criterion 6
  ↳ Fidelity-appropriate checklist generated from buildDesignReviewBlock()
        │
        ▼
Doc-freshness gate
  ↳ Dead design reference check: if a design file is deleted but still
    referenced in a spec, the gate reports a blocking error
```

### 20.7 Starter Spec Template

Threadwork installs a design reference spec template at:

```
.threadwork/specs/frontend/design-ref.md
```

Use it as a starting point when creating a spec for a new UI component:

```yaml
---
specId: SPEC:fe-component-design
name: Component Design Reference
domain: frontend
tags: [ui, design]
design_refs:
  - path: designs/component-name.png
    label: Component — desktop layout
    scope: src/components/ComponentName/**
    fidelity: structural
---

# Component Design Reference

Describe layout intent, interaction model, and any implementation notes here.
```

### 20.8 Managing Design References

There is no dedicated command for design refs — they are managed as part of normal spec management:

```
/tw:specs show frontend/login-page     # view a spec including its design_refs
/tw:specs edit frontend/login-page     # edit spec frontmatter to add/change refs
/tw:specs add                          # create a new design ref spec interactively
/tw:docs-health                        # check for missing or stale design files
```

`/tw:docs-health` runs the doc-freshness gate and will report any design files listed in specs that no longer exist on disk. Fix these by either restoring the file or removing the `design_refs` entry from the spec.

### 20.9 Tips

- **Keep design files in the repository.** Design refs use file paths — if the file is only on one machine, agents on other machines (or CI) cannot read it. Commit your `designs/` folder.
- **Use `scope` precisely.** A ref without a scope applies to every task in the phase, which wastes tokens. Set `scope` to the directory or glob that matches the component's source files.
- **Prefer `structural` for most UI work.** Use `exact` only when a designer has signed off on pixel-level fidelity as a requirement.
- **HTML prototypes inject more context than images.** If you have an HTML/CSS prototype, prefer it over a screenshot — the agent can read class names, color values, and spacing directly from the markup.
- **One spec per major UI area.** Group related components into one spec rather than creating one spec per component — it keeps the routing map compact.

---

## 21. Self-Evolution: Knowledge Harvest

**New in v0.3.3.** Threadwork learns from your projects and applies that knowledge to future ones. Every project makes the framework smarter.

### 21.1 The Evolution Loop

```
Project A completes → /tw:done harvests knowledge → proposals written to Threadwork repo
        ↓
/tw:harvest review → human approves/rejects → learned specs committed to repo
        ↓
Project B starts → threadwork init → seeds from core/ + stack-matched learned/
        ↓
Project B starts smarter, with patterns from Project A
```

### 21.2 What Gets Harvested

At `/tw:done`, the harvest engine (`lib/harvest.js`) extracts knowledge from 5 sources:

| Source | What It Extracts | Example |
|--------|-----------------|---------|
| Plan decisions | `<decision>` blocks from PLAN XML | "Used RS256 over HS256 for external token verification" |
| Ralph Loop log | Anti-patterns that caused failures | "Missing input validation on POST handler" |
| Knowledge notes | Critical discoveries (2+ session survival) | "Prisma $transaction silently succeeds without await" |
| Proven rules | Spec enforcement rules that caught violations | `grep_must_not_exist: console.log in src/**` |
| Diverged specs | Project specs that evolved beyond core | New rules added during the project |

Proposals are written to `templates/specs/proposals/` in the Threadwork repository.

### 21.3 Reviewing Proposals

Run `/tw:harvest review` from the **Threadwork repository root** (not a project directory):

```
/tw:harvest review     # interactive review — walk through each proposal
/tw:harvest list       # list pending proposals without acting
/tw:harvest stats      # library statistics and contributing projects
```

For each proposal, you can:
- **Approve** — move to `templates/specs/learned/{domain}/`, commit to repo
- **Reject** — delete (optionally record reason to suppress similar future proposals)
- **Edit** — modify content, then approve
- **Skip** — leave for later

Approved proposals are committed to the Threadwork repo:
```
git add templates/specs/learned/ templates/specs/proposals/
git commit -m "learn: 3 patterns from my-saas-app, analytics-api"
```

### 21.4 How Learned Specs Seed New Projects

When `threadwork init` runs in a new project:

1. **Always copies** `templates/specs/core/` — the curated baseline (API design, auth, DB schema, testing)
2. **Filters** `templates/specs/learned/` by tech stack match:
   - Reads the user's tech stack answer (Q2)
   - Matches spec tags against stack keywords (e.g., Next.js → `[typescript, nextjs, react, prisma]`)
   - Copies matching learned specs to `.threadwork/specs/learned/`
3. **Logs** which specs were seeded, for later harvest diffing

A Next.js project gets TypeScript-tagged patterns. A Django project gets Python-tagged patterns. Universal patterns (no stack tags) seed into all projects.

### 21.5 Provenance Tracking

Every learned spec tracks where it came from:

```yaml
provenance:
  - project: "my-saas-app"
    date: 2026-04-10
    source: knowledge-note
    noteId: KN-1712882400000
  - project: "analytics-api"
    date: 2026-04-15
    source: ralph-loop
    evidence: "Missing Zod validation on 3 endpoints"
```

Confidence increases each time a different project validates the same pattern. Multi-project validation is the strongest signal.

### 21.6 Directory Structure

```
templates/specs/                 (in Threadwork repo)
├── core/                        curated baseline — always seeded
│   ├── backend/                 api-design, auth, db-schema, ts-patterns, python-patterns
│   ├── frontend/                react-patterns, styling, design-ref-example
│   ├── testing/                 testing-standards
│   └── enforcement/             example-rules
├── learned/                     project-harvested — grows over time
│   ├── patterns/                implementation patterns
│   ├── anti-patterns/           mistakes caught by Ralph Loop
│   ├── architecture/            stack/structure decisions
│   └── index.json               machine-readable catalog
└── proposals/                   pending human review
```

### 21.7 Tips

- **Review proposals regularly.** Run `/tw:harvest review` after finishing a project. Fresh context makes approval/rejection decisions easier.
- **Push learned specs.** `git push` after approving proposals so teammates get the knowledge too.
- **Confidence matters.** Proposals at 0.7+ are high-confidence (multi-session survival or critical knowledge notes). Proposals at 0.3 are from single Ralph Loop failures — scrutinize these more carefully.
- **Reject with reasons.** A rejection reason suppresses similar future proposals, keeping the review queue clean.
- **Check stats.** `/tw:harvest stats` shows which projects contribute the most — useful for understanding where your framework knowledge is growing.

---

## 22. Activity Log & Debugging

Threadwork writes structured log entries throughout every session — hook events, quality gate results, spec fetches, token warnings, and error traces. The activity log makes these visible without reading raw JSONL files.

### 22.1 Log Sources

Two files are merged into a single view:

| File | Written by | Contains |
|------|-----------|---------|
| `.threadwork/state/hook-log.json` | `session-start.js`, `pre-tool-use.js`, `post-tool-use.js`, `subagent-stop.js` | Hook lifecycle events, gate results, token warnings, model switches |
| `.threadwork/logs/threadwork.log` | `lib/logger.js` (used by quality-gate, spec-engine, harvest) | Structured module traces at DEBUG/INFO/WARN/ERROR levels |

Both files use the same JSONL format (one JSON object per line), sorted by `timestamp` when merged.

### 22.2 Log Levels

| Level | When it appears |
|-------|----------------|
| `ERROR` | Hook crash, uncaught exception, quality gate max retries exceeded |
| `WARN` | Token budget >80%, model switch recommended, gate failure (retrying), autonomous skip-and-log |
| `INFO` | Normal hook events: session start, spec injection, gate pass, tool call timing, knowledge note capture |
| `DEBUG` | Verbose traces from lib/ modules (off by default — use `--level debug` to see) |

### 22.3 What Gets Captured

**Every tool call** (`post-tool-use`):
```
2026-04-15 10:23:47  INFO   post-tool-use       Write | 312 tokens | 43ms
```

**Quality gate results** (`subagent-stop`):
```
2026-04-15 10:23:51  WARN   subagent-stop       gates FAILED (retry 1/5) | classification=knowledge_gap | violation="Missing Zod validation on POST handler"
2026-04-15 10:24:18  INFO   subagent-stop       gates PASSED | tier=advanced | autonomy=supervised
```

**Token budget warnings** (`post-tool-use`):
```
2026-04-15 10:25:00  WARN   post-tool-use       Token budget warning: 340K used
```

**Model switches** (`pre-tool-use`):
```
2026-04-15 10:23:40  INFO   pre-tool-use        model switch sonnet → opus for tw-planner [7-dim score=72 (high, conf=85%)]
```

**Spec and knowledge events** (`pre-tool-use`, `session-start`):
```
2026-04-15 10:23:39  INFO   pre-tool-use        spec_fetch SPEC:be-001 | 420 tokens
2026-04-15 10:23:38  INFO   session-start       injected 1240 bytes | tier=advanced | checkpoint=false
```

**What is NOT captured:** The content of AI conversational messages (prompts and responses) — hooks only observe tool calls and their inputs/outputs, not the text Claude sends or receives. To evaluate AI output quality, use gate pass/fail rates and the `primary_violation` field on WARN entries.

### 22.4 CLI Reference

```bash
# Quick triage — last 20 WARN and ERROR entries
threadwork log --level warn

# Full recent history
threadwork log --tail 100

# Filter to the past hour
threadwork log --since 1h

# Live-tail during an active Claude Code session
threadwork log --follow

# Raw JSONL output (pipe-friendly)
threadwork log --json | jq 'select(.level == "ERROR")'

# All levels including verbose DEBUG
threadwork log --level debug --tail 200
```

### 22.5 Slash Command Reference

Inside Claude Code, use `/tw:log` (reads both log sources and formats them as a table):

```
/tw:log                    Last 20 WARN+ entries (default — quick summary)
/tw:log --level info       Last 50 INFO+ entries
/tw:log --tail 100         Last 100 entries
/tw:log --since 30m        Entries from the last 30 minutes
/tw:log --errors-only      ERROR entries only
/tw:log --level debug      All levels including DEBUG traces
```

### 22.6 Common Triage Patterns

**"Why did the Ralph Loop retry so many times?"**
```bash
threadwork log --level warn --since 1h
```
Look for `gates FAILED` entries — each one shows the `primary_violation` and `classification`.

**"Was a spec actually fetched for that task?"**
```bash
threadwork log --level info | grep spec_fetch
```

**"What model ran the last executor?"**
```bash
threadwork log --level info | grep "model switch\|model confirmed"
```

**"Did session-start inject cleanly?"**
```bash
threadwork log --level info | grep session-start
```

### 22.7 Log File Management

Log files are append-only and can grow large across many sessions. They are excluded from git by the `.gitignore` block written at `threadwork init`. To clear them:

```bash
# Clear lib/ module log (hooks log is preserved)
> .threadwork/logs/threadwork.log

# Clear hook log (loses Ralph Loop history)
> .threadwork/state/hook-log.json
```

There is no built-in rotation — if the files grow too large, clear them manually between sessions.

*Threadwork is MIT licensed. Issues and PRs welcome at [github.com/nexora/threadwork](https://github.com/nexora/threadwork).*
