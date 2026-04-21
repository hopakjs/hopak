import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotFound, Unauthorized } from '@hopak/common';
import { type TestServer, createTestServer } from '@hopak/testing';
import { Router, defineRoute, loadFileRoutes, model, text } from '../src';

let env: TestServer | null = null;
let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'hopak-server-'));
});

afterEach(async () => {
  if (env) {
    await env.stop();
    env = null;
  }
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

const corePath = (): string => new URL('../src/index.ts', import.meta.url).pathname;

describe('startServer', () => {
  test('serves a simple GET handler', async () => {
    const router = new Router();
    router.add('GET', '/hello', defineRoute({ handler: () => ({ msg: 'hi' }) }));
    env = await createTestServer({ router });

    const res = await env.client.get<{ msg: string }>('/hello');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ msg: 'hi' });
  });

  test('exposes db on ctx when models provided', async () => {
    const post = model('post', { title: text().required() });
    const router = new Router();
    router.add(
      'GET',
      '/db-check',
      defineRoute({
        handler: (ctx) => ({ hasDb: ctx.db !== undefined }),
      }),
    );
    env = await createTestServer({ router, models: [post] });

    const res = await env.client.get<{ hasDb: boolean }>('/db-check');
    expect(res.body.hasDb).toBe(true);
  });

  test('ctx.db is undefined when no models', async () => {
    const router = new Router();
    router.add(
      'GET',
      '/db-check',
      defineRoute({
        handler: (ctx) => ({ hasDb: ctx.db !== undefined }),
      }),
    );
    env = await createTestServer({ router });

    const res = await env.client.get<{ hasDb: boolean }>('/db-check');
    expect(res.body.hasDb).toBe(false);
  });

  test('ctx.body() and ctx.text() can both be called in the same handler', async () => {
    const router = new Router();
    router.add(
      'POST',
      '/body-text',
      defineRoute({
        handler: async (ctx) => {
          const body = await ctx.body();
          const raw = await ctx.text();
          return { body, rawLength: raw.length };
        },
      }),
    );
    env = await createTestServer({ router });

    const res = await env.client.post<{ body: unknown; rawLength: number }>('/body-text', {
      hello: 'world',
    });
    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ hello: 'world' });
    expect(res.body.rawLength).toBeGreaterThan(0);
  });

  test('passes path params to handler', async () => {
    const router = new Router();
    router.add('GET', '/posts/[id]', defineRoute({ handler: (ctx) => ({ id: ctx.params.id }) }));
    env = await createTestServer({ router });

    const res = await env.client.get<{ id: string }>('/posts/42');
    expect(res.body).toEqual({ id: '42' });
  });

  test('parses JSON body', async () => {
    const router = new Router();
    router.add(
      'POST',
      '/echo',
      defineRoute({
        handler: async (ctx) => {
          return { received: await ctx.body() };
        },
      }),
    );
    env = await createTestServer({ router });

    const res = await env.client.post<{ received: unknown }>('/echo', { x: 1 });
    expect(res.status).toBe(200);
    expect(res.body.received).toEqual({ x: 1 });
  });

  test('returns 404 for unmatched route', async () => {
    env = await createTestServer();
    const res = await env.client.get<{ error: string }>('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  test('returns 405 with Allow header when the path exists under other methods', async () => {
    const router = new Router();
    router.add('GET', '/items/[id]', defineRoute({ handler: () => ({ ok: 'get' }) }));
    router.add('DELETE', '/items/[id]', defineRoute({ handler: () => ({ ok: 'delete' }) }));
    env = await createTestServer({ router });

    const res = await fetch(`${env.url}/items/42`, { method: 'PATCH' });
    expect(res.status).toBe(405);
    const allow = res.headers.get('Allow') ?? '';
    expect(allow).toContain('GET');
    expect(allow).toContain('DELETE');
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('METHOD_NOT_ALLOWED');
  });

  test('still returns 404 when the path has zero handlers across all methods', async () => {
    const router = new Router();
    router.add('GET', '/items/[id]', defineRoute({ handler: () => ({}) }));
    env = await createTestServer({ router });

    const res = await fetch(`${env.url}/different-path`, { method: 'PATCH' });
    expect(res.status).toBe(404);
  });

  test('HopakError serializes with proper status', async () => {
    const router = new Router();
    router.add(
      'GET',
      '/missing',
      defineRoute({
        handler: () => {
          throw new NotFound('No such thing');
        },
      }),
    );
    env = await createTestServer({ router });
    const res = await env.client.get<{ error: string; message: string }>('/missing');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
    expect(res.body.message).toBe('No such thing');
  });

  test('Unauthorized returns 401 JSON', async () => {
    const router = new Router();
    router.add(
      'GET',
      '/secret',
      defineRoute({
        handler: () => {
          throw new Unauthorized('Login required');
        },
      }),
    );
    env = await createTestServer({ router });
    const res = await env.client.get('/secret');
    expect(res.status).toBe(401);
  });

  test('unknown error becomes 500 with safe message', async () => {
    const router = new Router();
    router.add(
      'GET',
      '/boom',
      defineRoute({
        handler: () => {
          throw new Error('internal detail');
        },
      }),
    );
    env = await createTestServer({ router });
    const res = await env.client.get<{ message: string }>('/boom');
    expect(res.status).toBe(500);
    expect(res.body.message).not.toContain('internal detail');
  });

  test('exposeStack returns detail in 500 body', async () => {
    const router = new Router();
    router.add(
      'GET',
      '/boom',
      defineRoute({
        handler: () => {
          throw new Error('internal detail');
        },
      }),
    );
    env = await createTestServer({ router, exposeStack: true });
    const res = await env.client.get<{ detail: string }>('/boom');
    expect(res.body.detail).toBe('internal detail');
  });

  test('serves static file from public dir', async () => {
    const publicDir = join(workDir, 'public');
    await mkdir(publicDir, { recursive: true });
    await writeFile(join(publicDir, 'hello.txt'), 'static-ok', 'utf8');
    env = await createTestServer({ staticDir: publicDir });
    const res = await env.client.get<string>('/hello.txt');
    expect(res.status).toBe(200);
    expect(res.body).toBe('static-ok');
    expect(res.headers.get('etag')).toBeTruthy();
  });

  test('serves index.html on root', async () => {
    const publicDir = join(workDir, 'public');
    await mkdir(publicDir, { recursive: true });
    await writeFile(join(publicDir, 'index.html'), '<h1>root</h1>', 'utf8');
    env = await createTestServer({ staticDir: publicDir });
    const res = await env.client.get<string>('/');
    expect(res.status).toBe(200);
    expect(res.body).toBe('<h1>root</h1>');
  });

  test('rejects path traversal', async () => {
    const publicDir = join(workDir, 'public');
    await mkdir(publicDir, { recursive: true });
    await writeFile(join(workDir, 'secret.txt'), 'secret', 'utf8');
    env = await createTestServer({ staticDir: publicDir });
    const res = await env.client.get('/../secret.txt');
    expect(res.status).toBe(404);
  });
});

