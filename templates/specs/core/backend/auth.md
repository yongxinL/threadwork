---
domain: backend
name: auth
specId: SPEC:be-002
updated: 2026-04-15
confidence: 0.95
tags: [auth, jwt, security, tokens, passwords, sessions, oauth, rbac, backend, middleware]
rules:
  - type: grep_must_not_exist
    pattern: "localStorage\\.(set|get)Item.*token"
    files: "src/**/*.{ts,tsx,js,jsx}"
    message: "Never store auth tokens in localStorage — use httpOnly cookies (SPEC:be-002)"
  - type: grep_must_not_exist
    pattern: "(?i)(md5|sha1)\\("
    files: "src/**/*.{ts,py}"
    message: "Never use MD5/SHA1 for password hashing — use bcrypt/argon2 (SPEC:be-002)"
---
# Authentication Standards

## Core Principles

1. Access tokens: short-lived (15 min max), minimal claims, stored in memory only.
2. Refresh tokens: httpOnly cookie, server-side storage, rotate on every use.
3. Passwords: bcrypt (cost >=12) or argon2. Never MD5, SHA1, SHA256.
4. Tokens never appear in URLs, query params, or logs.
5. Server-side validation is mandatory — never trust client-side auth checks alone.

## Auth Method Selection

| Method | When | Frontend |
|--------|------|----------|
| Session | Same-domain SSR, server-rendered apps | Templates, htmx, SSR |
| JWT | Cross-domain, SPA, mobile, API-first | React, Vue, mobile |
| OAuth2 | Third-party login, external API consumers | Any |

## Middleware Ordering

Process requests in this sequence:
RequestID -> Logging -> CORS -> RateLimit -> BodyParse -> Auth -> Authz -> Validation -> Handler -> ErrorHandler

## JWT Security Rules

- Access token lifetime: 15 minutes (never >30 min)
- Refresh token: httpOnly, secure, sameSite=lax cookie
- Rotate refresh tokens on every use (invalidate old token)
- Sign with RS256 (asymmetric) when external services verify; HS256 for single-service
- Never embed secrets, PII, or role lists in access token claims — keep minimal (sub, exp, iat)

## RBAC Pattern

- Define roles as a set of permissions, not hardcoded strings in middleware
- Check permissions, not role names (`hasPermission('orders:write')` not `isAdmin`)
- Store role-permission mapping in config or database, not scattered across route handlers

## Anti-Patterns

| # | Don't | Do Instead |
|---|-------|------------|
| 1 | Store tokens in localStorage | httpOnly cookies |
| 2 | Long-lived access tokens (>30 min) | 15 min access + refresh rotation |
| 3 | Hardcode secrets in source | Environment variables |
| 4 | MD5/SHA1 for passwords | bcrypt (cost >=12) or argon2 |
| 5 | Check role names in handlers | Check permissions via RBAC |
| 6 | Skip auth on "internal" routes | Auth on every protected route |
| 7 | Token in URL query params | Authorization header only |

For stack-specific code examples, fetch `SPEC:be-ts-001` (TypeScript) or `SPEC:be-py-001` (Python).
