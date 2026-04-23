/**
 * Live SQLite — indexes declared with `.index()` are actually created
 * and show up in `sqlite_master`. Sync is idempotent too (second call
 * is a no-op thanks to `CREATE INDEX IF NOT EXISTS`).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { type Database, createDatabase, model, number, text } from '../src';

let db: Database;

const listing = model('listing', {
  title: text().required(),
  sellerId: number().required().index(),
  slug: text().unique().index(),
  views: number().index(),
});

beforeEach(async () => {
  db = createDatabase({ dialect: 'sqlite', models: [listing] });
  await db.sync();
});

afterEach(async () => {
  await db.close();
});

function listIndexes(name: string): string[] {
  const drizzle = db.builder() as BunSQLiteDatabase;
  const rows = drizzle.all(
    sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ${name}`,
  ) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

describe('SQLite — `.index()` creates CREATE INDEX', () => {
  test('.index() fields appear in sqlite_master', () => {
    const indexes = listIndexes('listings');
    expect(indexes).toContain('idx_listings_sellerId');
    expect(indexes).toContain('idx_listings_views');
  });

  test('unique field does not double up (only the implicit unique index)', () => {
    const indexes = listIndexes('listings');
    expect(indexes).not.toContain('idx_listings_slug');
  });

  test('second sync is a no-op (IF NOT EXISTS)', async () => {
    await db.sync();
    await db.sync();
    const indexes = listIndexes('listings');
    const authorIdx = indexes.filter((n) => n === 'idx_listings_sellerId');
    expect(authorIdx).toHaveLength(1);
  });
});
