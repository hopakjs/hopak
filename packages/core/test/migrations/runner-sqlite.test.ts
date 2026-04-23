/**
 * End-to-end: apply → rollback → re-apply → status, all on an in-memory
 * SQLite. Exercises the tracker table, transactional wrap, and the
 * `missing file` reporting path.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  type Database,
  type Migration,
  applyDown,
  applyUp,
  collectStatus,
  createDatabase,
} from '../../src';

let db: Database;

const WIDGETS_UP = 'CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL)';
const WIDGETS_DOWN = 'DROP TABLE widgets';

const createWidgets: Migration = {
  id: '20260422T000000000_create_widgets',
  description: 'widgets table',
  async up(ctx) {
    await ctx.execute(WIDGETS_UP);
  },
  async down(ctx) {
    await ctx.execute(WIDGETS_DOWN);
  },
};

const addColor: Migration = {
  id: '20260422T000100000_add_color',
  async up(ctx) {
    await ctx.execute('ALTER TABLE widgets ADD COLUMN color TEXT');
  },
  async down(ctx) {
    await ctx.execute('ALTER TABLE widgets DROP COLUMN color');
  },
};

beforeEach(() => {
  db = createDatabase({ dialect: 'sqlite', models: [] });
});

afterEach(async () => {
  await db.close();
});

async function tableExists(name: string): Promise<boolean> {
  const { sql } = await import('drizzle-orm');
  const rows = (db.builder() as { all: (s: unknown) => unknown[] }).all(
    sql.raw(`SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`),
  ) as Array<{ name: string }>;
  return rows.length === 1;
}

describe('runner — apply / rollback / status (sqlite)', () => {
  test('apply creates the tracker table and runs migrations in order', async () => {
    const result = await applyUp({ db, dialect: 'sqlite' }, [createWidgets, addColor]);
    expect(result.applied).toEqual([createWidgets.id, addColor.id]);
    expect(await tableExists('widgets')).toBe(true);
    expect(await tableExists('_hopak_migrations')).toBe(true);
  });

  test('second apply is a no-op (already in tracker)', async () => {
    await applyUp({ db, dialect: 'sqlite' }, [createWidgets, addColor]);
    const second = await applyUp({ db, dialect: 'sqlite' }, [createWidgets, addColor]);
    expect(second.applied).toHaveLength(0);
  });

  test('rollback runs down() in reverse and clears tracker rows', async () => {
    await applyUp({ db, dialect: 'sqlite' }, [createWidgets, addColor]);
    const rolled = await applyDown({ db, dialect: 'sqlite' }, [createWidgets, addColor]);
    expect(rolled.rolledBack).toEqual([addColor.id]);
    // Re-apply should bring both back (the tracker row for addColor was removed).
    const reapplied = await applyUp({ db, dialect: 'sqlite' }, [createWidgets, addColor]);
    expect(reapplied.applied).toEqual([addColor.id]);
  });

  test('rollback with steps N rolls back multiple', async () => {
    await applyUp({ db, dialect: 'sqlite' }, [createWidgets, addColor]);
    const rolled = await applyDown({ db, dialect: 'sqlite', steps: 2 }, [createWidgets, addColor]);
    expect(rolled.rolledBack).toEqual([addColor.id, createWidgets.id]);
    expect(await tableExists('widgets')).toBe(false);
  });

  test('rollback throws when the migration file is missing', async () => {
    await applyUp({ db, dialect: 'sqlite' }, [createWidgets]);
    await expect(applyDown({ db, dialect: 'sqlite' }, [])).rejects.toThrow(/missing/);
  });

  test('dry-run does not write to the db', async () => {
    const result = await applyUp({ db, dialect: 'sqlite', dryRun: true }, [createWidgets]);
    expect(result.applied).toEqual([createWidgets.id]);
    expect(await tableExists('widgets')).toBe(false);
  });

  test('status reports applied + pending + missing', async () => {
    await applyUp({ db, dialect: 'sqlite' }, [createWidgets]);
    const status = await collectStatus(db, 'sqlite', [createWidgets, addColor]);
    expect(status.applied.map((a) => a.id)).toEqual([createWidgets.id]);
    expect(status.pending.map((p) => p.id)).toEqual([addColor.id]);
    expect(status.missing).toEqual([]);

    // With a migration file gone from the list but still in the tracker:
    const status2 = await collectStatus(db, 'sqlite', [addColor]);
    expect(status2.missing).toEqual([createWidgets.id]);
  });

  test('failing up() rolls back the transaction — widgets not left around', async () => {
    const broken: Migration = {
      id: '20260422T000200000_broken',
      async up(ctx) {
        await ctx.execute('CREATE TABLE leftovers (x TEXT)');
        throw new Error('boom');
      },
      async down() {},
    };
    await expect(applyUp({ db, dialect: 'sqlite' }, [broken])).rejects.toThrow(/boom/);
    expect(await tableExists('leftovers')).toBe(false);
  });
});