describe('loadFileRoutes', () => {
  async function writeFileRoute(relative: string, source: string): Promise<void> {
    const fullPath = join(workDir, relative);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, source, 'utf8');
  }

  test('loads named method exports', async () => {
    await writeFileRoute(
      'routes/posts.ts',
      `import { defineRoute } from '${corePath()}';
export const GET = defineRoute({ handler: () => ({ list: true }) });
export const POST = defineRoute({ handler: () => ({ created: true }) });
`,
    );
    const router = new Router();
    const result = await loadFileRoutes({ routesDir: join(workDir, 'routes'), router });
    expect(result.routes).toBe(2);
    expect(router.match('GET', '/posts')).not.toBeNull();
    expect(router.match('POST', '/posts')).not.toBeNull();
  });

  test('converts [id] to dynamic segment', async () => {
    await writeFileRoute(
      'routes/posts/[id].ts',
      `import { defineRoute } from '${corePath()}';
export const GET = defineRoute({ handler: (ctx) => ctx.params.id });
`,
    );
    const router = new Router();
    await loadFileRoutes({ routesDir: join(workDir, 'routes'), router });
    expect(router.match('GET', '/posts/123')?.params.id).toBe('123');
  });

  test('index.ts becomes parent path', async () => {
    await writeFileRoute(
      'routes/admin/index.ts',
      `import { defineRoute } from '${corePath()}';
export const GET = defineRoute({ handler: () => 'admin' });
`,
    );
    const router = new Router();
    await loadFileRoutes({ routesDir: join(workDir, 'routes'), router });
    expect(router.match('GET', '/admin')).not.toBeNull();
  });

  test('default export becomes GET', async () => {
    await writeFileRoute(
      'routes/health.ts',
      `import { defineRoute } from '${corePath()}';
export default defineRoute({ handler: () => ({ ok: true }) });
`,
    );
    const router = new Router();
    const result = await loadFileRoutes({ routesDir: join(workDir, 'routes'), router });
    expect(result.routes).toBe(1);
    expect(router.match('GET', '/health')).not.toBeNull();
  });

  test('files with no route exports are skipped (treated as helpers)', async () => {
    await writeFileRoute('routes/helper.ts', 'export const guard = [() => {}];\n');
    const router = new Router();
    const result = await loadFileRoutes({ routesDir: join(workDir, 'routes'), router });
    expect(result.routes).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});
