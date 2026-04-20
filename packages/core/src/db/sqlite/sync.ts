import type { Database as BunDatabase } from 'bun:sqlite';
import type { ModelDefinition } from '../../model/define';
import {
  type DialectDdlOps,
  adapterDdlFor,
  buildCreateTableSql as buildCreateTableSqlGeneric,
  syncSchemaGeneric,
} from '../sql/ddl-emitter';

const ops: DialectDdlOps = {
  quote: (id) => `"${id}"`,
  idClause: '"id" INTEGER PRIMARY KEY AUTOINCREMENT',
  timestampClauses: [
    '"created_at" INTEGER NOT NULL DEFAULT (unixepoch())',
    '"updated_at" INTEGER NOT NULL DEFAULT (unixepoch())',
  ],
  ddlFor: (field) => adapterDdlFor(field, 'sqlite'),
  supportsInlineUnique: true,
  // Preserves existing behavior: SQLite has `foreign_keys` OFF by default,
  // and previous versions skipped `FOREIGN KEY` entirely. Flip to `true` to
  // turn FK enforcement on by default in a future release.
  emitForeignKeys: false,
  run: async (runner, sql) => {
    (runner as BunDatabase).run(sql);
  },
};

export function buildCreateTableSql(model: ModelDefinition): string {
  return buildCreateTableSqlGeneric(model, ops);
}

export async function syncSqliteSchema(
  db: BunDatabase,
  models: readonly ModelDefinition[],
): Promise<void> {
  await syncSchemaGeneric(db, models, ops);
}
