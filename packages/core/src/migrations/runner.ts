import type { DbDialect, Logger } from '@hopak/common';
import type { Database } from '../db/client';
import { createMigrationContext } from './context';
import { listApplied, recordApplied, recordRolledBack } from './tracker';
import type { AppliedMigration, Migration, MigrationContext, MigrationStatus } from './types';

export interface RunOptions {
  readonly db: Database;
  readonly dialect: DbDialect;
  readonly log?: Logger;
  /** If true, run `up`/`down` but skip the tracker write and any DB effects. */
  readonly dryRun?: boolean;
}

export interface UpOptions extends RunOptions {
  /** Stop after this id (inclusive). Default: apply everything pending. */
  readonly to?: string;
}

export interface DownOptions extends RunOptions {
  /** Roll back this many applied migrations (most recent first). Default 1. */
  readonly steps?: number;
  /** Roll back until (exclusive) this id has been removed. Takes precedence over `steps`. */
  readonly to?: string;
}

export interface ApplyResult {
  readonly applied: readonly string[];
  readonly rolledBack: readonly string[];
}

/**
 * Apply pending migrations in order. Each migration runs inside a
 * transaction if the dialect supports transactional DDL.
 *
 * - SQLite + Postgres: full transactional wrap — `up()` is atomic.
 * - MySQL: DDL auto-commits; `up()` runs without an outer tx. A failure
 *   partway through leaves partial state. The doc points users at the
 *   "one DDL per migration" pattern for MySQL.
 */
export async function applyUp(
  options: UpOptions,
  migrations: readonly Migration[],
): Promise<ApplyResult> {
  const { db, dialect, log, dryRun, to } = options;
  const applied = await listApplied(db, dialect);
  const appliedIds = new Set(applied.map((a) => a.id));

  const pending = migrations.filter((m) => !appliedIds.has(m.id));
  const targetIndex = to ? pending.findIndex((m) => m.id === to) : pending.length - 1;
  const slice = targetIndex >= 0 ? pending.slice(0, targetIndex + 1) : pending;

  const ran: string[] = [];
  for (const migration of slice) {
    log?.info(
      `Applying ${migration.id}${migration.description ? ` — ${migration.description}` : ''}`,
    );
    if (dryRun) {
      ran.push(migration.id);
      continue;
    }
    if (transactionalDialect(dialect)) {
      await db.transaction(async (tx) => {
        await migration.up(createMigrationContext(tx, dialect));
      });
    } else {
      await migration.up(createMigrationContext(db, dialect));
    }
    await recordApplied(db, dialect, migration.id);
    ran.push(migration.id);
  }
  return { applied: ran, rolledBack: [] };
}

/** Roll back the last N applied migrations (or back to a specific id). */
export async function applyDown(
  options: DownOptions,
  migrations: readonly Migration[],
): Promise<ApplyResult> {
  const { db, dialect, log, dryRun, steps, to } = options;
  const applied = await listApplied(db, dialect);
  const byId = new Map(migrations.map((m) => [m.id, m]));

  const reverseApplied = [...applied].reverse();
  const stepsCount = Math.max(1, steps ?? 1);
  const victims: AppliedMigration[] = [];
  for (const entry of reverseApplied) {
    if (to && entry.id === to) break;
    victims.push(entry);
    if (!to && victims.length >= stepsCount) break;
  }

  const rolledBack: string[] = [];
  for (const entry of victims) {
    const migration = byId.get(entry.id);
    if (!migration) {
      throw new Error(
        `Cannot roll back ${entry.id}: its file is missing from app/migrations/. Restore the file from git, or remove the row from _hopak_migrations manually.`,
      );
    }
    log?.info(`Rolling back ${migration.id}`);
    if (dryRun) {
      rolledBack.push(migration.id);
      continue;
    }
    if (transactionalDialect(dialect)) {
      await db.transaction(async (tx) => {
        await migration.down(createMigrationContext(tx, dialect));
      });
    } else {
      await migration.down(createMigrationContext(db, dialect));
    }
    await recordRolledBack(db, dialect, migration.id);
    rolledBack.push(migration.id);
  }
  return { applied: [], rolledBack };
}

/** Snapshot of applied / pending / missing for status display. */
export async function collectStatus(
  db: Database,
  dialect: DbDialect,
  migrations: readonly Migration[],
): Promise<MigrationStatus> {
  const applied = await listApplied(db, dialect);
  const appliedIds = new Set(applied.map((a) => a.id));
  const fileIds = new Set(migrations.map((m) => m.id));
  return {
    applied,
    pending: migrations.filter((m) => !appliedIds.has(m.id)),
    missing: applied.map((a) => a.id).filter((id) => !fileIds.has(id)),
  };
}

function transactionalDialect(dialect: DbDialect): boolean {
  // MySQL auto-commits most DDL, so wrapping in a transaction buys nothing
  // and hides the non-atomic behavior. SQLite + Postgres are transactional.
  return dialect !== 'mysql';
}

// Shared with users who want to pass `MigrationContext` typed helpers.
export type { MigrationContext };
