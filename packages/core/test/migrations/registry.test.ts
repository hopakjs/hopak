import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMigrations, newMigrationId } from '../../src';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hopak-mig-registry-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('newMigrationId', () => {
  test('timestamp + slug shape', () => {
    const id = newMigrationId('Add User Role', new Date('2026-04-22T15:30:12.345Z'));
    expect(id).toBe('20260422T153012345_add_user_role');
  });

  test('rejects empty / punctuation-only names', () => {
    expect(() => newMigrationId('')).toThrow();
    expect(() => newMigrationId('???')).toThrow();
  });
});

describe('loadMigrations', () => {
  test('returns empty when dir does not exist', async () => {
    const result = await loadMigrations(join(dir, 'nope'));
    expect(result.migrations).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test('loads + sorts by id; surfaces bad files as errors', async () => {
    await Bun.write(
      join(dir, '20260422T100000000_alpha.ts'),
      `export const description = 'first';
export async function up() {}
export async function down() {}
`,
    );
    await Bun.write(
      join(dir, '20260422T110000000_bravo.ts'),
      `export async function up() {}
export async function down() {}
`,
    );
    await Bun.write(
      join(dir, '20260422T120000000_broken.ts'),
      `export const description = 'missing up/down';
`,
    );

    const result = await loadMigrations(dir);
    expect(result.migrations.map((m) => m.id)).toEqual([
      '20260422T100000000_alpha',
      '20260422T110000000_bravo',
    ]);
    expect(result.migrations[0]?.description).toBe('first');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('up');
  });
});
