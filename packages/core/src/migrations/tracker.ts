import type { DbDialect } from '@hopak/common';
import { sql as drizzleSql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { AppliedMigration } from './types';

/**
 * CRUD for the `_hopak_migrations` tracking table. Two columns only:
 * `id` (filename-without-ext) and `applied_at` (unix ms). The table is
 * created lazily on first write.
 */

const TABLE = '_hopak_migrations';

interface DialectSql {
  create: string;
  list: string;
  insert: string;
  remove: string;
}

const SQL: Record<DbDialect, DialectSql> = {
  sqlite: {
    create: `CREATE TABLE IF NOT EXISTS "${TABLE}" (
      "id" TEXT PRIMARY KEY,
      "applied_at" INTEGER NOT NULL
    )`,
    list: `SELECT "id", "applied_at" FROM "${TABLE}" ORDER BY "id" ASC`,
    insert: `INSERT INTO "${TABLE}" ("id", "applied_at") VALUES (?, ?)`,
    remove: `DELETE FROM "${TABLE}" WHERE "id" = ?`,
  },
  postgres: {
    create: `CREATE TABLE IF NOT EXISTS "${TABLE}" (
      "id" TEXT PRIMARY KEY,
      "applied_at" BIGINT NOT NULL
    )`,
    list: `SELECT "id", "applied_at" FROM "${TABLE}" ORDER BY "id" ASC`,
    insert: `INSERT INTO "${TABLE}" ("id", "applied_at") VALUES ($1, $2)`,
    remove: `DELETE FROM "${TABLE}" WHERE "id" = $1`,
  },
  mysql: {
    create: `CREATE TABLE IF NOT EXISTS \`${TABLE}\` (
      \`id\` VARCHAR(128) PRIMARY KEY,
      \`applied_at\` BIGINT NOT NULL
    )`,
    list: `SELECT \`id\`, \`applied_at\` FROM \`${TABLE}\` ORDER BY \`id\` ASC`,
    insert: `INSERT INTO \`${TABLE}\` (\`id\`, \`applied_at\`) VALUES (?, ?)`,
    remove: `DELETE FROM \`${TABLE}\` WHERE \`id\` = ?`,
  },
};

export async function ensureTrackerTable(db: Database, dialect: DbDialect): Promise<void> {
  await db.execute(SQL[dialect].create);
}

export async function listApplied(
  db: Database,
  dialect: DbDialect,
): Promise<readonly AppliedMigration[]> {
  await ensureTrackerTable(db, dialect);
  const raw = db.raw() as {
    all?: (sql: unknown) => unknown[];
    execute?: (sql: unknown) => Promise<unknown>;
  };
  // Read-only path goes through the raw driver because `Database.execute` is
  // write-only. Rather than wiring a full `query` method onto the interface,
  // we reach for `raw()` here — this is the only read from the tracker.
  const sqlText = SQL[dialect].list;
  const rows = await runSelect(raw, dialect, sqlText);
  return rows.map((r) => ({
    id: String(r.id),
    appliedAt: Number(r.applied_at),
  }));
}

export async function recordApplied(db: Database, dialect: DbDialect, id: string): Promise<void> {
  await ensureTrackerTable(db, dialect);
  await db.execute(SQL[dialect].insert, [id, Date.now()]);
}

export async function recordRolledBack(
  db: Database,
  dialect: DbDialect,
  id: string,
): Promise<void> {
  await ensureTrackerTable(db, dialect);
  await db.execute(SQL[dialect].remove, [id]);
}

interface Row {
  id: unknown;
  applied_at: unknown;
}

async function runSelect(
  raw: {
    all?: (sql: unknown) => unknown[];
    execute?: (sql: unknown) => Promise<unknown>;
  },
  dialect: DbDialect,
  sqlText: string,
): Promise<Row[]> {
  if (dialect === 'sqlite') {
    return (raw.all?.(drizzleSql.raw(sqlText)) ?? []) as Row[];
  }
  // postgres + mysql: drizzle's `.execute(sql)` returns a result whose rows
  // live under `.rows` (pg) or directly as `[rows, fields]` (mysql2).
  const result = await raw.execute?.(drizzleSql.raw(sqlText));
  if (!result) return [];
  if (Array.isArray(result)) return (result[0] ?? []) as Row[];
  return (result as { rows?: Row[] }).rows ?? [];
}
