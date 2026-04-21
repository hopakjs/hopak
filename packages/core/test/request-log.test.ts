import { afterEach, describe, expect, test } from 'bun:test';
import { type TestServer, createTestServer } from '@hopak/testing';
import { Router, defineRoute, requestId, requestLog } from '../src';

let env: TestServer | undefined;

afterEach(async () => {
  await env?.stop();
  env = undefined;
});

function captureLogs(): {
  lines: Array<{ level: string; message: string; meta: unknown }>;
  log: import('../src').RequestContext['log'];
} {
  const lines: Array<{ level: string; message: string; meta: unknown }> = [];
  const level = (lvl: string) => (msg: string, meta?: unknown) => {
    lines.push({ level: lvl, message: msg, meta });
  };
  const log = {
    debug: level('debug'),
    info: level('info'),
    warn: level('warn'),
    error: level('error'),
    child: () => log,
  };
  return { lines, log: log as unknown as import('../src').RequestContext['log'] };
}

describe('requestId', () => {
  test('sets ctx.requestId and echoes in response header', async () => {
    let seen: string | undefined;
    const router = new Router();
    router.add(
      'GET',
      '/',
      defineRoute({
        before: [requestId()],
        handler: (ctx) => {
          seen = ctx.requestId;
          return { ok: true };
        },
      }),
    );
    env = await createTestServer({ router });

    const res = await fetch(env.url);
    const header = res.headers.get('X-Request-Id');
    expect(seen).toBeTypeOf('string');
    expect(header).toBe(seen ?? null);
  });

  test('custom header name + generator', async () => {
    const router = new Router();
    router.add(
      'GET',
      '/',
      defineRoute({
        before: [requestId({ header: 'X-Trace', generate: () => 'fixed-id' })],
        handler: () => ({ ok: true }),
      }),
    );
    env = await createTestServer({ router });

    const res = await fetch(env.url);
    expect(res.headers.get('X-Trace')).toBe('fixed-id');
  });
});

describe('requestLog', () => {
  test('emits one info line per request in simple format', async () => {
    const { lines, log } = captureLogs();
    const router = new Router();
    router.add(
      'GET',
      '/ping',
      defineRoute({
        after: [requestLog()],
        handler: () => ({ ok: true }),
      }),
    );
    env = await createTestServer({ router, log });

    await fetch(`${env.url}/ping`);
    const infoLines = lines.filter((l) => l.level === 'info');
    expect(infoLines).toHaveLength(1);
    expect(infoLines[0]?.message).toMatch(/^GET \/ping 200 \d+ms$/);
  });

  test('json format produces structured meta', async () => {
    const { lines, log } = captureLogs();
    const router = new Router();
    router.add(
      'GET',
      '/ping',
      defineRoute({
        after: [requestLog({ format: 'json' })],
        handler: () => ({ ok: true }),
      }),
    );
    env = await createTestServer({ router, log });

    await fetch(`${env.url}/ping`);
    const entry = lines.find((l) => l.level === 'info' && l.message === 'request');
    expect(entry?.meta).toMatchObject({ method: 'GET', path: '/ping', status: 200 });
  });

  test('includes requestId tag when the id middleware ran first', async () => {
    const { lines, log } = captureLogs();
    const router = new Router();
    router.add(
      'GET',
      '/ping',
      defineRoute({
        before: [requestId({ generate: () => 'abc-123' })],
        after: [requestLog()],
        handler: () => ({ ok: true }),
      }),
    );
    env = await createTestServer({ router, log });

    await fetch(`${env.url}/ping`);
    const entry = lines.find((l) => l.message.includes('GET /ping'));
    expect(entry?.message).toContain('[abc-123]');
  });

  test('captures error summary when handler throws', async () => {
    const { lines, log } = captureLogs();
    const router = new Router();
    router.add(
      'GET',
      '/boom',
      defineRoute({
        after: [requestLog()],
        handler: () => {
          throw new Error('kapow');
        },
      }),
    );
    env = await createTestServer({ router, log });

    await fetch(`${env.url}/boom`);
    const entry = lines.find((l) => l.message.includes('GET /boom'));
    expect(entry?.message).toContain('! kapow');
  });
});
