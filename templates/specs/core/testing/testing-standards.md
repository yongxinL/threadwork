---
domain: testing
name: testing-standards
specId: SPEC:test-001
updated: 2026-04-15
confidence: 0.95
tags: [testing, unit, integration, e2e, coverage, mocks, factory, pytest, jest, vitest, test]
rules:
  - type: grep_must_not_exist
    pattern: "\\.only\\("
    files: "tests/**/*.{ts,tsx,js,jsx,py}"
    message: "Remove .only() — focused tests must not be committed (SPEC:test-001)"
---
# Testing Standards

## Testing Pyramid

| Level | Ratio | What to Test | Speed |
|-------|-------|-------------|-------|
| Unit | 70%+ | Pure functions, business logic, utilities | <10ms each |
| Integration | ~20% | API endpoints, DB queries, service interactions | <500ms each |
| E2E | ~10% | Critical user journeys only | <5s each |

## 7 Core Rules

1. **Test behavior, not implementation.** Test public interfaces. Don't test private functions or internal state.
2. **AAA pattern.** Every test: Arrange (setup) -> Act (execute) -> Assert (verify). One act per test.
3. **Mock at boundaries only.** Mock external services (DB, HTTP, queues) at their entry point. Never mock internal helpers.
4. **Test error paths explicitly.** Every function that can fail needs at least one failure test. Happy path alone is insufficient.
5. **Use factories, not fixtures.** Factories (factory_boy, fishery) create test data programmatically. Fixtures are brittle and opaque.
6. **Tests must be independent.** No shared mutable state. No execution order dependencies. Each test sets up and tears down its own data.
7. **No focused tests in commits.** `.only()`, `.skip()`, `@pytest.mark.skip` must never reach the main branch.

## Coverage Thresholds

- Statements: 80%
- Branches: 75%
- Functions: 85%

Coverage is a floor, not a ceiling. Aim for meaningful tests, not 100% coverage of trivial code.

## Test Isolation Strategies

| Strategy | When | Tradeoff |
|----------|------|----------|
| Transaction rollback | Unit/integration, single DB | Fast, clean, but no commit-side-effect testing |
| Truncation | Integration, multiple tables | Slower, but tests committed state |
| Test containers | CI, external dependencies (Redis, Postgres) | Slowest, but real infrastructure |

## Endpoint Test Coverage Matrix

For every API endpoint, test:
- Happy path (valid input, expected output)
- Auth (unauthenticated -> 401, unauthorized -> 403)
- Validation (invalid input -> 400/422 with error details)
- Not found (missing resource -> 404)
- Conflict (duplicate creation -> 409)
- Side effects (DB writes, events, cache invalidation)

## Anti-Patterns

| # | Don't | Do Instead |
|---|-------|------------|
| 1 | Mock internal helpers | Mock at boundaries (DB, HTTP, queue) |
| 2 | Test implementation details (spies on internals) | Test observable behavior |
| 3 | Share mutable state between tests | Independent setup/teardown per test |
| 4 | Use DB fixtures (JSON/YAML files) | Factories (factory_boy, fishery) |
| 5 | Skip error path testing | At least one failure test per function |
| 6 | Commit .only() / .skip() | Remove before merge |
| 7 | Snapshot tests for logic | Use explicit assertions |
| 8 | Test framework internals | Test your code's behavior |

For stack-specific code examples, fetch `SPEC:be-ts-001` (TypeScript) or `SPEC:be-py-001` (Python).
