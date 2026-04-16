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
    const code = await runNew({ name: 'demo', cwd: workDir, log });
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
    const code = await runNew({ name: 'occupied', cwd: workDir, log });
    expect(code).toBe(1);
  });

  test('package.json contains @hopak/core dependency', async () => {
    await runNew({ name: 'pkg-test', cwd: workDir, log });
    const pkg = JSON.parse(await readFile(join(workDir, 'pkg-test/package.json'), 'utf8'));
    expect(pkg.dependencies['@hopak/core']).toBeDefined();
    expect(pkg.devDependencies['@hopak/cli']).toBeDefined();
    expect(pkg.scripts.dev).toBe('hopak dev');
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
    expect(content).toContain('crud: true');
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

describe('hopak generate unknown', () => {
  test('returns error for unknown kind', async () => {
    const code = await runGenerate({ kind: 'monkey', name: 'x', cwd: workDir, log });
    expect(code).toBe(1);
  });
});
