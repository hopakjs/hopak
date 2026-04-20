import { sql } from 'drizzle-orm';
import {
  type MySqlColumnBuilderBase,
  type MySqlTable,
  datetime,
  int,
  mysqlTable,
} from 'drizzle-orm/mysql-core';
import { adapterFor, columnNameFor } from '../../fields/adapters';
import type { ModelDefinition } from '../../model/define';
import { type DialectSchemaOps, buildSchemaGeneric } from '../sql/schema-builder';

export type MysqlSchema = Record<string, MySqlTable>;

const ops: DialectSchemaOps<MySqlColumnBuilderBase, MySqlTable> = {
  nowSql: sql`CURRENT_TIMESTAMP(3)`,
  idColumn: () => int('id').autoincrement().primaryKey(),
  timestampColumn: (name) => datetime(name, { mode: 'date', fsp: 3 }),
  tableFactory: (name, columns) => mysqlTable(name, columns),
  adapterColumn: (fieldName, field) => {
    const adapter = adapterFor(field.type);
    if (!adapter.mysql.column) return null;
    return adapter.mysql.column(columnNameFor(fieldName, field));
  },
  // MySQL `.unique()` on TEXT fails without a key-length prefix.
  // `UNIQUE KEY (col(191))` is emitted manually in sync.ts; Drizzle's inline
  // unique is suppressed here so both paths don't collide.
  supportsInlineUnique: false,
  // 0.2.0 wiring goes here: enumColumn: (fieldName, _modelName, field) =>
  //   mysqlEnum(columnNameFor(fieldName, field), field.enumValues!)
};

export function buildMysqlSchema(models: readonly ModelDefinition[]): MysqlSchema {
  return buildSchemaGeneric(models, ops);
}
