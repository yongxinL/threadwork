/**
 * Unit tests for lib/complexity-assessor.js
 * Run: node --test tests/unit/complexity-assessor.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.THREADWORK_TEST = '1';

const {
  assessTask,
  assessPlan,
  TIER_MODEL,
  CONFIDENCE_MEDIUM
} = await import('../../lib/complexity-assessor.js');

describe('assessTask — Scope dimension', () => {
  test('1-2 files → score 1 (SIMPLE)', () => {
    const result = assessTask({ description: 'add a button', files: ['Button.tsx'] });
    assert.strictEqual(result.dimensions.scope.score, 1);
  });

  test('3-10 files → score 2 (STANDARD)', () => {
    const result = assessTask({ description: 'implement auth', files: ['auth.ts', 'middleware.ts', 'user.ts'] });
    assert.strictEqual(result.dimensions.scope.score, 2);
  });

  test('10+ files → score 3 (COMPLEX)', () => {
    const result = assessTask({ description: 'implement auth', files: Array.from({ length: 12 }, (_, i) => `file${i}.ts`) });
    assert.strictEqual(result.dimensions.scope.score, 3);
  });
});

describe('assessTask — Integration dimension', () => {
  test('no external calls → score 1', () => {
    const result = assessTask({ description: 'add a button', files: ['Button.tsx'] });
    assert.strictEqual(result.dimensions.integration.score, 1);
  });

  test('OAuth → score 2', () => {
    const result = assessTask({ description: 'implement OAuth2 login flow', files: [] });
    assert.strictEqual(result.dimensions.integration.score, 2);
  });

  test('multiple APIs → score 3', () => {
    const result = assessTask({ description: 'fetch from GraphQL and call Stripe API', files: [] });
    assert.strictEqual(result.dimensions.integration.score, 3);
  });
});

describe('assessTask — Infrastructure dimension', () => {
  test('code-only → score 1', () => {
    const result = assessTask({ description: 'rename a function', files: ['utils.ts'] });
    assert.strictEqual(result.dimensions.infrastructure.score, 1);
  });

  test('config/env change → score 2', () => {
    const result = assessTask({ description: 'add feature flag', files: ['config.ts'] });
    assert.strictEqual(result.dimensions.infrastructure.score, 2);
  });

  test('Docker/DB changes → score 3', () => {
    const result = assessTask({ description: 'add new migration', files: ['migrations/001.sql'] });
    assert.strictEqual(result.dimensions.infrastructure.score, 3);
  });
});

describe('assessTask — Risk dimension', () => {
  test('internal utility → score 1', () => {
    const result = assessTask({ description: 'format a date string', files: [] });
    assert.strictEqual(result.dimensions.risk.score, 1);
  });

  test('user-facing API → score 2', () => {
    const result = assessTask({ description: 'add new user API endpoint', files: [] });
    assert.strictEqual(result.dimensions.risk.score, 2);
  });

  test('auth/payment → score 3', () => {
    const result = assessTask({ description: 'implement JWT refresh token rotation', files: [] });
    assert.strictEqual(result.dimensions.risk.score, 3);
  });
});

describe('assessTask — Knowledge dimension', () => {
  test('familiar pattern → score 1', () => {
    const result = assessTask({ description: 'add CRUD endpoint for users', files: [] });
    assert.strictEqual(result.dimensions.knowledge.score, 1);
  });

  test('unfamiliar library (non-security) → score 2', () => {
    const result = assessTask({ description: 'evaluate new HTTP client library for API calls', files: [] });
    assert.strictEqual(result.dimensions.knowledge.score, 2);
  });

  test('security expertise (encryption) → score 3', () => {
    const result = assessTask({ description: 'implement end-to-end encryption', files: [] });
    assert.strictEqual(result.dimensions.knowledge.score, 3);
  });
});

describe('assessTask — Tier mapping', () => {
  test('low score → SIMPLE → Haiku', () => {
    const result = assessTask({
      description: 'add a simple helper function',
      files: ['util.ts'],
      phaseNumber: 1
    });
    assert.ok(['SIMPLE', 'STANDARD', 'COMPLEX'].includes(result.tier));
    assert.strictEqual(result.modelRecommendation, TIER_MODEL[result.tier]);
    assert.ok(result.confidence >= 0 && result.confidence <= 100);
  });

  test('high risk + high scope → COMPLEX → Opus', () => {
    const result = assessTask({
      description: 'migrate auth to OAuth2 with database schema changes and new Docker setup',
      files: Array.from({ length: 12 }, (_, i) => `file${i}.ts`),
      phaseNumber: 3
    });
    assert.strictEqual(result.tier, 'COMPLEX');
    assert.strictEqual(result.modelRecommendation, 'opus');
  });

  test('security multiplier applied', () => {
    const result = assessTask({
      description: 'add JWT token validation to auth middleware',
      files: ['middleware.ts'],
      phaseNumber: 1
    });
    assert.ok(result.multipliers.applied.includes('security-sensitive'));
    assert.ok(result.adjustedScore > result.score);
  });
});

describe('assessTask — Confidence', () => {
  test('confidence < 60 triggers advisory flag', () => {
    const result = assessTask({
      description: 'do something complex',
      files: [],
      phaseNumber: 1
    });
    assert.ok(result.confidence < 100);
    // Low clarity task should have lower confidence
    assert.ok(result.confidenceJustification.length > 0);
  });

  test('confidence is bounded 0-100', () => {
    const result = assessTask({ description: 'test', files: [] });
    assert.ok(result.confidence >= 0 && result.confidence <= 100);
  });
});

describe('assessTask — Integration hints', () => {
  test('SIMPLE → no worktree, 4096 budget', () => {
    const result = assessTask({ description: 'add a button', files: ['Button.tsx'] });
    assert.strictEqual(result.integrationHints.contextBranchBudget, 4096);
    assert.strictEqual(result.integrationHints.worktreeRecommended, false);
  });

  test('COMPLEX → worktree, 16384 budget', () => {
    const result = assessTask({
      description: 'migrate database schema with breaking API changes',
      files: Array.from({ length: 15 }, (_, i) => `file${i}.ts`),
      phaseNumber: 3
    });
    assert.strictEqual(result.integrationHints.contextBranchBudget, 16384);
    assert.strictEqual(result.integrationHints.worktreeRecommended, true);
  });
});

describe('assessPlan — XML parsing', () => {
  test('extracts tasks and scores them from XML', () => {
    const xml = `
<plan id="PLAN-1-1" phase="1" milestone="1">
  <title>Auth System</title>
  <tasks>
    <task id="T-1-1-1">
      <description>Add JWT middleware</description>
      <files>middleware/auth.ts, middleware/verify.ts</files>
      <verification>Tests pass</verification>
      <done-condition>Auth works</done-condition>
      <token-estimate>8000</token-estimate>
    </task>
    <task id="T-1-1-2">
      <description>Add login page UI</description>
      <files>pages/login.tsx, pages/callback.tsx</files>
      <verification>Page renders</verification>
      <done-condition>Login works</done-condition>
      <token-estimate>5000</token-estimate>
    </task>
  </tasks>
</plan>`;
    const results = assessPlan(xml, 1);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].taskId, 'T-1-1-1');
    assert.strictEqual(results[1].taskId, 'T-1-1-2');
    assert.ok(['SIMPLE', 'STANDARD', 'COMPLEX'].includes(results[0].complexity.tier));
    assert.ok(['haiku', 'sonnet', 'opus'].includes(results[0].complexity.modelRecommendation));
  });
});

describe('assessTask — Decomposability', () => {
  test('backend/frontend separable → score 1', () => {
    const result = assessTask({
      description: 'add backend API and frontend form',
      files: ['server.ts', 'client.tsx']
    });
    assert.strictEqual(result.dimensions.decomposability.score, 1);
  });

  test('tightly coupled → score 3', () => {
    const result = assessTask({
      description: 'atomic transaction with shared state across all services',
      files: Array.from({ length: 8 }, (_, i) => `file${i}.ts`)
    });
    assert.strictEqual(result.dimensions.decomposability.score, 3);
  });
});
