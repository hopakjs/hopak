import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathExists } from '@hopak/common';
import { createLogger } from '@hopak/common';
import { authHandler } from '../src/use/auth-handler';

/**
 * Auth install shells out to `bun add`, which we can't do from an
 * isolated temp dir. These tests cover the file-scaffolding /
 * env-patching surface only — the subprocess is exercised live in
 * acceptance.
 */

const PROJECT_PKG = JSON.stringify({ name: 'demo', version: '0.0.1', dependencies: {} }, null, 2);

const originalBunSpawn = Bun.spawn;

describe('authHandler.install (scaffolding)', () => {
  const log = createLogger({ level: 'warn' });
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'hopak-use-auth-'));
    await writeFile(join(root, 'package.json'), PROJECT_PKG, 'utf8');
    await writeFile(join(root, '.env.example'), '# secrets here\n', 'utf8');
    // Stub `bun add` so tests don't touch the network or real package tree.
    Bun.spawn = ((_opts: Parameters<typeof Bun.spawn>[0]) =>
      ({ exited: Promise.resolve(0) }) as unknown as ReturnType<
        typeof Bun.spawn
      >) as typeof Bun.spawn;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    Bun.spawn = originalBunSpawn;
  });

  test('creates middleware, routes, user model, and JWT_SECRET env entry', async () => {
    const outcome = await authHandler.install({ root, log });
    expect(outcome.status).toBe('ok');

    expect(await pathExists(join(root, 'app/middleware/auth.ts'))).toBe(true);
    expect(await pathExists(join(root, 'app/routes/api/auth/signup.ts'))).toBe(true);
    expect(await pathExists(join(root, 'app/routes/api/auth/login.ts'))).toBe(true);
    expect(await pathExists(join(root, 'app/routes/api/auth/me.ts'))).toBe(true);
    expect(await pathExists(join(root, 'app/models/user.ts'))).toBe(true);

    const envExample = await readFile(join(root, '.env.example'), 'utf8');
    expect(envExample).toContain('JWT_SECRET');
  });

  test('re-uses existing user model instead of overwriting', async () => {
    const customUser =
      "import { model, text } from '@hopak/core';\nexport default model('user', { handle: text() });\n";
    await mkdir(join(root, 'app/models'), { recursive: true });
    await writeFile(join(root, 'app/models/user.ts'), customUser, 'utf8');
    const outcome = await authHandler.install({ root, log });
    expect(outcome.status).toBe('ok');
    const kept = await readFile(join(root, 'app/models/user.ts'), 'utf8');
    expect(kept).toBe(customUser);
  });

  test('conflicts if auth middleware already exists', async () => {
    await mkdir(join(root, 'app/middleware'), { recursive: true });
    await writeFile(join(root, 'app/middleware/auth.ts'), '// existing\n', 'utf8');
    const outcome = await authHandler.install({ root, log });
    expect(outcome.status).toBe('conflict');
  });

  test('missing package.json → error', async () => {
    await rm(join(root, 'package.json'));
    const outcome = await authHandler.install({ root, log });
    expect(outcome.status).toBe('error');
  });
});
