import { afterAll, describe, expect, test } from 'bun:test';
import { Unauthorized } from '@hopak/common';
import { Router } from '../src/http/router';
import { type ListeningServer, startServer } from '../src/http/server';
import { defineWebSocket } from '../src/http/websocket';

const servers: ListeningServer[] = [];
afterAll(async () => {
  for (const s of servers) await s.stop();
});

function wsUrl(server: ListeningServer, path: string): string {
  return `${server.url.replace('http', 'ws')}${path}`;
}

function once<T>(target: WebSocket, event: string): Promise<T> {
  return new Promise((resolve) => {
    target.addEventListener(event, (e) => resolve(e as T), { once: true });
  });
}

describe('websocket routes', () => {
  test('echo round-trip with params and query', async () => {
    const router = new Router();
    router.add(
      'GET',
      '/ws/rooms/[room]',
      {
        handler: () => new Response(null, { status: 426 }),
        ws: defineWebSocket({
          open(ws) {
            ws.send(`joined:${ws.data.params.room}:${ws.data.query.get('as') ?? ''}`);
          },
          message(ws, message) {
            ws.send(`echo:${message}`);
          },
        }),
      },
      'test',
    );
    const server = await startServer({ port: 0, router });
    servers.push(server);

    const socket = new WebSocket(wsUrl(server, '/ws/rooms/lobby?as=ada'));
    const greeting = await once<MessageEvent>(socket, 'message');
    expect(greeting.data).toBe('joined:lobby:ada');

    socket.send('hi');
    const reply = await once<MessageEvent>(socket, 'message');
    expect(reply.data).toBe('echo:hi');
    socket.close();
  });

  test('plain GET on a ws route explains the upgrade', async () => {
    const router = new Router();
    router.add(
      'GET',
      '/ws/only',
      {
        handler: () => new Response(JSON.stringify({ error: 'UPGRADE_REQUIRED' }), { status: 426 }),
        ws: defineWebSocket({ message() {} }),
      },
      'test',
    );
    const server = await startServer({ port: 0, router });
    servers.push(server);

    const res = await fetch(`${server.url}/ws/only`);
    expect(res.status).toBe(426);
  });

  test('before middleware gates the upgrade', async () => {
    const router = new Router();
    router.add(
      'GET',
      '/ws/secure',
      {
        handler: () => new Response(null, { status: 426 }),
        before: [
          (ctx) => {
            if (ctx.headers.get('authorization') !== 'Bearer ok') {
              throw new Unauthorized('missing token');
            }
          },
        ],
        ws: defineWebSocket({
          open(ws) {
            ws.send('in');
          },
        }),
      },
      'test',
    );
    const server = await startServer({ port: 0, router });
    servers.push(server);

    const rejected = new WebSocket(wsUrl(server, '/ws/secure'));
    const closeEvent = await Promise.race([
      once<CloseEvent>(rejected, 'close'),
      once<Event>(rejected, 'error').then(() => once<CloseEvent>(rejected, 'close')),
    ]);
    expect(closeEvent).toBeDefined();

    const accepted = new WebSocket(wsUrl(server, '/ws/secure'), {
      headers: { authorization: 'Bearer ok' },
    } as unknown as string[]);
    const msg = await once<MessageEvent>(accepted, 'message');
    expect(msg.data).toBe('in');
    accepted.close();
  });
});
