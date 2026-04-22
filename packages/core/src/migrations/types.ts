import type { DbDialect } from '@hopak/common';
import type { Database } from '../db/client';

/**
 * What a migration file receives. Dialect-specific SQL goes through
 * `execute` (DDL + arbitrary statements); data migrations use `db`
 * (the full Hopak client — models, transactions, everything).
 */
export interface MigrationContext {
  readonly dialect: DbDialect;
  readonly db: Database;
  execute(sql: string, params?: readonly unknown[]): Promise<void>;
}

/** Shape of an `app/migrations/<id>.ts` file. */
export interface Migration {
  /** Filename without `.ts` — e.g. `20260422T153012_add_role`. */
  readonly id: string;
  /** Optional free-form description from the file's `export const description`. */
  readonly description?: string;
  up(ctx: MigrationContext): Promise<void>;
  down(ctx: MigrationContext): Promise<void>;
}

export interface AppliedMigration {
  readonly id: string;
  readonly appliedAt: number;
}

export interface MigrationStatus {
  /** Applied migrations in order of application. */
  readonly applied: readonly AppliedMigration[];
  /** Migration files on disk that haven't run yet. */
  readonly pending: readonly Migration[];
  /** Applied migrations whose files are missing from disk. */
  readonly missing: readonly string[];
}
