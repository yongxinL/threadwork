---
name: tw:done
description: End the session — generate a 10-section handoff document and print the resume prompt
argument-hint: ""
allowed-tools: [Read, Write, Bash]
---

## Preconditions
- `.threadwork/state/project.json` must exist.

## Action

Generate a complete session handoff. This command should be run at the end of every coding session.

### Steps:

1. **Read session state**:
   - `.threadwork/state/project.json` — project name, phase, milestone, skill tier
   - `.threadwork/state/active-task.json` — currently active task
   - `.threadwork/state/completed-tasks.json` — tasks completed this session
   - `.threadwork/state/token-log.json` — token usage
   - `.threadwork/state/ralph-state.json` — quality gate status
   - Run `git log --oneline -5` for recent commits
   - Run `git status --short` for uncommitted files
   - Run `git rev-parse HEAD` for current SHA

2. **Prompt user for**:
   - Key decisions made this session (ask: "Any architectural or design decisions to record? List them, or press Enter to skip")
   - In-progress task completion % (if applicable)

3. **Generate handoff** at `.threadwork/workspace/handoffs/YYYY-MM-DD-N.md` with all 10 sections:
   1. Session Overview (date, duration estimate, phase/milestone)
   2. Completed This Session (task IDs + one-line descriptions)
   3. In Progress (active task + % if provided)
   4. Key Decisions Made
   5. Files Modified (from git diff since session start)
   6. Token Usage (used/budget/% + per-task table)
   7. Git State (branch, last SHA, uncommitted count)
   8. Quality Gate Status (last Ralph Loop result)
   9. Recommended Next Action (single sentence)
   10. Resume Prompt (self-contained block — see format below)

4. **Write checkpoint** to `.threadwork/state/checkpoint.json`

5. **Harvest knowledge** (self-evolution step):
   Run the harvest engine to extract reusable knowledge from this project:
   - Read plan decisions (`<decision>` blocks from PLAN XML files)
   - Read Ralph Loop remediation log (anti-patterns that caused failures)
   - Read critical knowledge notes (discoveries that survived 2+ sessions)
   - Compare project specs against core specs for divergence (new rules, new patterns)
   - Write proposals to the Threadwork repo at `templates/specs/proposals/`

   Display summary:
   ```
   ── Knowledge Harvest ────────────────────────────
   Extracted: <N> proposals
     Decisions:      <n1>
     Anti-patterns:  <n2>
     Knowledge notes: <n3>
     Proven rules:   <n4>
     Diverged specs: <n5>
   Written to: <threadwork-repo>/templates/specs/proposals/
   Review with: /tw:harvest review (from Threadwork repo)
   ────────────────────────────────────────────────
   ```

   If no proposals were extracted, display: "No new patterns to harvest from this session."
   If the Threadwork repo path cannot be resolved, skip silently with a note: "Harvest skipped — Threadwork repo not found."

6. **Print the resume prompt** to the terminal:
```
── THREADWORK RESUME ──────────────────────────────
Project: <name> | Phase: <N> | Milestone: <M>
Last session: <date> | Branch: <branch>
Completed: <T-IDs comma-separated>
In progress: <task ID + description>
Next action: <recommended next action>
Token budget remaining: <N>K / <total>K
Skill tier: <tier>
─────────────────────────────────────────────────
Continue from where we left off. Load checkpoint
and resume task <ID>.
```

7. **Final message**:
   - Advanced/Ninja: "Session saved. Handoff at `.threadwork/workspace/handoffs/<filename>`. Paste the resume prompt above in your next session."
   - Beginner: More detailed explanation of what was saved and how to use it next time.

## Error Handling
- If git not available: skip git sections, note "git unavailable"
- If no tasks completed: section 2 reads "No tasks completed this session"
