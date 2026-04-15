---
domain: backend
name: db-schema
specId: SPEC:be-003
updated: 2026-04-15
confidence: 0.95
tags: [database, schema, sql, migration, index, postgres, mysql, sqlite, orm, prisma, sqlalchemy, django, drizzle]
rules: []
---
# Database Schema Design

## 7 Core Rules

1. **Start normalized (3NF).** Denormalize only with measured evidence (EXPLAIN ANALYZE, not assumptions).
2. **Every table gets**: primary key, `created_at`, `updated_at` timestamps.
3. **UUID for public-facing IDs**, serial/bigserial for internal join keys.
4. **NOT NULL by default.** Nullable only when business logic explicitly requires it.
5. **Index every column** used in WHERE, JOIN, or ORDER BY clauses.
6. **Foreign keys enforced in the database**, not just application code.
7. **Migrations are additive.** Never drop or rename columns in a single deploy.

## Primary Key Strategy

| Strategy | When | Pros | Cons |
|----------|------|------|------|
| bigserial | Internal tables, FK joins | Compact, fast joins | Enumerable, unsafe for public IDs |
| UUID v4 | Public-facing resources | Non-guessable, globally unique | 16 bytes, random I/O on B-Tree |
| UUID v7 | Public + needs ordering | Non-guessable + insert-friendly | Newer, less ecosystem support |
| Text slug | URL-friendly resources | Human-readable | Must enforce uniqueness |

Recommended default: bigserial PK + UUID `public_id` column with unique index.

## ON DELETE Behavior

| Behavior | When | Example |
|----------|------|---------|
| CASCADE | Child meaningless without parent | order_items when order deleted |
| RESTRICT | Prevent accidental deletion | products referenced by order_items |
| SET NULL | Preserve child, clear reference | orders.assigned_to when employee leaves |

## Index Selection

| Type | When |
|------|------|
| B-Tree | Equality, range, ORDER BY (default) |
| GIN | Arrays, JSONB, full-text search |
| GiST | Geometry, ranges, nearest-neighbor |
| BRIN | Very large tables with natural ordering (time-series) |

**Composite index rule**: Column order matters. Index on (A, B, C) supports queries on (A), (A, B), (A, B, C) — but NOT (B), (C), or (B, C).

**Partial indexes**: Index a subset when filtering is common (`WHERE status = 'active'`).

## Zero-Downtime Migrations

**Golden rule**: ADD -> MIGRATE DATA -> REMOVE, in separate deploys.

- Rename column: (1) add new column, (2) write to both, (3) drop old
- Add NOT NULL column: (1) add nullable, backfill in batches, (2) add constraint
- Add index: always use CONCURRENTLY (no table lock)
- Backfill: batch updates (10K rows per iteration), never one giant UPDATE

## Anti-Patterns

| # | Don't | Do Instead |
|---|-------|------------|
| 1 | Premature denormalization | Start 3NF, denormalize when measured |
| 2 | Auto-increment IDs as public API identifiers | UUID for public, serial for internal |
| 3 | No FK constraints | FK enforced in database |
| 4 | Nullable by default | NOT NULL by default |
| 5 | No indexes on FK columns | Index every FK column |
| 6 | Single-step destructive migration | ADD -> MIGRATE -> REMOVE |
| 7 | CREATE INDEX without CONCURRENTLY | Always CONCURRENTLY on live tables |
| 8 | Polymorphic FK (commentable_type + id) | Separate FK columns or separate tables |
| 9 | JSONB for everything | JSONB for flexible data only |
| 10 | No created_at / updated_at | Timestamp pair on every table |
| 11 | Comma-separated values in one column | Separate table or array type |
| 12 | text without length validation | CHECK constraint or app validation |

For stack-specific code examples, fetch `SPEC:be-ts-001` (TypeScript/Prisma) or `SPEC:be-py-001` (Python/SQLAlchemy).
