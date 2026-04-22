import type { DbDialect } from '@hopak/common';
import type { Database } from '../db/client';
import type { MigrationContext } from './types';

/**
 * Build a `MigrationContext` bound to a specific `Database` and dialect.
 * The context is a thin facade — it just forwards `execute` to the DB
 * and exposes `db` for data migrations. No dialect-aware magic here;
 * the user writes SQL that fits their target DB.
 */
export function createMigrationContext(db: Database, dialect: DbDialect): MigrationContext {
  return {
    dialect,
    db,
    execute(sql, params) {
      return db.execute(sql, params);
    },
  };
}
