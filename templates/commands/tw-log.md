---
name: tw:log
description: View Threadwork activity logs — errors, warnings, quality gate results, and hook events
argument-hint: "[--level debug|info|warn|error] [--tail N] [--since 1h|30m] [--errors-only]"
allowed-tools: [Read, Bash]
---

## Action

Display recent Threadwork log entries from the current project's log files.

### Sources

Two log files are merged and displayed together:
- `.threadwork/state/hook-log.json` — written by hooks (session-start, pre-tool-use, post-tool-use, subagent-stop)
- `.threadwork/logs/threadwork.log` — written by lib/ modules (quality-gate, spec-engine, harvest)

### Steps

1. **Parse arguments** from `$ARGUMENTS`:
   - `--level debug|info|warn|error` — minimum level to show (default: `info`)
   - `--tail N` — show last N entries (default: 50)
   - `--since 1h|30m` — filter to recent timeframe
   - `--errors-only` — shorthand for `--level error`
   - No arguments → show last 20 WARN+ entries (quick summary view)

2. **Read log files**:
   - Read `.threadwork/state/hook-log.json` (JSONL — one JSON object per line)
   - Read `.threadwork/logs/threadwork.log` if it exists (JSONL, same format)
   - If neither file exists, report: "No logs found. Run a session first."

3. **Merge and filter**:
   - Combine all entries from both files
   - Sort by `timestamp` field ascending
   - Apply level filter (DEBUG=0, INFO=1, WARN=2, ERROR=3)
   - Apply `--since` filter if provided
   - Take last N entries per `--tail`

4. **Display**:
   - Format as a readable table — one entry per line:
     ```
     TIMESTAMP            LEVEL  SOURCE              MESSAGE
     2026-04-15 10:23:45  INFO   session-start       session-start injected 888 bytes | tier=beginner
     2026-04-15 10:23:46  WARN   post-tool-use       Token budget at 80%+: 640K used
     2026-04-15 10:23:47  ERROR  subagent-stop       gates FAILED (retry 1/5) | violation="no console.log"
     ```
   - Group consecutive INFO entries if there are >10 in a row (show count: "(8 INFO events omitted)")
   - Always show all WARN and ERROR entries — never suppress them
   - If `meta` field present on an entry, show it indented below the main line

5. **Summary line** at the end:
   ```
   ── Log Summary ────────────────────────────────────────
   Total entries shown: N  |  ERROR: X  |  WARN: Y  |  INFO: Z
   Log files: .threadwork/state/hook-log.json, .threadwork/logs/threadwork.log
   CLI: threadwork log --level warn --follow
   ──────────────────────────────────────────────────────
   ```

### Error Handling

- If `.threadwork/` does not exist: "Threadwork is not initialized. Run `threadwork init` first."
- If log files are empty: "No log entries found. Logs are written when hooks execute during a Claude Code session."
- If a JSONL line is malformed: skip silently (do not crash or show raw broken JSON)

### Level Reference

| Level | When it appears |
|-------|----------------|
| `ERROR` | Hook crash, uncaught exception, quality gate max retries exceeded |
| `WARN` | Token budget >80%, model switch recommended, gate failure (retrying) |
| `INFO` | Normal hook events: session start, spec injection, gate pass, token tracking |
| `DEBUG` | Verbose tracing from lib/ modules (off by default — use `--level debug`) |
