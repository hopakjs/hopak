import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requestId } from '../src/http/request-log';
import { defineRoute } from '../src/http/route';
import { Router } from '../src/http/router';
import { type ListeningServer, startServer } from '../src/http/server';

const servers: ListeningServer[] = [];
afterAll(async () => {
  for (const s of servers) await s.stop();
});

async function boot(): Promise<ListeningServer> {
  const publicDir = await mkdtemp(join(tmpdir(), 'hopak-ctx-headers-'));
  await writeFile(join(publicDir, 'hello.txt'), 'hi\n');

  const router = new Router();
  router.add('GET', '/ok', defineRoute({ handler: () => ({ ok: true }) }));
  router.add('GET', '/raw', defineRoute({ handler: () => new Response('raw', { status: 200 }) }));
  router.add(
    'GET',
    '/boom',
    defineRoute({
      handler: () => {
        throw new Error('kaboom');
      },
    }),
  );

  const server = await startServer({
    port: 0,
    router,
    staticDir: publicDir,
    middleware: { before: [requestId()], after: [], wrap: [] },
  });
  servers.push(server);
  return server;
}

describe('ctx.setHeader reaches every response', () => {
  test('handler result, raw Response, static file, 404, 405 and errors all carry it', async () => {
    const server = await boot();

    const paths: Array<[string, RequestInit | undefined, number]> = [
      ['/ok', undefined, 200],
      ['/raw', undefined, 200],
      ['/hello.txt', undefined, 200],
      ['/missing', undefined, 404],
      ['/ok', { method: 'POST' }, 405],
      ['/boom', undefined, 500],
    ];

    for (const [path, init, status] of paths) {
      const res = await fetch(`${server.url}${path}`, init);
      expect(res.status).toBe(status);
      expect(res.headers.get('x-request-id')).toBeTruthy();
    }
  });
});
