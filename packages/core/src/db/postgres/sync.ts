import type { ModelDefinition } from '../../model/define';
import {
  type DialectDdlOps,
  adapterDdlFor,
  buildCreateTableSql as buildCreateTableSqlGeneric,
  syncSchemaGeneric,
} from '../sql/ddl-emitter';

/**
 * Minimal runner shape — postgres.js returns `Sql` whose tagged-template API
 * is richer than what is used here. Only `unsafe(text)` is called for DDL.
 */
export interface PostgresRunner {
  unsafe(query: string): Promise<unknown> | { execute(): Promise<unknown> };
}

const ops: DialectDdlOps = {
  quote: (id) => `"${id}"`,
  idClause: '"id" SERIAL PRIMARY KEY',
  timestampClauses: [
    '"created_at" TIMESTAMPTZ NOT NULL DEFAULT now()',
    '"updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()',
  ],
  ddlFor: (field) => adapterDdlFor(field, 'postgres'),
  supportsInlineUnique: true,
  emitForeignKeys: true,
  run: async (runner, sql) => {
    const result = (runner as PostgresRunner).unsafe(sql);
    await (result as Promise<unknown>);
  },
};

export function buildCreateTableSql(model: ModelDefinition): string {
  return buildCreateTableSqlGeneric(model, ops);
}

export async function syncPostgresSchema(
  runner: PostgresRunner,
  models: readonly ModelDefinition[],
): Promise<void> {
  await syncSchemaGeneric(runner, models, ops);
}
