import { afterEach, describe, expect, test } from 'bun:test';
import { type TestServer, createTestServer } from '@hopak/testing';
import { Router, boolean, crud, defineRoute, email, model, password, text } from '../src';

const post = model('post', {
  title: text().required().min(3).max(200),
  content: text().required(),
  published: boolean().default(false),
});

const user = model('user', {
  name: text().required(),
  email: email().required().unique(),
  password: password().required().min(6),
});

let env: TestServer | undefined;

async function bootstrap<M extends Parameters<typeof crud.list>[0]>(
  models: readonly M[],
): Promise<TestServer> {
  const router = new Router();
  for (const m of models) {
    const plural = m.name.endsWith('s') ? m.name : `${m.name}s`;
    router.add('GET', `/api/${plural}`, crud.list(m));
    router.add('POST', `/api/${plural}`, crud.create(m));
    router.add('GET', `/api/${plural}/[id]`, crud.read(m));
    router.add('PUT', `/api/${plural}/[id]`, crud.update(m));
    router.add('PATCH', `/api/${plural}/[id]`, crud.patch(m));
    router.add('DELETE', `/api/${plural}/[id]`, crud.remove(m));
  }
  env = await createTestServer({ models, router });
  return env;
}

afterEach(async () => {
  if (env) {
    await env.stop();
    env = undefined;
  }
});

describe('crud.* helpers (route-file level)', () => {
  test('crud.list returns a RouteDefinition with a handler', () => {
    const route = crud.list(post);
    expect(route).toBeDefined();
    expect(typeof route.handler).toBe('function');
  });

  test('crud.create + crud.read + crud.patch + crud.remove cover the CRUD verbs', () => {
    expect(typeof crud.create(post).handler).toBe('function');
    expect(typeof crud.read(post).handler).toBe('function');
    expect(typeof crud.patch(post).handler).toBe('function');
    expect(typeof crud.remove(post).handler).toBe('function');
  });
});

describe('CRUD endpoints (live, user wires up crud.* in a router)', () => {
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

  test('custom file-route just replaces the verb — no implicit conflict', async () => {
    // When the user wants to override POST, they simply don't use
    // crud.create() in the route file; they write their own. The
    // router doesn't know anything about "auto" vs "custom".
    const router = new Router();
    router.add('GET', '/api/posts', crud.list(post));
    router.add(
      'POST',
      '/api/posts',
      defineRoute({ handler: () => ({ from: 'file', custom: true }) }),
    );
    env = await createTestServer({ models: [post], router });
    const res = await env.client.post<{ from: string }>('/api/posts', {});
    expect(res.status).toBe(200);
    expect(res.body.from).toBe('file');
  });

  test('email unique violation surfaces as 409 Conflict', async () => {
    const { client } = await bootstrap([user]);

    await client.post('/api/users', { name: 'a', email: 'same@x.com', password: 'pass123' });
    const dup = await client.post('/api/users', {
      name: 'b',
      email: 'same@x.com',
      password: 'pass123',
    });
    expect(dup.status).toBe(409);
  });
});
