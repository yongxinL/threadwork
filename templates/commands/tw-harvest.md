---
name: tw:harvest
description: Review, approve, and commit learned specs harvested from projects
argument-hint: "[review | list | stats | approve <id> | reject <id>]"
allowed-tools: [Read, Write, Edit, Bash, Glob]
---

## Preconditions
- Must be run from the **Threadwork repository** root (not a project).
- `templates/specs/proposals/` and `templates/specs/learned/` must exist.

## Actions

### `review` (or no argument)

Interactive review of all pending harvest proposals. Walk through each one:

1. Read all `.md` files from `templates/specs/proposals/`
2. Sort by confidence descending (highest first)
3. For each proposal, display:

```
── Proposal 1/N ────────────────────────────────────

  Type:       [pattern | anti-pattern | decision | rule-addition | new-spec]
  Key:        prisma-transaction-gotcha
  Confidence: 0.7
  Source:     my-saas-app → knowledge note KN-171288...
  Tags:       [typescript, prisma, transactions]

  Preview:
  ┌──────────────────────────────────────────────
  │ # Prisma $transaction silently succeeds without await
  │ 
  │ **Category:** api_behavior
  │ **Evidence:** discovered during T-1-2-3 implementation
  └──────────────────────────────────────────────

  [a]pprove  [r]eject  [e]dit  [s]kip  [d]iff  [q]uit
```

4. On **approve**:
   - Move proposal to `templates/specs/learned/{domain}/`
   - If updating an existing learned spec, merge provenance arrays
   - Bump confidence to min 0.7
   - Update `templates/specs/learned/index.json`

5. On **reject**:
   - Delete the proposal
   - Optionally ask for reason (suppresses similar future proposals)
   - Record in `templates/specs/proposals/.rejected-signals.json`

6. On **edit**:
   - Show the full proposal content
   - Allow the user to modify it
   - Then approve the edited version

7. On **skip**: Move to next proposal without acting

8. After all proposals reviewed, if any were approved:
   ```
   git add templates/specs/learned/ templates/specs/proposals/
   git commit -m "learn: <N> patterns from <project names>"
   ```

### `list`

Display all pending proposals without interactive review:

```
── Pending Harvest Proposals (3) ───────────────────

  1. [pattern]      prisma-transaction-gotcha    conf: 0.7  from: my-saas-app
  2. [anti-pattern] missing-input-validation     conf: 0.5  from: analytics-api
  3. [decision]     chose-rs256-over-hs256       conf: 0.5  from: my-saas-app

── Learned Spec Library ────────────────────────────

  patterns/       2 specs
  anti-patterns/  1 spec
  architecture/   0 specs
  Total:          3 learned specs from 2 projects
```

### `stats`

Show comprehensive learned library statistics:

```
── Threadwork Knowledge Base ───────────────────────

  Learned Specs:    12
  By Domain:
    patterns:       7
    anti-patterns:  3
    architecture:   2

  Top Contributing Projects:
    my-saas-app         6 contributions
    analytics-api       4 contributions
    admin-dashboard     2 contributions

  Pending Proposals:  3
  Rejected Signals:   5

  Tag Coverage:
    typescript: 8 specs  |  python: 3 specs
    auth: 4 specs        |  testing: 2 specs
    prisma: 3 specs      |  django: 1 spec
```

### `approve <proposalId>`

Approve a specific proposal by ID (non-interactive).

### `reject <proposalId>`

Reject a specific proposal by ID. Optionally provide a reason.

## Output on completion

- Advanced: "Reviewed N proposals. M approved, K rejected. Run `git push` to share."
- Beginner: Full explanation of what was approved, where it went, and how it helps future projects.

## Error Handling
- Not in Threadwork repo: "This command must be run from the Threadwork repository root, not a project directory."
- No proposals: "No pending proposals. Run `/tw:done` from a project to harvest knowledge."
- Invalid proposal ID: "Proposal not found: <id>. Run `/tw:harvest list` to see pending proposals."
