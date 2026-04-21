import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger, pathExists } from '@hopak/common';
import { runGenerate } from '../src/commands/generate';
import { runNew } from '../src/commands/new';

let workDir: string;
const log = createLogger({ level: 'error' });

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'hopak-cli-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('hopak new', () => {
  test('creates project structure', async () => {
    const code = await runNew({ name: 'demo', cwd: workDir, log, noInstall: true });
    expect(code).toBe(0);
    expect(await pathExists(join(workDir, 'demo/package.json'))).toBe(true);
    expect(await pathExists(join(workDir, 'demo/main.ts'))).toBe(true);
    expect(await pathExists(join(workDir, 'demo/hopak.config.ts'))).toBe(true);
    expect(await pathExists(join(workDir, 'demo/app/models/post.ts'))).toBe(true);
    expect(await pathExists(join(workDir, 'demo/app/routes/index.ts'))).toBe(true);
    expect(await pathExists(join(workDir, 'demo/.gitignore'))).toBe(true);
  });

  test('refuses to overwrite existing directory', async () => {
    await mkdir(join(workDir, 'occupied'), { recursive: true });
    const code = await runNew({ name: 'occupied', cwd: workDir, log, noInstall: true });
    expect(code).toBe(1);
  });

  test('package.json contains @hopak/core dependency', async () => {
    await runNew({ name: 'pkg-test', cwd: workDir, log, noInstall: true });
    const pkg = JSON.parse(await readFile(join(workDir, 'pkg-test/package.json'), 'utf8'));
    expect(pkg.dependencies['@hopak/core']).toBeDefined();
    expect(pkg.devDependencies['@hopak/cli']).toBeDefined();
    expect(pkg.scripts.dev).toBe('hopak dev');
  });

  test('--db sqlite (default) does not ship a driver dep or DATABASE_URL', async () => {
    await runNew({ name: 'sqlite-app', cwd: workDir, log, noInstall: true });
    const pkg = JSON.parse(await readFile(join(workDir, 'sqlite-app/package.json'), 'utf8'));
    expect(pkg.dependencies.postgres).toBeUndefined();
    expect(pkg.dependencies.mysql2).toBeUndefined();
    const env = await readFile(join(workDir, 'sqlite-app/.env.example'), 'utf8');
    expect(env.includes('DATABASE_URL')).toBe(false);
    const cfg = await readFile(join(workDir, 'sqlite-app/hopak.config.ts'), 'utf8');
    expect(cfg).toContain("dialect: 'sqlite'");
  });

  test('--db postgres wires up config, env, and driver dep in one shot', async () => {
    await runNew({
      name: 'pg-app',
      cwd: workDir,
      log,
      noInstall: true,
      dialect: 'postgres',
    });
    const pkg = JSON.parse(await readFile(join(workDir, 'pg-app/package.json'), 'utf8'));
    expect(pkg.dependencies.postgres).toBeDefined();
    expect(pkg.dependencies.mysql2).toBeUndefined();
    const env = await readFile(join(workDir, 'pg-app/.env.example'), 'utf8');
    expect(env).toContain('DATABASE_URL=postgres://');
    const cfg = await readFile(join(workDir, 'pg-app/hopak.config.ts'), 'utf8');
    expect(cfg).toContain("dialect: 'postgres'");
    expect(cfg).toContain('process.env.DATABASE_URL');
  });

  test('--db mysql wires up mysql2 and mysql:// placeholder', async () => {
    await runNew({
      name: 'my-app',
      cwd: workDir,
      log,
      noInstall: true,
      dialect: 'mysql',
    });
    const pkg = JSON.parse(await readFile(join(workDir, 'my-app/package.json'), 'utf8'));
    expect(pkg.dependencies.mysql2).toBeDefined();
    const env = await readFile(join(workDir, 'my-app/.env.example'), 'utf8');
    expect(env).toContain('DATABASE_URL=mysql://');
    const cfg = await readFile(join(workDir, 'my-app/hopak.config.ts'), 'utf8');
    expect(cfg).toContain("dialect: 'mysql'");
  });
});

describe('hopak generate model', () => {
  test('creates model file', async () => {
    const code = await runGenerate({ kind: 'model', name: 'comment', cwd: workDir, log });
    expect(code).toBe(0);
    const path = join(workDir, 'app/models/comment.ts');
    expect(await pathExists(path)).toBe(true);
    const content = await readFile(path, 'utf8');
    expect(content).toContain("'comment'");
    expect(content).toContain('text().required()');
  });

  test('refuses to overwrite existing model', async () => {
    await mkdir(join(workDir, 'app/models'), { recursive: true });
    await writeFile(join(workDir, 'app/models/already.ts'), '// existing\n', 'utf8');
    const code = await runGenerate({ kind: 'model', name: 'already', cwd: workDir, log });
    expect(code).toBe(1);
  });
});

describe('hopak generate route', () => {
  test('creates route at given path', async () => {
    const code = await runGenerate({
      kind: 'route',
      name: 'posts/[id]',
      cwd: workDir,
      log,
    });
    expect(code).toBe(0);
    const path = join(workDir, 'app/routes/posts/[id].ts');
    expect(await pathExists(path)).toBe(true);
    const content = await readFile(path, 'utf8');
    expect(content).toContain('defineRoute');
    expect(content).toContain('export const GET');
  });

  test('strips leading slashes and .ts suffix', async () => {
    await runGenerate({ kind: 'route', name: '/api/health.ts', cwd: workDir, log });
    expect(await pathExists(join(workDir, 'app/routes/api/health.ts'))).toBe(true);
  });
});

describe('hopak generate crud', () => {
  test('scaffolds the collection + item route files for a model', async () => {
    const code = await runGenerate({ kind: 'crud', name: 'post', cwd: workDir, log });
    expect(code).toBe(0);
    const collection = await readFile(join(workDir, 'app/routes/api/posts.ts'), 'utf8');
    const item = await readFile(join(workDir, 'app/routes/api/posts/[id].ts'), 'utf8');
    expect(collection).toContain('crud.list(post)');
    expect(collection).toContain('crud.create(post)');
    expect(item).toContain('crud.read(post)');
    expect(item).toContain('crud.update(post)');
    expect(item).toContain('crud.patch(post)');
    expect(item).toContain('crud.remove(post)');
  });

  test('refuses to overwrite existing collection file', async () => {
    await runGenerate({ kind: 'crud', name: 'widget', cwd: workDir, log });
    const second = await runGenerate({ kind: 'crud', name: 'widget', cwd: workDir, log });
    expect(second).toBe(1);
  });
});

describe('hopak generate unknown', () => {
  test('returns error for unknown kind', async () => {
    const code = await runGenerate({ kind: 'monkey', name: 'x', cwd: workDir, log });
    expect(code).toBe(1);
  });
});
