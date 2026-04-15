---
domain: enforcement
specId: SPEC:enf-001
name: Example Enforcement Rules
tags: [enforcement, architecture, naming]
rules:
  - type: grep_must_not_exist
    pattern: "console\\.log"
    files: "src/**/*.ts"
    message: "Use the project logger, not console.log (SPEC:enf-001)"
  - type: import_boundary
    from: "src/services/**"
    cannot_import: ["src/ui/**", "src/components/**"]
    message: "Service layer cannot import from UI layer (SPEC:enf-001)"
  - type: naming_pattern
    pattern: "^use[A-Z]"
    files: "src/hooks/**/*.ts"
    target: "export_names"
    message: "Hooks must start with 'use' prefix (SPEC:enf-001)"
  - type: file_structure
    must_exist: ["src/index.ts"]
    message: "Project must have a src/index.ts entry point (SPEC:enf-001)"
---

# Example Enforcement Rules

This is a starter template for machine-checkable enforcement rules. Copy and customize for your project.

## How to use

1. Copy this file to `.threadwork/specs/enforcement/phase-N-rules.md`
2. Update the rules for your project's architectural constraints
3. Run `/tw:docs-health` to verify the rules target real files
4. The `spec-compliance` quality gate will enforce these rules on every commit

## Rule types

- `grep_must_exist` — Pattern MUST appear in matching files
- `grep_must_not_exist` — Pattern must NOT appear in matching files
- `import_boundary` — Files in `from` cannot import from `cannot_import`
- `naming_pattern` — Exported names must match the regex
- `file_structure` — Required file patterns must exist

## Auto-generated rules

Run `/tw:discuss-phase` and answer questions Q6-Q8 to auto-generate rules from your answers.
