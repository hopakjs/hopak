import type { ModelDefinition } from '../../model/define';
import {
  type DialectDdlOps,
  adapterDdlFor,
  buildCreateTableSql as buildCreateTableSqlGeneric,
  syncSchemaGeneric,
} from '../sql/ddl-emitter';

/** Narrow view of the mysql2 pool / connection surface actually used. */
export interface MysqlRunner {
  query(sql: string): Promise<unknown>;
}

/**
 * Prefix for the `UNIQUE KEY (col(N))` clause on TEXT columns. 191 matches
 * the default utf8mb4 key-length ceiling across MySQL 5.7+ and MariaDB;
 * choosing 255 breaks on legacy configurations.
 */
const TEXT_UNIQUE_PREFIX = 191;

export const ops: DialectDdlOps = {
  quote: (id) => `\`${id}\``,
  idClause: '`id` INT AUTO_INCREMENT PRIMARY KEY',
  timestampClauses: [
    '`created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)',
    '`updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)',
  ],
  ddlFor: (field) => adapterDdlFor(field, 'mysql'),
  // MySQL can't emit inline `UNIQUE` on TEXT columns without a prefix length,
  // so the shared emitter falls through to a `UNIQUE KEY (col(N))` constraint.
  supportsInlineUnique: false,
  textUniquePrefix: TEXT_UNIQUE_PREFIX,
  emitForeignKeys: true,
  run: async (runner, sql) => {
    await (runner as MysqlRunner).query(sql);
  },
};

export function buildCreateTableSql(model: ModelDefinition): string {
  return buildCreateTableSqlGeneric(model, ops);
}

export async function syncMysqlSchema(
  runner: MysqlRunner,
  models: readonly ModelDefinition[],
): Promise<void> {
  await syncSchemaGeneric(runner, models, ops);
}
