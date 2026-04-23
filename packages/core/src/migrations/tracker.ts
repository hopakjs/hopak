import type { DbDialect } from '@hopak/common';
import type { Database } from '../db/client';
import type { AppliedMigration } from './types';

/**
 * CRUD for the `_hopak_migrations` tracking table. Two columns only:
 * `id` (filename-without-ext) and `applied_at` (unix ms). The table is
 * created lazily on first write.
 *
 * All SQL routes through `db.sql` — interpolations are parameterised,
 * DDL / identifiers are inlined per dialect.
 */

interface TrackerRow {
  readonly id: unknown;
  readonly applied_at: unknown;
}

export async function ensureTrackerTable(db: Database, dialect: DbDialect): Promise<void> {
  if (dialect === 'mysql') {
    await db.sql`CREATE TABLE IF NOT EXISTS \`_hopak_migrations\` (
      \`id\` VARCHAR(128) PRIMARY KEY,
      \`applied_at\` BIGINT NOT NULL
    )`;
    return;
  }
  if (dialect === 'postgres') {
    await db.sql`CREATE TABLE IF NOT EXISTS "_hopak_migrations" (
      "id" TEXT PRIMARY KEY,
      "applied_at" BIGINT NOT NULL
    )`;
    return;
  }
  await db.sql`CREATE TABLE IF NOT EXISTS "_hopak_migrations" (
    "id" TEXT PRIMARY KEY,
    "applied_at" INTEGER NOT NULL
  )`;
}

export async function listApplied(
  db: Database,
  dialect: DbDialect,
): Promise<readonly AppliedMigration[]> {
  await ensureTrackerTable(db, dialect);
  const rows =
    dialect === 'mysql'
      ? await db.sql<TrackerRow>`SELECT \`id\`, \`applied_at\` FROM \`_hopak_migrations\` ORDER BY \`id\` ASC`
      : await db.sql<TrackerRow>`SELECT "id", "applied_at" FROM "_hopak_migrations" ORDER BY "id" ASC`;
  return rows.map((r) => ({
    id: String(r.id),
    appliedAt: Number(r.applied_at),
  }));
}

export async function recordApplied(db: Database, dialect: DbDialect, id: string): Promise<void> {
  await ensureTrackerTable(db, dialect);
  const now = Date.now();
  if (dialect === 'mysql') {
    await db.sql`INSERT INTO \`_hopak_migrations\` (\`id\`, \`applied_at\`) VALUES (${id}, ${now})`;
    return;
  }
  await db.sql`INSERT INTO "_hopak_migrations" ("id", "applied_at") VALUES (${id}, ${now})`;
}

export async function recordRolledBack(
  db: Database,
  dialect: DbDialect,
  id: string,
): Promise<void> {
  await ensureTrackerTable(db, dialect);
  if (dialect === 'mysql') {
    await db.sql`DELETE FROM \`_hopak_migrations\` WHERE \`id\` = ${id}`;
    return;
  }
  await db.sql`DELETE FROM "_hopak_migrations" WHERE "id" = ${id}`;
}
