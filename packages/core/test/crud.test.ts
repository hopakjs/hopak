import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type TestServer, createTestServer } from '@hopak/testing';
import {
  Router,
  boolean,
  defineRoute,
  email,
  model,
  password,
  registerCrudRoutes,
  text,
} from '../src';

const post = model(
  'post',
  {
    title: text().required().min(3).max(200),
    content: text().required(),
    published: boolean().default(false),
  },
  { crud: true },
);

const user = model(
  'user',
  {
    name: text().required(),
    email: email().required().unique(),
    password: password().required().min(6),
  },
  { crud: true },
);

const internal = model('internal', { secret: text() });

let env: TestServer | undefined;

async function bootstrap(
  models: (typeof post)[] | (typeof user)[] | (typeof internal)[] = [post],
): Promise<TestServer> {
  env = await createTestServer({ models, withCrud: true });
  return env;
}

afterEach(async () => {
  if (env) {
    await env.stop();
    env = undefined;
  }
});

describe('registerCrudRoutes', () => {
  test('only registers for models with crud:true', async () => {
    const router = new Router();
    const local = await createTestServer({ models: [post, user, internal], router });
    const result = registerCrudRoutes({
      router,
      db: local.requireDb(),
      models: [post, user, internal],
    });
    expect(result.registered).toBe(12);
    expect(router.has('GET', '/api/internals')).toBe(false);
    await local.stop();
  });

  test('uses pluralized name in path', async () => {
    const router = new Router();
    const local = await createTestServer({ models: [post], router });
    registerCrudRoutes({ router, db: local.requireDb(), models: [post] });
    expect(router.has('GET', '/api/posts')).toBe(true);
    expect(router.has('GET', '/api/posts/[id]')).toBe(true);
    await local.stop();
  });

  test('respects custom prefix', async () => {
    const router = new Router();
    const local = await createTestServer({ models: [post], router });
    registerCrudRoutes({ router, db: local.requireDb(), models: [post], prefix: '/v2' });
    expect(router.has('GET', '/v2/posts')).toBe(true);
    await local.stop();
  });

  test('skips when file route already registered', async () => {
    const router = new Router();
    router.add('POST', '/api/posts', defineRoute({ handler: () => ({ from: 'file' }) }));
    const local = await createTestServer({ models: [post], router });
    const result = registerCrudRoutes({ router, db: local.requireDb(), models: [post] });
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.method).toBe('POST');
    await local.stop();
  });
});

describe('CRUD endpoints (live)', () => {
  test('POST creates and validates body', async () => {
    const { client } = await bootstrap([post]);

    const bad = await client.post<{ error: string }>('/api/posts', { title: 'ab' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('VALIDATION_ERROR');

    const ok = await client.post<{ title: string }>('/api/posts', {
      title: 'Hello',
      content: 'World',
    });
    expect(ok.status).toBe(201);
    expect(ok.body.title).toBe('Hello');
  });

  test('GET list returns paginated payload', async () => {
    const { client } = await bootstrap([post]);

    for (let i = 0; i < 3; i++) {
      await client.post('/api/posts', { title: `t${i}-aa`, content: 'x' });
    }

    const res = await client.get<{ items: unknown[]; total: number; limit: number }>(
      '/api/posts?limit=2',
    );
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBe(3);
    expect(res.body.limit).toBe(2);
  });

  test('GET by id returns row', async () => {
    const { client } = await bootstrap([post]);

    const created = await client.post<{ id: number }>('/api/posts', {
      title: 'find',
      content: 'me',
    });
    const found = await client.get<{ title: string }>(`/api/posts/${created.body.id}`);
    expect(found.body.title).toBe('find');
  });

  test('GET by missing id returns 404', async () => {
    const { client } = await bootstrap([post]);
    const res = await client.get('/api/posts/9999');
    expect(res.status).toBe(404);
  });

  test('PATCH updates partial fields', async () => {
    const { client } = await bootstrap([post]);
    const created = await client.post<{ id: number }>('/api/posts', {
      title: 'orig',
      content: 'x',
    });
    const res = await client.patch<{ title: string }>(`/api/posts/${created.body.id}`, {
      title: 'changed',
    });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('changed');
  });

  test('PUT requires full body validation', async () => {
    const { client } = await bootstrap([post]);
    const created = await client.post<{ id: number }>('/api/posts', {
      title: 'orig',
      content: 'x',
    });
    const res = await client.put(`/api/posts/${created.body.id}`, { title: 'changed' });
    expect(res.status).toBe(400);
  });

  test('DELETE removes row and returns 204', async () => {
    const { client } = await bootstrap([post]);
    const created = await client.post<{ id: number }>('/api/posts', {
      title: 'gone',
      content: 'x',
    });
    const removed = await client.delete(`/api/posts/${created.body.id}`);
    expect(removed.status).toBe(204);
    const after = await client.get(`/api/posts/${created.body.id}`);
    expect(after.status).toBe(404);
  });

  test('password field excluded from JSON response', async () => {
    const { client } = await bootstrap([user]);

    const res = await client.post<Record<string, unknown>>('/api/users', {
      name: 'wince',
      email: 'w@x.com',
      password: 'secret123',
    });
    expect(res.status).toBe(201);
    expect(res.body.password).toBeUndefined();
    expect(res.body.name).toBe('wince');
  });

  test('file route overrides auto-CRUD POST', async () => {
    const router = new Router();
    router.add(
      'POST',
      '/api/posts',
      defineRoute({ handler: () => ({ from: 'file', custom: true }) }),
    );
    env = await createTestServer({ models: [post], router, withCrud: true });
    const res = await env.client.post<{ from: string }>('/api/posts', {});
    expect(res.status).toBe(200);
    expect(res.body.from).toBe('file');
  });

  test('email unique constraint surfaces as 5xx (DB error)', async () => {
    const { client } = await bootstrap([user]);

    await client.post('/api/users', { name: 'a', email: 'same@x.com', password: 'pass123' });
    const dup = await client.post('/api/users', {
      name: 'b',
      email: 'same@x.com',
      password: 'pass123',
    });
    expect(dup.status).toBeGreaterThanOrEqual(400);
  });
});
