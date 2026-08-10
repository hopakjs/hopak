import type { DbDialect } from '@hopak/common';
import type { Database } from '../db/client';
import type { MigrationContext } from './types';

/**
 * Every dialect class keeps a statement runner for migration files even
 * though it left the public `Database` interface in 1.0 — migration DDL
 * is dynamic SQL text, which the tagged template deliberately refuses.
 */
interface StatementRunner {
  execute(sql: string, params?: readonly unknown[]): Promise<void>;
}

/**
 * Build a `MigrationContext` bound to a specific `Database` and dialect.
 * The context is a thin facade — `sql` and `execute` forward to the DB,
 * and `db` is exposed for data migrations.
 */
export function createMigrationContext(db: Database, dialect: DbDialect): MigrationContext {
  const runner = db as Database & StatementRunner;
  return {
    dialect,
    db,
    sql(strings, ...values) {
      return db.sql(strings, ...values);
    },
    execute(sql, params) {
      return runner.execute(sql, params);
    },
  };
}
