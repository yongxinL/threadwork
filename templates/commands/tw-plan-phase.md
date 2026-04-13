---
name: tw:plan-phase
description: Generate detailed XML execution plans for a phase with token estimates and phase budget preview
argument-hint: "<phase-number>"
allowed-tools: [Read, Write, Bash, Task]
---

## Preconditions
- Phase number N must be provided.
- `.threadwork/state/phases/phase-N/CONTEXT.md` must exist — run `/tw:discuss-phase N` first.
- `.threadwork/state/REQUIREMENTS.md` must exist.
- `.threadwork/state/ROADMAP.md` must exist.

## Action

### Step 1: Show token estimate for planning
"Planning Phase N will use approximately 20K–40K tokens. Proceeding..."

### Step 2: Spawn planner subagent
Spawn `tw-planner` agent with:
- `.threadwork/state/REQUIREMENTS.md` contents
- `.threadwork/state/ROADMAP.md` phase N section
- `.threadwork/state/phases/phase-N/CONTEXT.md` contents
- Relevant spec files (injected by pre-tool-use hook)
- Instruction: generate plans in the XML format below

**Required plan XML format** (include complexity in each task):
```xml
<plan id="PLAN-N-1" phase="N" milestone="M">
  <title>Descriptive plan title</title>
  <requirements>REQ-001, REQ-003</requirements>
  <tasks>
    <task id="T-N-1-1">
      <description>Specific implementation task description</description>
      <files>src/components/Auth.tsx, src/hooks/useAuth.ts</files>
      <verification>TypeScript compiles, tests pass, no lint errors</verification>
      <done-condition>Auth flow completes end-to-end with valid JWT</done-condition>
      <token-estimate>12000</token-estimate>
    </task>
  </tasks>
  <dependencies>PLAN-N-2 depends on PLAN-N-1</dependencies>
</plan>
```

**For each task, also score and record complexity (7 dimensions):**
Use the complexity assessor to score each task across:
1. **Scope** — how many files touched (1-2→1, 3-10→2, 10+→3)
2. **Integration** — external dependencies (none→1, 1-2→2, 3+→3)
3. **Infrastructure** — infra changes needed (none→1, config→2, new DB/infra→3)
4. **Knowledge** — domain expertise (familiar→1, research→2, deep expertise→3)
5. **Risk** — blast radius if wrong (low→1, user-facing→2, security/data→3)
6. **Testing** — test effort (minimal→1, moderate→2, extensive→3)
7. **Decomposability** — can it be split? (easily→1, partially→2, monolithic→3)

Apply multipliers: security-sensitive ×1.2, data-migration ×1.3, breaking-changes ×1.2.
Total score (after multipliers): 7-11 → SIMPLE (Haiku), 12-16 → STANDARD (Sonnet), 17-21 → COMPLEX (Opus).

**Plan XML format for complexity** (add after token-estimate):
```xml
<complexity score="14" tier="STANDARD" confidence="82" model="sonnet">
  <dimension name="scope"        score="2" rationale="4 files across 2 components" />
  <dimension name="integration"  score="1" rationale="Self-contained, no external calls" />
  <dimension name="infrastructure" score="1" rationale="Code-only change" />
  <dimension name="knowledge"    score="2" rationale="Standard auth patterns" />
  <dimension name="risk"         score="2" rationale="User-facing but reversible" />
  <dimension name="testing"      score="2" rationale="Unit + integration tests" />
  <dimension name="decomposability" score="1" rationale="Backend/frontend separable" />
  <multipliers applied="security-sensitive" adjusted="1.2x" />
  <integration-hints worktree="false" context-budget="8192" github-artifact="epic_with_sub_issues" />
</complexity>
```

### Step 3: Plan validation
Spawn `tw-plan-checker` with the generated plans.
Checker validates across 7 dimensions:
1. Requirements coverage (all phase REQ-IDs addressed)
2. File target clarity (specific filenames, not "some file")
3. Verification criteria completeness (measurable, not vague)
4. Done conditions measurability
5. Dependency graph validity (no cycles)
6. Spec compliance (plans follow loaded specs)
7. **Complexity quality — each task has a `<complexity>` element with 7-dimension scores, confidence, and model recommendation. Score must be present and confidence ≥ 50%.**

Iterate up to 3 times if quality threshold not met. Show retry count.

### Step 3b: Complexity confidence review
After validation, scan all plans for tasks with confidence < 60%.

**If any low-confidence tasks found:**
Present each to the user and ask one clarifying question:
```
⚠️ Low complexity confidence detected — please clarify:

Task: T-N-M-1 — "add JWT refresh token rotation"
Confidence: 48% — reason: "unfamiliar OAuth library"

Question: Which OAuth library are you using?
  1. Auth0 (well-documented, STANDARD tier likely sufficient)
  2. Custom OAuth server (deeper integration, COMPLEX tier)
  3. Already familiar with the library (STANDARD tier, I can research it)
```

After each answer, update the task's complexity score and adjust the plan XML.

**If all tasks confidence ≥ 60%:** Proceed to Step 4.

### Step 4: Save plans
Save to `.threadwork/state/phases/phase-N/plans/PLAN-N-*.xml`
Save dependency graph to `.threadwork/state/phases/phase-N/deps.json`

### Step 5: Phase Budget Preview
Sum all `<token-estimate>` values from the approved plans.

**Advanced tier**:
```
── Phase N Budget Preview ──────────────────────────
Plans: <M> | Tasks: <T>
Estimated tokens: ~<total>K across <T> tasks
Session budget:   <budget>K
This phase:       <pct>% of your session budget
Status: <✅ Fits in one session | ⚠️ May span 2 sessions | 🚨 Spans 3+ sessions>
────────────────────────────────────────────────────
```

**Ninja tier**: One-line: "Phase N: ~<total>K tokens | <M> plans | <pct>% of budget"

## Error Handling
- Missing CONTEXT.md: "Run /tw:discuss-phase N first to capture phase preferences."
- Plan checker fails after 3 iterations: Show the issues and ask user how to proceed.
