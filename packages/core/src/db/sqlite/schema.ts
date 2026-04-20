import { sql } from 'drizzle-orm';
import {
  type SQLiteColumnBuilderBase,
  type SQLiteTable,
  integer,
  sqliteTable,
} from 'drizzle-orm/sqlite-core';
import { adapterFor, columnNameFor } from '../../fields/adapters';
import type { ModelDefinition } from '../../model/define';
import { type DialectSchemaOps, buildSchemaGeneric } from '../sql/schema-builder';

export type SqliteSchema = Record<string, SQLiteTable>;

const ops: DialectSchemaOps<SQLiteColumnBuilderBase, SQLiteTable> = {
  nowSql: sql`(unixepoch())`,
  idColumn: () => integer('id').primaryKey({ autoIncrement: true }),
  timestampColumn: (name) => integer(name, { mode: 'timestamp' }),
  tableFactory: (name, columns) => sqliteTable(name, columns),
  adapterColumn: (fieldName, field) => {
    const adapter = adapterFor(field.type);
    if (!adapter.sqlite.column) return null;
    return adapter.sqlite.column(columnNameFor(fieldName, field));
  },
};

export function buildSqliteSchema(models: readonly ModelDefinition[]): SqliteSchema {
  return buildSchemaGeneric(models, ops);
}
