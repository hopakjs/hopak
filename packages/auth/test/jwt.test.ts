import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Router, defineRoute, email, model, password as passwordField, text } from '@hopak/core';
import { type TestServer, createTestServer } from '@hopak/testing';
import { credentialsLogin, credentialsSignup, jwtAuth } from '../src';

const user = model('user', {
  name: text().required().min(2),
  email: email().required().unique(),
  password: passwordField().required().min(8),
});

const SECRET = 'test-secret-must-be-long-enough-for-HS256';

let env: TestServer;
let auth: ReturnType<typeof jwtAuth>;

beforeEach(async () => {
  auth = jwtAuth({ secret: SECRET });

  const router = new Router();
  router.add(
    'POST',
    '/signup',
    defineRoute({ handler: credentialsSignup({ model: user, sign: auth.signToken }) }),
  );
  router.add(
    'POST',
    '/login',
    defineRoute({ handler: credentialsLogin({ model: user, sign: auth.signToken }) }),
  );
  router.add(
    'GET',
    '/me',
    defineRoute({ before: [auth.requireAuth()], handler: (ctx) => ctx.user }),
  );

  env = await createTestServer({ models: [user], router });
});

afterEach(() => env.stop());

describe('credentialsSignup', () => {
  test('hashes password, returns user + token, strips password', async () => {
    const res = await env.client.post<{
      user: { password?: string; email: string };
      token: string;
    }>('/signup', { name: 'Alice', email: 'a@b.com', password: 'secret123' });
    expect(res.body.user.email).toBe('a@b.com');
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.token).toMatch(/^eyJ/);
  });

  test('invalid body returns 400 with per-field details', async () => {
    const res = await env.client.post<{ error: string; details: Record<string, string[]> }>(
      '/signup',
      { name: 'X', email: 'nope', password: 'short' },
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.details.email).toBeDefined();
    expect(res.body.details.password).toBeDefined();
  });
});

describe('credentialsLogin', () => {
  async function seed(): Promise<void> {
    await env.client.post('/signup', { name: 'Alice', email: 'a@b.com', password: 'secret123' });
  }

  test('correct credentials → token', async () => {
    await seed();
    const res = await env.client.post<{ token: string }>('/login', {
      email: 'a@b.com',
      password: 'secret123',
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^eyJ/);
  });

  test('wrong password → 401', async () => {
    await seed();
    const res = await env.client.post('/login', { email: 'a@b.com', password: 'WRONG' });
    expect(res.status).toBe(401);
  });

  test('unknown user → 401', async () => {
    const res = await env.client.post('/login', { email: 'nope@x.com', password: 'secret123' });
    expect(res.status).toBe(401);
  });
});

describe('requireAuth', () => {
  test('no header → 401', async () => {
    const res = await env.client.get('/me');
    expect(res.status).toBe(401);
  });

  test('garbage token → 401', async () => {
    const res = await env.client.get('/me', { headers: { authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  test('valid token → populates ctx.user with id (and role if configured)', async () => {
    const signup = await env.client.post<{ user: { id: number }; token: string }>('/signup', {
      name: 'Alice',
      email: 'a@b.com',
      password: 'secret123',
    });
    const res = await env.client.get<{ id: number }>('/me', {
      headers: { authorization: `Bearer ${signup.body.token}` },
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(signup.body.user.id);
  });

  test('rejects token signed with a different algorithm', async () => {
    // Build a token with HS384 while the server is pinned to HS256.
    // jose should refuse it outright instead of happily verifying.
    const { SignJWT } = await import('jose');
    const otherAlg = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS384' })
      .setSubject('999')
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(new TextEncoder().encode(SECRET));
    const res = await env.client.get('/me', {
      headers: { authorization: `Bearer ${otherAlg}` },
    });
    expect(res.status).toBe(401);
  });
});
