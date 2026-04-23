/**
 * Tests for `db.sql` (tagged-template SQL) + `db.builder()` (renamed from
 * `raw()`) across all three dialects. SQLite runs in-process; Postgres and
 * MySQL are gated on their respective env vars so a local `bun test` stays
 * green without those services.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getMysqlUrl, getPostgresUrl, resetMysql, resetPostgres } from '@hopak/testing';
import { type Database, createDatabase, model, number, text } from '../src';

const widget = model('widget', {
  name: text().required(),
  qty: number().default(0),
});

interface WidgetRow {
  id: number;
  name: string;
  qty: number;
}

describe('db.sql — SQLite', () => {
  let db: Database;

  beforeEach(async () => {
    db = createDatabase({ dialect: 'sqlite', models: [widget] });
    await db.sync();
    await db.model('widget').create({ name: 'alpha', qty: 10 });
    await db.model('widget').create({ name: 'beta', qty: 20 });
    await db.model('widget').create({ name: 'gamma', qty: 30 });
  });

  afterEach(async () => {
    await db.close();
  });

  test('plain tagged template (no interpolations)', async () => {
    const rows = await db.sql<WidgetRow>`SELECT * FROM widgets ORDER BY id ASC`;
    expect(rows).toHaveLength(3);
    expect(rows[0]?.name).toBe('alpha');
  });

  test('single interpolation becomes a bound parameter', async () => {
    const name = 'beta';
    const rows = await db.sql<WidgetRow>`SELECT * FROM widgets WHERE name = ${name}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.qty).toBe(20);
  });

  test('multiple interpolations', async () => {
    const lo = 15;
    const hi = 25;
    const rows = await db.sql<WidgetRow>`SELECT * FROM widgets WHERE qty > ${lo} AND qty < ${hi}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('beta');
  });

  test('SQL injection via interpolation stays inert', async () => {
    const attacker = "'; DROP TABLE widgets; --";
    const rows = await db.sql<WidgetRow>`SELECT * FROM widgets WHERE name = ${attacker}`;
    expect(rows).toHaveLength(0);
    const stillThere = await db.sql<WidgetRow>`SELECT COUNT(*) AS c FROM widgets`;
    expect(stillThere[0]).toBeTruthy();
  });

  test('write returns empty array', async () => {
    const out = await db.sql`UPDATE widgets SET qty = qty + 1 WHERE name = ${'alpha'}`;
    expect(out).toEqual([]);
    const [updated] = await db.sql<WidgetRow>`SELECT * FROM widgets WHERE name = 'alpha'`;
    expect(updated?.qty).toBe(11);
  });

  test('aggregate with GROUP BY returns typed rows', async () => {
    const rows = await db.sql<{ total: number }>`SELECT SUM(qty) AS total FROM widgets`;
    expect(Number(rows[0]?.total)).toBe(60);
  });

  test('db.builder() returns a callable drizzle client', async () => {
    const b = db.builder();
    expect(b).toBeDefined();
    expect(typeof b).toBe('object');
  });

  test('db.sql inside db.transaction — commit', async () => {
    await db.transaction(async (tx) => {
      await tx.sql`UPDATE widgets SET qty = 999 WHERE name = ${'alpha'}`;
      const [row] = await tx.sql<WidgetRow>`SELECT * FROM widgets WHERE name = ${'alpha'}`;
      expect(row?.qty).toBe(999);
    });
    const [after] = await db.sql<WidgetRow>`SELECT * FROM widgets WHERE name = ${'alpha'}`;
    expect(after?.qty).toBe(999);
  });

  test('db.sql inside db.transaction — rollback on throw', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.sql`UPDATE widgets SET qty = 777 WHERE name = ${'beta'}`;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const [after] = await db.sql<WidgetRow>`SELECT * FROM widgets WHERE name = ${'beta'}`;
    expect(after?.qty).toBe(20);
  });
});

const POSTGRES_URL = getPostgresUrl();
const describeIfPostgres = POSTGRES_URL ? describe : describe.skip;

describeIfPostgres('db.sql — Postgres', () => {
  let db: Database;

  beforeEach(async () => {
    await resetPostgres(POSTGRES_URL as string, ['widgets']);
    db = createDatabase({ dialect: 'postgres', models: [widget], url: POSTGRES_URL });
    await db.sync();
    await db.model('widget').create({ name: 'alpha', qty: 10 });
    await db.model('widget').create({ name: 'beta', qty: 20 });
    await db.model('widget').create({ name: 'gamma', qty: 30 });
  });

  afterEach(async () => {
    await db.close();
  });

  test('plain tagged template', async () => {
    const rows = await db.sql<WidgetRow>`SELECT * FROM widgets ORDER BY id ASC`;
    expect(rows).toHaveLength(3);
    expect(rows[0]?.name).toBe('alpha');
  });

  test('single interpolation becomes $1', async () => {
    const name = 'beta';
    const rows = await db.sql<WidgetRow>`SELECT * FROM widgets WHERE name = ${name}`;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.qty)).toBe(20);
  });

  test('multiple interpolations', async () => {
    const lo = 15;
    const hi = 25;
    const rows = await db.sql<WidgetRow>`SELECT * FROM widgets WHERE qty > ${lo} AND qty < ${hi}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('beta');
  });

  test('SQL injection inert', async () => {
    const attacker = "'; DROP TABLE widgets; --";
    const rows = await db.sql<WidgetRow>`SELECT * FROM widgets WHERE name = ${attacker}`;
    expect(rows).toHaveLength(0);
    const still = await db.sql<WidgetRow>`SELECT COUNT(*)::int AS c FROM widgets`;
    expect(still[0]).toBeTruthy();
  });

  test('write returns empty array', async () => {
    const out = await db.sql`UPDATE widgets SET qty = qty + 1 WHERE name = ${'alpha'}`;
    expect(out).toEqual([]);
    const [updated] = await db.sql<WidgetRow>`SELECT * FROM widgets WHERE name = 'alpha'`;
    expect(Number(updated?.qty)).toBe(11);
  });

  test('aggregate with GROUP BY returns typed rows', async () => {
    const rows = await db.sql<{ total: number }>`SELECT SUM(qty)::int AS total FROM widgets`;
    expect(Number(rows[0]?.total)).toBe(60);
  });

  test('db.builder() returns a callable drizzle client', async () => {
    const b = db.builder();
    expect(b).toBeDefined();
  });

  test('db.sql inside db.transaction — commit (drizzle fallback)', async () => {
    await db.transaction(async (tx) => {
      await tx.sql`UPDATE widgets SET qty = 999 WHERE name = ${'alpha'}`;
      const [row] = await tx.sql<WidgetRow>`SELECT * FROM widgets WHERE name = ${'alpha'}`;
      expect(Number(row?.qty)).toBe(999);
    });
    const [after] = await db.sql<WidgetRow>`SELECT * FROM widgets WHERE name = ${'alpha'}`;
    expect(Number(after?.qty)).toBe(999);
  });

  test('db.sql inside db.transaction — rollback on throw (drizzle fallback)', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.sql`UPDATE widgets SET qty = 777 WHERE name = ${'beta'}`;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const [after] = await db.sql<WidgetRow>`SELECT * FROM widgets WHERE name = ${'beta'}`;
    expect(Number(after?.qty)).toBe(20);
  });
});

const MYSQL_URL = getMysqlUrl();
const describeIfMysql = MYSQL_URL ? describe : describe.skip;

describeIfMysql('db.sql — MySQL', () => {
  let db: Database;

  beforeEach(async () => {
    await resetMysql(MYSQL_URL as string, ['widgets']);
    db = createDatabase({ dialect: 'mysql', models: [widget], url: MYSQL_URL });
    await db.sync();
    await db.model('widget').create({ name: 'alpha', qty: 10 });
    await db.model('widget').create({ name: 'beta', qty: 20 });
    await db.model('widget').create({ name: 'gamma', qty: 30 });
  });

  afterEach(async () => {
    await db.close();
  });

  test('plain tagged template', async () => {
    const rows = await db.sql<WidgetRow>`SELECT * FROM widgets ORDER BY id ASC`;
    expect(rows).toHaveLength(3);
    expect(rows[0]?.name).toBe('alpha');
  });

  test('single interpolation becomes ?', async () => {
    const name = 'beta';
    const rows = await db.sql<WidgetRow>`SELECT * FROM widgets WHERE name = ${name}`;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.qty)).toBe(20);
  });

  test('multiple interpolations', async () => {
    const lo = 15;
    const hi = 25;
    const rows = await db.sql<WidgetRow>`SELECT * FROM widgets WHERE qty > ${lo} AND qty < ${hi}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('beta');
  });

  test('SQL injection inert', async () => {
    const attacker = "'; DROP TABLE widgets; --";
    const rows = await db.sql<WidgetRow>`SELECT * FROM widgets WHERE name = ${attacker}`;
    expect(rows).toHaveLength(0);
    const still = await db.sql<{ c: number }>`SELECT COUNT(*) AS c FROM widgets`;
    expect(still[0]).toBeTruthy();
  });

  test('write returns empty array', async () => {
    const out = await db.sql`UPDATE widgets SET qty = qty + 1 WHERE name = ${'alpha'}`;
    expect(out).toEqual([]);
    const [updated] = await db.sql<WidgetRow>`SELECT * FROM widgets WHERE name = 'alpha'`;
    expect(Number(updated?.qty)).toBe(11);
  });

  test('aggregate with GROUP BY returns typed rows', async () => {
    const rows = await db.sql<{ total: number }>`SELECT SUM(qty) AS total FROM widgets`;
    expect(Number(rows[0]?.total)).toBe(60);
  });

  test('db.builder() returns a callable drizzle client', async () => {
    const b = db.builder();
    expect(b).toBeDefined();
  });

  test('db.sql inside db.transaction — commit (drizzle fallback)', async () => {
    await db.transaction(async (tx) => {
      await tx.sql`UPDATE widgets SET qty = 999 WHERE name = ${'alpha'}`;
      const [row] = await tx.sql<WidgetRow>`SELECT * FROM widgets WHERE name = ${'alpha'}`;
      expect(Number(row?.qty)).toBe(999);
    });
    const [after] = await db.sql<WidgetRow>`SELECT * FROM widgets WHERE name = ${'alpha'}`;
    expect(Number(after?.qty)).toBe(999);
  });

  test('db.sql inside db.transaction — rollback on throw (drizzle fallback)', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.sql`UPDATE widgets SET qty = 777 WHERE name = ${'beta'}`;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const [after] = await db.sql<WidgetRow>`SELECT * FROM widgets WHERE name = ${'beta'}`;
    expect(Number(after?.qty)).toBe(20);
  });
});
