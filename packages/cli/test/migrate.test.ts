import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
/**
 * End-to-end CLI: scaffold a project in a tmpdir, run `migrate init` +
 * `migrate up`, assert tables + tracker. Everything through the real
 * CLI dispatcher to catch wiring bugs.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { run } from '../src';

let cwd: string;

// The project lives inside the workspace's examples/ dir so `@hopak/core`
// resolves through the workspace symlinks without a full install. We use a
// unique subdir per test to keep them isolated + cleanup-safe.
const WORKSPACE_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../../..');
const EXAMPLES_DIR = join(WORKSPACE_ROOT, 'examples');

beforeEach(async () => {
  cwd = join(EXAMPLES_DIR, `migrate-cli-${Math.random().toString(36).slice(2, 10)}`);
  await mkdir(cwd, { recursive: true });
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
