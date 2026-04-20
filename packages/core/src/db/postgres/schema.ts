import { sql } from 'drizzle-orm';
import {
  type PgColumnBuilderBase,
  type PgTable,
  pgTable,
  serial,
  timestamp,
} from 'drizzle-orm/pg-core';
import { adapterFor, columnNameFor } from '../../fields/adapters';
import type { ModelDefinition } from '../../model/define';
import { type DialectSchemaOps, buildSchemaGeneric } from '../sql/schema-builder';

export type PostgresSchema = Record<string, PgTable>;

const ops: DialectSchemaOps<PgColumnBuilderBase, PgTable> = {
  nowSql: sql`now()`,
  idColumn: () => serial('id').primaryKey(),
  timestampColumn: (name) => timestamp(name, { withTimezone: true, mode: 'date' }),
  tableFactory: (name, columns) => pgTable(name, columns),
  adapterColumn: (fieldName, field) => {
    const adapter = adapterFor(field.type);
    if (!adapter.postgres.column) return null;
    return adapter.postgres.column(columnNameFor(fieldName, field));
  },
  // 0.2.0 wiring goes here: enumColumn: (fieldName, modelName, field) =>
  //   pgEnum(`${modelName}_${fieldName}`, field.enumValues!)(columnNameFor(fieldName, field))
};

export function buildPostgresSchema(models: readonly ModelDefinition[]): PostgresSchema {
  return buildSchemaGeneric(models, ops);
}
