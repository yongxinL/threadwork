---
domain: backend
name: ts-patterns
specId: SPEC:be-ts-001
updated: 2026-04-15
confidence: 0.9
tags: [typescript, nextjs, prisma, zod, jose, bcryptjs, express, fastify, nestjs, hono, drizzle]
rules:
  - type: grep_must_not_exist
    pattern: "console\\.log"
    files: "src/**/*.ts"
    message: "Use structured logger, not console.log (SPEC:be-ts-001)"
  - type: import_boundary
    from: "src/services/**"
    cannot_import: ["src/ui/**", "src/components/**"]
    message: "Service layer cannot import from UI layer (SPEC:be-ts-001)"
  - type: naming_pattern
    pattern: "^use[A-Z]"
    files: "src/hooks/**/*.ts"
    target: "export_names"
    message: "Hooks must start with 'use' prefix (SPEC:be-ts-001)"
---
# TypeScript Backend Patterns

Stack-specific reference for SPEC:be-001 (API), SPEC:be-002 (Auth), SPEC:be-003 (DB), SPEC:test-001 (Testing).

---

## API: Input Validation with Zod

```typescript
import { z } from 'zod';

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  name: z.string().min(1).max(100),
});

export async function POST(req: Request) {
  const body = await req.json();
  const result = createUserSchema.safeParse(body);
  if (!result.success) {
    return Response.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: result.error.flatten() } },
      { status: 400 }
    );
  }
  // result.data is typed and validated
}
```

## API: Response Envelope Type

```typescript
type ApiSuccess<T> = { data: T; meta?: { timestamp: string } };
type ApiError = { error: { code: string; message: string; details?: unknown } };
type ApiResponse<T> = ApiSuccess<T> | ApiError;
```

## API: Error Handler Middleware

```typescript
// Catch-all error handler — log full error, return safe message
function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error(`[${req.method} ${req.url}]`, err);
  const status = err instanceof AppError ? err.statusCode : 500;
  res.status(status).json({
    error: { code: err.name ?? 'INTERNAL_ERROR', message: status === 500 ? 'Internal server error' : err.message }
  });
}
```

## Auth: JWT with jose

```typescript
import { SignJWT, jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
}

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, secret);
  return payload;
}
```

## Auth: httpOnly Cookie Storage

```typescript
response.cookies.set('auth-token', token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 15 * 60, // 15 minutes
  path: '/',
});
```

## Auth: Password Hashing with bcryptjs

```typescript
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

## DB: Prisma Transaction Pattern

```typescript
const order = await prisma.$transaction(async (tx) => {
  const order = await tx.order.create({ data: { userId, total } });
  await tx.orderItem.createMany({
    data: items.map(item => ({ orderId: order.id, ...item })),
  });
  return order;
});
```

## DB: Prevent N+1 with Prisma

```typescript
// Include related data in a single query
const orders = await prisma.order.findMany({
  where: { userId },
  include: { items: true, user: { select: { email: true } } },
  orderBy: { createdAt: 'desc' },
  take: 20,
});
```

## Testing: Jest/Vitest Pattern

```typescript
// AAA pattern with boundary mocking
import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/db'); // mock at boundary

describe('createUser', () => {
  it('returns user without password hash', async () => {
    // Arrange
    const input = { email: 'a@b.com', name: 'Alice', password: 'secure123' };
    // Act
    const user = await createUser(input);
    // Assert
    expect(user.id).toBeDefined();
    expect(user.email).toBe(input.email);
    expect(user).not.toHaveProperty('password');
  });

  it('throws on duplicate email', async () => {
    await expect(createUser({ email: 'exists@b.com', name: 'Bob', password: 'x' }))
      .rejects.toThrow('Email already registered');
  });
});
```

## Anti-Patterns (TypeScript-Specific)

| # | Don't | Do Instead |
|---|-------|------------|
| 1 | `any` type | Proper type or `unknown` + type guard |
| 2 | `// @ts-ignore` | Fix the type error |
| 3 | `jsonwebtoken` package | `jose` (works in Edge, async) |
| 4 | `localStorage` for tokens | httpOnly cookies |
| 5 | `console.log` in prod code | Structured logger (pino, winston) |
| 6 | Raw SQL string concatenation | Prisma/Drizzle ORM or parameterized queries |
| 7 | `jest.mock('../helpers/...')` | Mock DB/HTTP client at boundary |
| 8 | Default export for utils | Named exports (better tree-shaking, grep-ability) |
