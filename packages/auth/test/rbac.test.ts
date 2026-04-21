import { afterEach, describe, expect, test } from 'bun:test';
import { Router, defineRoute } from '@hopak/core';
import { type TestServer, createTestServer } from '@hopak/testing';
import { requireRole } from '../src';

let env: TestServer | undefined;

afterEach(async () => {
  await env?.stop();
  env = undefined;
});

function setup(role?: string): Promise<TestServer> {
  const attachUser = role
    ? (ctx: import('@hopak/core').RequestContext) => {
        ctx.user = { id: 1, role };
      }
    : () => {};

  const router = new Router();
  router.add(
    'GET',
    '/admin',
    defineRoute({
      before: [attachUser, requireRole('admin')],
      handler: () => ({ ok: true }),
    }),
  );
  router.add(
    'GET',
    '/editorial',
    defineRoute({
      before: [attachUser, requireRole('admin', 'editor')],
      handler: () => ({ ok: true }),
    }),
  );
  return createTestServer({ router });
}

describe('requireRole', () => {
  test('role matches → handler runs', async () => {
    env = await setup('admin');
    const res = await env.client.get('/admin');
    expect(res.status).toBe(200);
  });

  test('role missing → 403', async () => {
    env = await setup('user');
    const res = await env.client.get('/admin');
    expect(res.status).toBe(403);
  });

  test('no user at all → 401', async () => {
    env = await setup();
    const res = await env.client.get('/admin');
    expect(res.status).toBe(401);
  });

  test('any-of semantics', async () => {
    env = await setup('editor');
    const res = await env.client.get('/editorial');
    expect(res.status).toBe(200);
  });

  test('empty allowed list throws at build time', () => {
    expect(() => requireRole()).toThrow(/at least one role/);
  });
});
