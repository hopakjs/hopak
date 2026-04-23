import type { DbDialect } from '@hopak/common';
import type { Database } from '../db/client';
import type { MigrationContext } from './types';

/**
 * Build a `MigrationContext` bound to a specific `Database` and dialect.
 * The context is a thin facade — `sql` and (deprecated) `execute` forward
 * to the DB, and `db` is exposed for data migrations.
 */
export function createMigrationContext(db: Database, dialect: DbDialect): MigrationContext {
  return {
    dialect,
    db,
    sql(strings, ...values) {
      return db.sql(strings, ...values);
    },
    /** @deprecated Use `ctx.sql\`...\`` — see migrations/types.ts. */
    execute(sql, params) {
      return db.execute(sql, params);
    },
  };
}
