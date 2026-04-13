---
name: tw:execute-phase
description: Execute all plans for a phase using parallel wave execution with spec injection and Ralph Loop quality gates
argument-hint: "<phase-number> [--wave <N>] [--plan <ID>] [--team] [--no-team] [--max-workers <N>] [--yolo]"
allowed-tools: [Read, Write, Edit, Bash, Task, TeamCreate, SendMessage, TodoWrite, TaskCreate, TaskList, TaskUpdate]
---

## Preconditions
- Phase number N must be provided.
- Plan files must exist at `.threadwork/state/phases/phase-N/plans/PLAN-N-*.xml`
- Run `/tw:plan-phase N` first if plans don't exist.

## Action

### Step 1: Pre-execution budget check
Read token budget from `.threadwork/state/token-log.json`.
If budget < 20% remaining:
- Advanced: "⚠️ Token budget below 20%. This phase may not complete in this session. Continue? (yes/no)"
- Ninja: "⚠️ Budget < 20%. Continue? (yes/no)"
- Beginner: Full explanation of what this means and why it matters.

### Step 2: Load plans and determine execution mode

1. Read all plan XMLs from `.threadwork/state/phases/phase-N/plans/`
2. Read `.threadwork/state/phases/phase-N/deps.json`
3. Topologically sort plans into parallel waves

**Determine execution mode** (apply before displaying wave structure):
```
--no-team flag → LEGACY for all waves (always wins)
--team flag    → TEAM for all waves (subject to 10% budget floor)
teamMode=legacy (project.json) → LEGACY
teamMode=team  (project.json) → TEAM (subject to 10% budget floor)
teamMode=auto  (project.json) → AUTO: decide per wave (see Step 3T.0)
```

4. Display wave structure with chosen mode.
   For each plan, read its `<complexity model="...">` field from the plan XML — fall back to `sonnet` if absent.
```
Phase N Execution Plan:
  Mode: Team (bidirectional)   ← or Legacy / Auto (decides per wave)
  Wave 1 (parallel): PLAN-N-1 [haiku], PLAN-N-2 [sonnet], PLAN-N-3 [haiku]
  Wave 2 (parallel): PLAN-N-4 [opus], PLAN-N-5 [sonnet]
  Wave 3 (sequential): PLAN-N-6 [sonnet]
Total: 6 plans, N tasks
```

If `--wave <W>` provided: execute only wave W.
If `--plan <ID>` provided: execute only that plan.

### Step 3L: Execute each wave — LEGACY mode
*(Used when mode = LEGACY, or AUTO decided LEGACY for this wave)*

For each wave:
1. Show token budget before starting
2. Print a spawn line for each plan showing model (from `<complexity model="...">` in plan XML, else `sonnet`):
   `  → Spawning PLAN-N-1 [haiku] ...`
3. Spawn `tw-executor` agents in parallel via Task() for each plan in the wave
4. Each executor receives: PLAN XML, tech stack context (from project.json), relevant specs (auto-injected), git branch info
5. Wait for all plans in wave to complete before proceeding
6. After wave completion: read SUMMARY.md files, verify commits with `git log --oneline -5`

### Step 3T: Execute each wave — TEAM mode
*(Used when mode = TEAM, or AUTO decided TEAM for this wave)*

**3T.0 Auto-decision (AUTO mode only — run before each wave):**
```
planCount        = number of plans in this wave
waveBudgetEst    = sum of <token-estimate> from all wave plan XMLs
remainingBudget  = sessionBudget - sessionUsed  (from token-log.json)
sessionBudget    = from token-log.json
tier             = skillTier from project.json
tierMaxWorkers   = ninja→5, advanced→3, beginner→2
userMaxWorkers   = --max-workers flag OR project.json maxWorkers OR tierMaxWorkers
effectiveWorkers = min(planCount, userMaxWorkers)

Use TEAM for this wave if ALL of:
  planCount >= 2
  remainingBudget >= sessionBudget × 0.30
  waveBudgetEst <= remainingBudget × 0.50
Otherwise: fall back to LEGACY for this wave
```

