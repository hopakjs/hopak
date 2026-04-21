import { afterEach, describe, expect, test } from 'bun:test';
import { Forbidden, Unauthorized } from '@hopak/common';
import { type TestServer, createTestServer } from '@hopak/testing';
import {
  type After,
  type Before,
  Router,
  type Wrap,
  defineRoute,
  hopak,
  model,
  text,
} from '../src';
import { crud } from '../src/crud';

let env: TestServer | undefined;

afterEach(async () => {
  await env?.stop();
  env = undefined;
});

describe('before — runs before handler', () => {
  test('augments ctx for the handler to read', async () => {
    const tag: Before = (ctx) => {
      (ctx as unknown as { greet: string }).greet = 'hi';
    };

    const router = new Router();
    router.add(
      'GET',
      '/',
      defineRoute({
        before: [tag],
        handler: (ctx) => ({ greet: (ctx as unknown as { greet?: string }).greet }),
      }),
    );
    env = await createTestServer({ router });

    const res = await env.client.get<{ greet: string }>('/');
    expect(res.body.greet).toBe('hi');
  });

  test('throwing HopakError short-circuits with the right status', async () => {
    const block: Before = () => {
      throw new Forbidden('nope');
    };
    let ran = false;
    const router = new Router();
    router.add(
      'GET',
      '/x',
      defineRoute({
        before: [block],
        handler: () => {
          ran = true;
          return { ok: true };
        },
      }),
    );
    env = await createTestServer({ router });

    const res = await env.client.get('/x');
    expect(res.status).toBe(403);
    expect(ran).toBe(false);
  });

  test('returning a Response short-circuits with that response', async () => {
    const redirect: Before = () =>
      new Response(null, { status: 302, headers: { location: '/login' } });
    const router = new Router();
    router.add(
      'GET',
      '/dash',
      defineRoute({
        before: [redirect],
        handler: () => ({ ok: true }),
      }),
    );
    env = await createTestServer({ router });

    const res = await fetch(`${env.url}/dash`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });

  test('multiple befores run in declaration order', async () => {
    const order: string[] = [];
    const a: Before = () => void order.push('a');
    const b: Before = () => void order.push('b');

    const router = new Router();
    router.add(
      'GET',
      '/',
      defineRoute({
        before: [a, b],
        handler: () => ({ order }),
      }),
    );
    env = await createTestServer({ router });

    await env.client.get('/');
    expect(order).toEqual(['a', 'b']);
  });
});

describe('after — runs after handler', () => {
  test('sees the final response', async () => {
    let seenStatus: number | undefined;
    const observe: After = (_ctx, { response }) => {
      seenStatus = response?.status;
    };
    const router = new Router();
    router.add(
      'GET',
      '/r',
      defineRoute({
        after: [observe],
        handler: (ctx) => {
          ctx.setStatus(201);
          return { ok: true };
        },
      }),
    );
    env = await createTestServer({ router });

    await env.client.get('/r');
    expect(seenStatus).toBe(201);
  });

  test('still runs when handler throws, receives the error', async () => {
    let seenError: unknown;
    const observe: After = (_ctx, { error }) => {
      seenError = error;
    };
    const router = new Router();
    router.add(
      'GET',
      '/r',
      defineRoute({
        after: [observe],
        handler: () => {
          throw new Unauthorized('nope');
        },
      }),
    );
    env = await createTestServer({ router });

    const res = await env.client.get('/r');
    expect(res.status).toBe(401);
    expect(seenError).toBeInstanceOf(Unauthorized);
  });

  test('a throwing after does not crash the response', async () => {
    const broken: After = () => {
      throw new Error('bug in after');
    };
    const router = new Router();
    router.add(
      'GET',
      '/r',
      defineRoute({
        after: [broken],
        handler: () => ({ ok: true }),
      }),
    );
    env = await createTestServer({ router });

    const res = await env.client.get('/r');
    expect(res.status).toBe(200);
  });
});

describe('wrap — composes around handler', () => {
  test('outer wrap executes first on entry, last on exit', async () => {
    const trace: string[] = [];
    const outer: Wrap = async (_ctx, run) => {
      trace.push('outer:in');
      const res = await run();
      trace.push('outer:out');
      return res;
    };
    const inner: Wrap = async (_ctx, run) => {
      trace.push('inner:in');
      const res = await run();
      trace.push('inner:out');
      return res;
    };

    const router = new Router();
    router.add(
      'GET',
      '/',
      defineRoute({
        wrap: [outer, inner],
        handler: () => {
          trace.push('handler');
          return { ok: true };
        },
      }),
    );
    env = await createTestServer({ router });

    await env.client.get('/');
    expect(trace).toEqual(['outer:in', 'inner:in', 'handler', 'inner:out', 'outer:out']);
  });

  test('can modify the response', async () => {
    const setHeader: Wrap = async (_ctx, run) => {
      const res = await run();
      res.headers.set('x-touched', 'yes');
      return res;
    };
    const router = new Router();
    router.add(
      'GET',
      '/',
      defineRoute({
        wrap: [setHeader],
        handler: () => ({ ok: true }),
      }),
    );
    env = await createTestServer({ router });

    const res = await fetch(`${env.url}/`);
    expect(res.headers.get('x-touched')).toBe('yes');
  });
});

describe('global + route middleware compose', () => {
  test('global before runs before route before', async () => {
    const order: string[] = [];
    const global: Before = () => void order.push('global');
    const routeLevel: Before = () => void order.push('route');

    const router = new Router();
    router.add(
      'GET',
      '/',
      defineRoute({
        before: [routeLevel],
        handler: () => ({ order }),
      }),
    );
    env = await createTestServer({
      router,
      middleware: { before: [global], after: [], wrap: [] },
    });

    await env.client.get('/');
    expect(order).toEqual(['global', 'route']);
  });

  test('route after runs before global after (cleanup then report)', async () => {
    const order: string[] = [];
    const routeLevel: After = () => void order.push('route');
    const globalLevel: After = () => void order.push('global');

    const router = new Router();
    router.add(
      'GET',
      '/',
      defineRoute({
        after: [routeLevel],
        handler: () => ({ ok: true }),
      }),
    );
    env = await createTestServer({
      router,
      middleware: { before: [], after: [globalLevel], wrap: [] },
    });

    await env.client.get('/');
    expect(order).toEqual(['route', 'global']);
  });
});

describe('hopak() fluent builder', () => {
  test('registering middleware after listen() throws a clear error', async () => {
    const app = hopak();
    const server = await app.listen(0);
    try {
      expect(() => app.before(() => {})).toThrow(/cannot register middleware after listen/);
      expect(() => app.after(() => {})).toThrow(/cannot register middleware after listen/);
      expect(() => app.wrap(async (_c, run) => run())).toThrow(
        /cannot register middleware after listen/,
      );
    } finally {
      await server.stop();
    }
  });
});

describe('crud.* accepts middleware options', () => {
  const widget = model('widget', { name: text().required().min(2) });

  test('before on crud.create gates the verb', async () => {
    const block: Before = () => {
      throw new Unauthorized('no');
    };
    const router = new Router();
    router.add('GET', '/api/widgets', crud.list(widget));
    router.add('POST', '/api/widgets', crud.create(widget, { before: [block] }));
    env = await createTestServer({ models: [widget], router });

    const get = await env.client.get('/api/widgets');
    expect(get.status).toBe(200);

    const post = await env.client.post('/api/widgets', { name: 'one' });
    expect(post.status).toBe(401);
  });
});
