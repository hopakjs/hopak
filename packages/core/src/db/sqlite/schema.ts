import { pluralize } from '@hopak/common';
import { sql } from 'drizzle-orm';
import {
  type SQLiteColumnBuilderBase,
  type SQLiteTable,
  integer,
  sqliteTable,
} from 'drizzle-orm/sqlite-core';
import { adapterFor, columnNameFor, isVirtual } from '../../fields/adapters';
import type { FieldDefinition } from '../../fields/base';
import type { ModelDefinition } from '../../model/define';

export type SqliteSchema = Record<string, SQLiteTable>;

/**
 * Drizzle exposes column modifiers (`notNull`, `default`, `unique`) on the
 * abstract `SQLiteColumnBuilder` class, but its generic parameters are
 * invariant — so we cannot store concrete builders (e.g. `SQLiteIntegerBuilder`)
 * in a `Record<string, SQLiteColumnBuilder>` without losing assignability.
 *
 * The covariant `SQLiteColumnBuilderBase` interface lets us collect builders,
 * but it carries no methods. `Chainable` declares the structural shape we
 * actually invoke, and `chainable()` is the single named boundary that bridges
 * the two views over the same runtime object.
 */
interface Chainable {
  notNull(): Chainable;
  default(value: unknown): Chainable;
  unique(): Chainable;
}

function chainable(column: SQLiteColumnBuilderBase): Chainable {
  return column as unknown as Chainable;
}

const NOW = sql`(unixepoch())`;

function applyModifiers(
  column: SQLiteColumnBuilderBase,
  field: FieldDefinition,
): SQLiteColumnBuilderBase {
  let chain = chainable(column);
  if (field.required) chain = chain.notNull();
  if (field.unique) chain = chain.unique();
  if (field.default !== undefined) {
    chain = chain.default(field.default === 'now' ? NOW : field.default);
  }
  return chain as unknown as SQLiteColumnBuilderBase;
}

function timestampColumn(name: string): SQLiteColumnBuilderBase {
  return applyModifiers(integer(name, { mode: 'timestamp' }), {
    type: 'timestamp',
    required: true,
    default: 'now',
  });
}

export function buildSqliteSchema(models: readonly ModelDefinition[]): SqliteSchema {
  const schema: SqliteSchema = {};

  for (const model of models) {
    const columns: Record<string, SQLiteColumnBuilderBase> = {
      id: integer('id').primaryKey({ autoIncrement: true }),
    };

    for (const [fieldName, field] of Object.entries(model.fields)) {
      if (isVirtual(field)) continue;
      const adapter = adapterFor(field.type);
      if (!adapter.drizzleColumn) continue;
      columns[fieldName] = applyModifiers(
        adapter.drizzleColumn(columnNameFor(fieldName, field)),
        field,
      );
    }

    if (model.options.timestamps) {
      columns.createdAt = timestampColumn('created_at');
      columns.updatedAt = timestampColumn('updated_at');
    }

    schema[model.name] = sqliteTable(pluralize(model.name), columns);
  }

  return schema;
}
