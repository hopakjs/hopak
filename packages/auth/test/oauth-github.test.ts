import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Router, defineRoute, email, model, password as passwordField, text } from '@hopak/core';
import { type TestServer, createTestServer } from '@hopak/testing';
import { githubCallback, githubStart } from '../src/oauth/github';
import { signState } from '../src/oauth/state';

const user = model('user', {
  name: text().required().min(2),
  email: email().required().unique(),
  password: passwordField().required().min(8),
});

const SECRET = 'oauth-state-secret-long-enough';
const CALLBACK = 'http://localhost/api/auth/github/callback';

const originalFetch = globalThis.fetch;
const stubbedResponses: Array<(url: string) => Response | Promise<Response> | null> = [];

function stubFetch(matcher: (url: string) => Response | Promise<Response> | null): void {
  stubbedResponses.push(matcher);
}

beforeEach(() => {
  stubbedResponses.length = 0;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    for (const m of stubbedResponses) {
      const res = m(url);
      if (res) return Promise.resolve(res);
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof fetch;

  process.env.GITHUB_OAUTH_ID = 'test-id';
  process.env.GITHUB_OAUTH_SECRET = 'test-secret';
});

let env: TestServer;
afterEach(async () => {
  await env?.stop();
  globalThis.fetch = originalFetch;
});

async function bootstrap(): Promise<void> {
  const router = new Router();
  router.add(
    'GET',
    '/api/auth/github/start',
    defineRoute({ handler: githubStart({ callbackUrl: CALLBACK, stateSecret: SECRET }) }),
  );
  router.add(
    'GET',
    '/api/auth/github/callback',
    defineRoute({
      handler: githubCallback({
        model: user,
        stateSecret: SECRET,
        sign: async () => 'signed-jwt',
      }),
    }),
  );
  env = await createTestServer({ models: [user], router });
}

describe('githubStart', () => {
  test('redirects to github authorize with client_id + signed state', async () => {
    await bootstrap();
    const res = await fetch(`${env.url}/api/auth/github/start`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('github.com/login/oauth/authorize');
    expect(loc).toContain('client_id=test-id');
    expect(loc).toMatch(/state=[^&]+/);
  });
});

describe('githubCallback', () => {
  test('valid code+state → creates user, returns token', async () => {
    await bootstrap();

    stubFetch((url) =>
      url.includes('/login/oauth/access_token')
        ? Response.json({ access_token: 'gh-token' })
        : null,
    );
    stubFetch((url) =>
      url === 'https://api.github.com/user'
        ? Response.json({ id: 42, email: 'new@gh.com', name: 'New User' })
        : null,
    );

    const state = await signState(SECRET);
    const res = await env.client.get<{ token: string }>(
      `/api/auth/github/callback?code=abc&state=${encodeURIComponent(state)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.token).toBe('signed-jwt');

    const rows = await env
      .requireDb()
      .model('user')
      .findMany({ where: { email: 'new@gh.com' }, limit: 1 });
    expect(rows).toHaveLength(1);
  });

  test('tampered state → 401', async () => {
    await bootstrap();
    const res = await env.client.get('/api/auth/github/callback?code=abc&state=bogus');
    expect(res.status).toBe(401);
  });

  test('missing code → 401', async () => {
    await bootstrap();
    const state = await signState(SECRET);
    const res = await env.client.get(
      `/api/auth/github/callback?state=${encodeURIComponent(state)}`,
    );
    expect(res.status).toBe(401);
  });

  test('existing user (same email) → reuses row, fires token without onFirstLogin', async () => {
    await bootstrap();
    await env.requireDb().model('user').create({
      name: 'Existing',
      email: 'existing@gh.com',
      password: 'legacy-password-hash',
    });

    stubFetch((url) =>
      url.includes('/login/oauth/access_token')
        ? Response.json({ access_token: 'gh-token' })
        : null,
    );
    stubFetch((url) =>
      url === 'https://api.github.com/user'
        ? Response.json({ id: 7, email: 'existing@gh.com', name: 'GH Name' })
        : null,
    );

    const state = await signState(SECRET);
    const res = await env.client.get<{ token: string }>(
      `/api/auth/github/callback?code=c&state=${encodeURIComponent(state)}`,
    );
    expect(res.body.token).toBe('signed-jwt');

    const all = await env
      .requireDb()
      .model('user')
      .findMany({ where: { email: 'existing@gh.com' } });
    expect(all).toHaveLength(1);
  });
});