Announce the decision inline (include per-plan model from `<complexity model="...">`):
```
Wave 1: 3 plans — Team mode  (budget: 420K/800K remaining, est: 95K, workers: 3)
  PLAN-N-1 [haiku]  PLAN-N-2 [sonnet]  PLAN-N-3 [haiku]
Wave 2: 1 plan  — Legacy mode (single plan, team overhead not worth it)
  PLAN-N-4 [opus]
```

**3T.1 Calculate per-worker budget:**
```
workerBudget = floor(remainingBudget × 0.6 / effectiveWorkers)
               minimum: 50,000 (never starve a worker)
```

**3T.2 Create team:**
```
TeamCreate(
  team_name="tw-phase-<N>-<waveIdx>-<timestamp-last-8-digits>",
  description="Phase <N> Wave <W>: <comma-separated plan IDs>"
)
```
Write `.threadwork/state/team-session.json`:
```json
{
  "teamName": "tw-phase-N-W-<ts>",
  "phase": N, "waveIndex": W,
  "mode": "execute-phase",
  "leadName": "tw-orchestrator",
  "workerNames": ["tw-executor-plan-n-1", ...],
  "workerBudget": <N>,
  "activePlans": ["PLAN-N-1", ...],
  "completedPlans": [], "failedPlans": [],
  "workerTasks": {},
  "workerLastSeen": {},
  "startedAt": "<ISO>", "status": "active"
}
```
`workerTasks` maps worker name → team task ID (populated in step 3T.3b).
`workerLastSeen` maps worker name → ISO timestamp of last received message (updated on every message in 3T.4).

**3T.3 Spawn workers in parallel** (up to `effectiveWorkers` at once):
For each plan in the wave:
```
Task(
  subagent_type="tw-executor",
  team_name="tw-phase-<N>-<W>-<ts>",
  name="tw-executor-plan-<n>-<m>",
  prompt="[TEAM: name=tw-phase-<N>-<W>-<ts> lead=tw-orchestrator planId=PLAN-N-M workerBudget=<B>]

<plan XML content>
Tech stack: <from project.json>
Branch: <git branch>"
)
```
If `effectiveWorkers < planCount`: queue remaining plans for a sub-wave after current completes.

**3T.3b Register worker tasks in Claude Code task list:**
Immediately after spawning all workers, create a task in the team task list for each plan so progress is visible in the UI:
```
TaskCreate(
  content="PLAN-N-M: <title from plan XML>",
  activeForm="Executing PLAN-N-M"
)
```
Store the returned task ID in `team-session.json` under `workerTasks: { "tw-executor-plan-n-m": <taskId> }`.

**3T.3c Verify workers joined (startup confirmation):**
After spawning all workers, wait for a `STARTED planId=<P>` message from each worker (timeout: **3 minutes per worker**).

- When `STARTED` is received from a worker:
  - Update `workerLastSeen[workerName]` in `team-session.json` to now
  - Update the corresponding team task status to `in_progress` via `TaskUpdate`
  - Print: `  ✓ Worker tw-executor-plan-n-m confirmed alive`
- If a worker does NOT send `STARTED` within 3 minutes:
  - Print warning: `  ⚠️ Worker tw-executor-plan-n-m did not confirm — may not have started`
  - Check `~/.claude/teams/<teamName>/config.json`: if the worker is absent from `members`, it failed to join
  - Decision: if more than half the wave workers failed to confirm, fall back to LEGACY mode for this wave (re-run with `Step 3L`). Otherwise continue, marking the silent worker as potentially at-risk.

**3T.4 Wait for SendMessage events** — track per plan with timeout detection:

Maintain `lastHeartbeat` tracking: whenever **any** message is received from a worker (`STARTED`, `HEARTBEAT`, `DONE`, `BLOCKED`, `BUDGET_LOW`), update `workerLastSeen[workerName]` in `team-session.json`.

