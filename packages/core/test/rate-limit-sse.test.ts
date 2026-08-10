import { afterAll, describe, expect, test } from 'bun:test';
import { rateLimit } from '../src/http/rate-limit';
import { defineRoute } from '../src/http/route';
import { Router } from '../src/http/router';
import { type ListeningServer, startServer } from '../src/http/server';
import { sse } from '../src/http/sse';

const servers: ListeningServer[] = [];
afterAll(async () => {
  for (const s of servers) await s.stop();
});

async function boot(router: Router): Promise<ListeningServer> {
  const server = await startServer({ port: 0, router });
  servers.push(server);
  return server;
}

describe('rateLimit', () => {
  test('allows up to max, then 429 with Retry-After', async () => {
    const router = new Router();
    router.add(
      'GET',
      '/limited',
      defineRoute({
        handler: () => ({ ok: true }),
        before: [rateLimit({ max: 2, windowMs: 60_000 })],
      }),
    );
    const server = await boot(router);

    const first = await fetch(`${server.url}/limited`);
    const second = await fetch(`${server.url}/limited`);
    const third = await fetch(`${server.url}/limited`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(0);
    const body = (await third.json()) as { error: string };
    expect(body.error).toBe('RATE_LIMITED');
  });

  test('separate keys get separate budgets', async () => {
    const router = new Router();
    router.add(
      'GET',
      '/keyed',
      defineRoute({
        handler: () => ({ ok: true }),
        before: [rateLimit({ max: 1, keyFor: (ctx) => ctx.query.get('user') ?? 'anon' })],
      }),
    );
    const server = await boot(router);

    expect((await fetch(`${server.url}/keyed?user=a`)).status).toBe(200);
    expect((await fetch(`${server.url}/keyed?user=b`)).status).toBe(200);
    expect((await fetch(`${server.url}/keyed?user=a`)).status).toBe(429);
  });
});

describe('sse', () => {
  test('streams events and closes', async () => {
    const router = new Router();
    router.add(
      'GET',
      '/events',
      defineRoute({
        handler: sse((stream) => {
          stream.send({ n: 1 });
          stream.send('plain', { event: 'note', id: '7' });
          stream.close();
        }),
      }),
    );
    const server = await boot(router);

    const res = await fetch(`${server.url}/events`);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const text = await res.text();
    expect(text).toContain('data: {"n":1}');
    expect(text).toContain('event: note');
    expect(text).toContain('id: 7');
    expect(text).toContain('data: plain');
  });
});

describe('request body size limit', () => {
  test('oversized body is rejected with 413', async () => {
    const router = new Router();
    router.add(
      'POST',
      '/echo',
      defineRoute({ handler: async (ctx) => ({ length: (await ctx.text()).length }) }),
    );
    const server = await startServer({ port: 0, router, maxRequestBodyBytes: 1024 });
    servers.push(server);

    const small = await fetch(`${server.url}/echo`, { method: 'POST', body: 'x'.repeat(512) });
    expect(small.status).toBe(200);

    const big = await fetch(`${server.url}/echo`, { method: 'POST', body: 'x'.repeat(4096) });
    expect(big.status).toBe(413);
  });
});
