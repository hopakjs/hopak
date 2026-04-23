import type { DbDialect } from '@hopak/common';
import type { Database } from '../db/client';

/**
 * What a migration file receives. Dialect-specific SQL goes through
 * `sql` (the tagged-template API — reads + writes, with bound
 * interpolations); data migrations use `db` (the full Hopak client —
 * models, transactions, everything).
 */
export interface MigrationContext {
  readonly dialect: DbDialect;
  readonly db: Database;
  /**
   * Tagged-template SQL. Interpolations are parameterised, identifiers
   * stay inline. Preferred entry point for DDL + arbitrary statements.
   *
   * ```ts
   * await ctx.sql`ALTER TABLE post ADD COLUMN views INTEGER NOT NULL DEFAULT 0`;
   * await ctx.sql`UPDATE post SET published = true WHERE author_id = ${userId}`;
   * ```
   */
  sql<T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<readonly T[]>;
  /**
   * @deprecated Use `ctx.sql\`...\`` — see migrations/types.ts. The forwarder
   * stays in 0.5.0 so existing migration files keep compiling; it will be
   * removed in 0.6.0.
   */
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
