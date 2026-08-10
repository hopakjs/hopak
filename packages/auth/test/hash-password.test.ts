import { describe, expect, test } from 'bun:test';
import { Router, defineRoute, email, model, password as passwordField, text } from '@hopak/core';
import { type TestServer, createTestServer } from '@hopak/testing';
import { credentialsLogin, credentialsSignup, hashPassword, isHashed } from '../src/jwt';

describe('hashPassword', () => {
  test('hashes plaintext', async () => {
    const hashed = await hashPassword('plaintext-pw');
    expect(isHashed(hashed)).toBe(true);
    expect(await Bun.password.verify('plaintext-pw', hashed)).toBe(true);
  });

  test('is idempotent on an already-hashed value', async () => {
    const once = await hashPassword('plaintext-pw');
    const twice = await hashPassword(once);
    expect(twice).toBe(once);
  });

  test('recognises bcrypt hashes too', () => {
    expect(isHashed('$2b$10$abcdefghijklmnopqrstuv')).toBe(true);
    expect(isHashed('hunter2')).toBe(false);
  });
});

describe('credentialsSignup + a hashing beforeCreate hook', () => {
  test('password is hashed exactly once, so login works', async () => {
    // The documented way to hash is a model hook. credentialsSignup also
    // hashes — this is the collision that must not double-hash.
    const user = model(
      'user',
      {
        name: text().required(),
        email: email().required().unique(),
        password: passwordField().required().min(8),
      },
      {
        hooks: {
          async beforeCreate(data) {
            return { ...data, password: await hashPassword(String(data.password)) };
          },
        },
      },
    );

    const router = new Router();
    router.add(
      'POST',
      '/signup',
      defineRoute({ handler: credentialsSignup({ model: user, sign: async () => 'tok' }) }),
    );
    router.add(
      'POST',
      '/login',
      defineRoute({ handler: credentialsLogin({ model: user, sign: async () => 'tok' }) }),
    );

    let env: TestServer | undefined;
    try {
      env = await createTestServer({ models: [user], router });
      const signup = await env.client.post('/signup', {
        name: 'Grace',
        email: 'grace@example.com',
        password: 'hopper-secret',
      });
      expect(signup.status).toBe(200);

      const login = await env.client.post<{ token: string }>('/login', {
        email: 'grace@example.com',
        password: 'hopper-secret',
      });
      expect(login.status).toBe(200);
      expect(login.body.token).toBe('tok');

      const [row] = await env.requireDb().model('user').findMany({ limit: 1 });
      expect(await Bun.password.verify('hopper-secret', String(row?.password))).toBe(true);
    } finally {
      await env?.stop();
    }
  });
});
