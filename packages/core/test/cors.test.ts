import { afterEach, describe, expect, test } from 'bun:test';
import { type TestServer, createTestServer } from '@hopak/testing';
import { Router, defineRoute, startServer } from '../src';

let env: TestServer | null = null;

afterEach(async () => {
  if (env) {
    await env.stop();
    env = null;
  }
});

describe('CORS middleware', () => {
  test('preflight responds 204 with allowed origin', async () => {
    const server = await startServer({
      port: 0,
      router: new Router(),
      cors: { origins: ['http://example.com'] },
    });

    try {
      const res = await fetch(`${server.url}/anything`, {
        method: 'OPTIONS',
        headers: {
          origin: 'http://example.com',
          'access-control-request-method': 'GET',
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://example.com');
    } finally {
      await server.stop();
    }
  });

  test('wildcard origin echoes request origin', async () => {
    const router = new Router();
    router.add('GET', '/data', defineRoute({ handler: () => ({}) }));
    const server = await startServer({ port: 0, router, cors: { origins: '*' } });

    try {
      const res = await fetch(`${server.url}/data`, {
        headers: { origin: 'http://random.com' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBe('http://random.com');
    } finally {
      await server.stop();
    }
  });

  test('disallowed origin gets no CORS header', async () => {
    const router = new Router();
    router.add('GET', '/data', defineRoute({ handler: () => ({}) }));
    const server = await startServer({
      port: 0,
      router,
      cors: { origins: ['http://allowed.com'] },
    });

    try {
      const res = await fetch(`${server.url}/data`, {
        headers: { origin: 'http://blocked.com' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await server.stop();
    }
  });
});
