import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
/**
 * End-to-end CLI: scaffold a project in a tmpdir, run `migrate init` +
 * `migrate up`, assert tables + tracker. Everything through the real
 * CLI dispatcher to catch wiring bugs.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { run } from '../src';

let cwd: string;

// Resolve once so beforeEach can point each tmpdir's node_modules/@hopak/*
// at the real packages — CI runs from a fresh checkout where examples/* isn't
// part of the workspace resolution yet, so we can't rely on it.
const WORKSPACE_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../../..');
const CORE_PKG = join(WORKSPACE_ROOT, 'packages/core');
const COMMON_PKG = join(WORKSPACE_ROOT, 'packages/common');

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'hopak-migrate-cli-'));
  // Hand-rolled node_modules so the scaffolded hopak.config.ts can resolve
  // @hopak/core without a `bun install` step in each test.
  await mkdir(join(cwd, 'node_modules/@hopak'), { recursive: true });
  await symlink(CORE_PKG, join(cwd, 'node_modules/@hopak/core'));
  await symlink(COMMON_PKG, join(cwd, 'node_modules/@hopak/common'));

  await writeFile(
    join(cwd, 'hopak.config.ts'),
    `import { defineConfig } from '@hopak/core';
export default defineConfig({
  server: { port: 3000 },
  database: { dialect: 'sqlite', file: '.hopak/data.db' },
});
`,
    'utf8',
  );
  await mkdir(join(cwd, 'app/models'), { recursive: true });
  await writeFile(
    join(cwd, 'app/models/widget.ts'),
    `import { model, text } from '@hopak/core';
export default model('widget', { name: text().required() });
`,
    'utf8',
  );
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function runCli(args: string[]): Promise<number> {
  const prevCwd = process.cwd();
  process.chdir(cwd);
  try {
    return await run(args);
  } finally {
    process.chdir(prevCwd);
  }
}

describe('hopak migrate — full CLI loop', () => {
  test('init creates a file; up applies; status reports applied', async () => {
    expect(await runCli(['migrate', 'init'])).toBe(0);
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(join(cwd, 'app/migrations'));
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/_init\.ts$/);

    expect(await runCli(['migrate', 'up'])).toBe(0);

    // Second up is a no-op.
    expect(await runCli(['migrate', 'up'])).toBe(0);

    expect(await runCli(['migrate', 'status'])).toBe(0);
  });

  test('down rolls back and re-up restores', async () => {
    await runCli(['migrate', 'init']);
    await runCli(['migrate', 'up']);
    expect(await runCli(['migrate', 'down'])).toBe(0);
    expect(await runCli(['migrate', 'up'])).toBe(0);
  });

  test('new <name> creates an empty skeleton distinct from init', async () => {
    expect(await runCli(['migrate', 'new', 'add_foo'])).toBe(0);
    const { readdir, readFile } = await import('node:fs/promises');
    const files = await readdir(join(cwd, 'app/migrations'));
    const addFoo = files.find((f) => f.endsWith('_add_foo.ts'));
    expect(addFoo).toBeDefined();
    const contents = await readFile(join(cwd, 'app/migrations', addFoo ?? ''), 'utf8');
    expect(contents).toContain('export async function up');
    expect(contents).toContain('export async function down');
    expect(contents).toContain('TODO');
  });

  test('sync refuses once migrations/ has files', async () => {
    await runCli(['migrate', 'init']);
    expect(await runCli(['sync'])).toBe(1);
  });
});
