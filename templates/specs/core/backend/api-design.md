---
domain: backend
name: api-design
specId: SPEC:be-001
updated: 2026-04-15
confidence: 0.95
tags: [api, rest, http, endpoint, route, service, backend, fastapi, express, django, nestjs, hono, flask]
rules:
  - type: grep_must_not_exist
    pattern: "stackTrace|stack_trace|traceback\\.format"
    files: "src/**/*.{ts,tsx,js,py}"
    message: "Never expose stack traces in API responses (SPEC:be-001)"
---
# API Design Standards

## 7 Iron Rules

1. Resources map to domain concepts, not database tables. Use plural nouns (`/orders`, not `/getOrder`). No verbs in paths.
2. Limit URL nesting to 2 levels max (`/users/{id}/orders`). Flatten deeper relations with query params.
3. Every response uses a consistent envelope: `{ data }` on success, `{ error: { code, message, details } }` on failure.
4. Use correct HTTP status codes (see table). Never return 200 for errors. Never return 500 for client errors.
5. Validate all input at the API boundary. Reject invalid requests before they reach business logic.
6. Paginate every list endpoint. Default 20 items, max 100. Use cursor-based for large/dynamic sets, offset for small/stable.
7. Never expose internal error details to clients. Log the full error; return a safe message.

## HTTP Methods

| Method | Use | Safe | Idempotent |
|--------|-----|------|------------|
| GET | Read resource(s) | Yes | Yes |
| POST | Create resource | No | No |
| PUT | Full replace | No | Yes |
| PATCH | Partial update | No | No |
| DELETE | Remove resource | No | Yes |

## Status Codes

| Code | When |
|------|------|
| 200 | GET, PUT, PATCH success |
| 201 | POST success (resource created) |
| 204 | DELETE success (no body) |
| 400 | Malformed request / validation error |
| 401 | Not authenticated |
| 403 | Authenticated but not authorized |
| 404 | Resource not found |
| 409 | Conflict (duplicate, version mismatch) |
| 422 | Unprocessable (business logic rejection) |
| 429 | Rate limited (include Retry-After header) |
| 500 | Unexpected server error |

## Error Format (RFC 9457)

Every error response must include: `type` (URI), `title`, `status`, `detail`, `request_id`. Per-field validation errors go in an `errors` array.

## Rate Limiting Headers

Always include: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

## Naming Conventions

- URL paths: kebab-case (`/order-items`)
- JSON fields: camelCase (`firstName`)
- Headers: Train-Case (`X-Request-Id`)

## Anti-Patterns

| # | Don't | Do Instead |
|---|-------|------------|
| 1 | Verbs in URLs (`/getUsers`) | Resource nouns (`/users`) |
| 2 | Return 200 for errors | Correct 4xx/5xx status |
| 3 | Inconsistent response shapes | Consistent envelope |
| 4 | Expose database IDs in URLs | UUID public identifiers |
| 5 | Unpaginated list endpoints | Always paginate |
| 6 | Stack traces in responses | Safe message + internal log |
| 7 | Tokens in query params | Authorization header only |
| 8 | Deep URL nesting (>2 levels) | Query params for filters |

For stack-specific code examples, fetch `SPEC:be-ts-001` (TypeScript) or `SPEC:be-py-001` (Python).