Handle incoming messages:
- `STARTED planId=<P> worker=<name>` → record worker confirmed, update `workerLastSeen`
- `HEARTBEAT planId=<P> taskId=<T> completed=<N>/<total>` → update `workerLastSeen`, print progress line:
  `  → PLAN-N-M: task T complete (<N>/<total>)`
- `DONE planId=<P> tasks=<N> sha=<sha>` → mark plan complete, update `completedPlans` in team-session.json, `TaskUpdate` the team task to `completed`, read SUMMARY.md
- `BLOCKED planId=<P> taskId=<T> reason=<R>` → attempt recovery:
  - Send up to 3 `SendMessage` replies with guidance to unblock
  - If still BLOCKED after 3 attempts: mark plan as FAILED in team-session.json, `TaskUpdate` to reflect failure
- `BUDGET_LOW planId=<P> remaining=<tasks>` → mark plan as partial, note in execution log

**Timeout detection loop** — while waiting, periodically check stale workers:

Every time a message is processed, scan `workerLastSeen` for any worker not yet in a terminal state whose last message was more than **15 minutes** ago:

```
staleWorkers = workers where (now - workerLastSeen[w] > 15min) AND planId not in completedPlans AND planId not in failedPlans
```

For each stale worker:
1. Check the team task list via `TaskList` — if the worker's task is still `pending` they likely never started; if `in_progress` they may be on a long-running subtask
2. Send a ping: `SendMessage(type="message", recipient="<workerName>", content="PING planId=<P> — are you still running?", summary="Health check")`
3. Wait 5 minutes for any response. If still silent at **20 minutes** total:
   - Mark plan as FAILED with reason `"worker_timeout"`
   - `TaskUpdate` the team task to reflect the timeout
   - Print: `  ✗ Worker <name> timed out after 20 min — marking PLAN-N-M as FAILED`

Wave is complete when all plans have a terminal status (DONE / FAILED / partial).

*Note: Also wait for all Task() completions — the orchestrator advances only after all workers have actually exited (verified by SubagentStop hook firing and quality gates passing).*

**3T.5 Shutdown after wave:**
1. Send `shutdown_request` to all remaining active workers
2. Update `team-session.json` status to `"completed"`
3. Write `{ cleared: true }` to team-session.json
4. Display wave result table (include the model each plan ran with):
```
Wave 1 results:
  PLAN-N-1 [haiku]:  DONE   (4 tasks, 3 commits)
  PLAN-N-2 [sonnet]: DONE   (3 tasks, 2 commits)
  PLAN-N-3 [haiku]:  FAILED (blocked on T-N-3-2: missing auth type export)
```

**3T.6 Sub-wave for deferred plans** (when max-workers < planCount):
After current wave completes, run deferred plans as a new team (repeat 3T.1–3T.5).

### Step 4: Budget check between waves
After each wave, check token budget.
If budget crosses 80%: show warning.
If budget crosses 90%: "🚨 Budget critical. Consider running /tw:done and continuing next session."
If `--yolo` flag set: skip all interactive checkpoints, auto-continue.

### Step 5: Write execution log
Write `.threadwork/state/phases/phase-N/execution-log.json` with:
- Wave execution times
- Plan completion status
- Any errors encountered
- `teamMode`: `true` / `false` for each wave
- `teamName`, `workerBudget`, `effectiveWorkers` (if team mode was used)

## Error Handling
- Plan file missing: "Plan <ID> not found. Run /tw:plan-phase N to regenerate plans."
- Executor fails after Ralph Loop max retries: Show escalation message, mark plan as FAILED in execution log.
- `TeamCreate` fails: Fall back to LEGACY mode for that wave. Log warning: "TeamCreate failed, falling back to legacy wave execution."
- No SendMessage received after all Task() completions: Read SUMMARY.md as implicit result (backward-compatible fallback).
- Budget drops below 10% mid-wave: Send shutdown_requests to all active workers, write partial execution log, stop phase and prompt user to resume next session.
