import type { Database as BunDatabase } from 'bun:sqlite';
import { pluralize } from '@hopak/common';
import { adapterFor, columnNameFor, isVirtual } from '../../fields/adapters';
import type { FieldDefinition } from '../../fields/base';
import type { ModelDefinition } from '../../model/define';

function columnDef(name: string, field: FieldDefinition): string | null {
  const adapter = adapterFor(field.type);
  if (!adapter.sqliteClass) return null;
  const notNull = field.required ? ' NOT NULL' : '';
  const unique = field.unique ? ' UNIQUE' : '';
  return `"${name}" ${adapter.sqliteClass}${notNull}${unique}`;
}

const TIMESTAMP_COLUMNS = [
  '"created_at" INTEGER NOT NULL DEFAULT (unixepoch())',
  '"updated_at" INTEGER NOT NULL DEFAULT (unixepoch())',
];

export function buildCreateTableSql(model: ModelDefinition): string {
  const lines: string[] = ['"id" INTEGER PRIMARY KEY AUTOINCREMENT'];

  for (const [fieldName, field] of Object.entries(model.fields)) {
    if (isVirtual(field)) continue;
    const def = columnDef(columnNameFor(fieldName, field), field);
    if (def) lines.push(def);
  }

  if (model.options.timestamps) {
    lines.push(...TIMESTAMP_COLUMNS);
  }

  const tableName = pluralize(model.name);
  return `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${lines.join(',\n  ')}\n)`;
}

export function syncSqliteSchema(db: BunDatabase, models: readonly ModelDefinition[]): void {
  for (const model of models) {
    db.run(buildCreateTableSql(model));
  }
}
