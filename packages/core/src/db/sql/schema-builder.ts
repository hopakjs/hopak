/**
 * Shared Drizzle schema builder for the 3 SQL dialects.
 *
 * The three dialects differ in:
 *   - primary-key column syntax (INTEGER AUTOINCREMENT vs SERIAL vs INT AUTOINCREMENT)
 *   - `NOW()` SQL fragment
 *   - timestamp column type (stored as unix-seconds vs TIMESTAMPTZ vs DATETIME(3))
 *   - table factory function (`sqliteTable` / `pgTable` / `mysqlTable`)
 *   - native enum column factory (Postgres `pgEnum`, MySQL `mysqlEnum`;
 *     SQLite expresses enum as TEXT + CHECK in the DDL emitter — 0.2.0)
 *   - `.unique()` on TEXT: works on SQLite / Postgres, fails in MySQL without
 *     a key-length prefix (MySQL's prefix-based UNIQUE KEY is handled in sync.ts)
 *
 * Everything else — the per-field column application, modifier chaining,
 * timestamps hook-up, table assembly — is shared here. Each dialect's
 * `schema.ts` becomes a thin wrapper that provides its `DialectSchemaOps`.
 */
import { pluralize } from '@hopak/common';
import type { SQL } from 'drizzle-orm';
import { isVirtual } from '../../fields/adapters';
import type { FieldDefinition } from '../../fields/base';
import type { ModelDefinition } from '../../model/define';

/**
 * Structural modifier chain exposed by every Drizzle column builder at
 * runtime (`notNull`, `default`, `unique`). Drizzle's typed builders are
 * invariant under generic parameters, so columns are cast through this
 * shape once at the single named boundary below.
 */
interface ColumnChain {
  notNull(): ColumnChain;
  default(value: unknown): ColumnChain;
  unique(): ColumnChain;
}

export interface DialectSchemaOps<TColumn, TTable> {
  /** Dialect's `NOW()` SQL fragment — used as the default for timestamp columns. */
  nowSql: SQL;
  /** Build the `id` primary-key column. Called fresh per table. */
  idColumn: () => TColumn;
  /** Build a timestamp column (raw, before modifiers). Shared code applies
   *  `.notNull().default(now)` on top. */
  timestampColumn: (name: string) => TColumn;
  /** Wrap columns in a dialect-specific Drizzle Table. */
  tableFactory: (name: string, columns: Record<string, TColumn>) => TTable;
  /** Pull the scalar column factory from the FieldAdapter registry. Returns
   *  `null` for virtual fields or fields the dialect doesn't map. */
  adapterColumn: (fieldName: string, field: FieldDefinition) => TColumn | null;
  /** MySQL cannot emit inline `.unique()` on TEXT columns — uniqueness is
   *  enforced via a separate `UNIQUE KEY (col(191))` clause in sync.ts.
   *  Defaults to `true` for SQLite / Postgres. */
  supportsInlineUnique?: boolean;
  /** 0.2.0 hook: dialect-native enum column factory. When provided, the
   *  builder invokes it for `field.type === 'enum'` instead of calling
   *  `adapterColumn`. SQLite won't supply this (TEXT + CHECK lives in
   *  sync.ts); Postgres will wire `pgEnum`, MySQL `mysqlEnum`. */
  enumColumn?: (fieldName: string, modelName: string, field: FieldDefinition) => TColumn;
}

function applyModifiers<TColumn>(
  column: TColumn,
  field: FieldDefinition,
  nowSql: SQL,
  supportsInlineUnique: boolean,
): TColumn {
  let chain = column as unknown as ColumnChain;
  if (field.required) chain = chain.notNull();
  if (field.unique && supportsInlineUnique) chain = chain.unique();
  if (field.default !== undefined) {
    chain = chain.default(field.default === 'now' ? nowSql : field.default);
  }
  return chain as unknown as TColumn;
}

const TIMESTAMP_FIELD: FieldDefinition = {
  type: 'timestamp',
  required: true,
  default: 'now',
};

export function buildSchemaGeneric<TColumn, TTable>(
  models: readonly ModelDefinition[],
  ops: DialectSchemaOps<TColumn, TTable>,
): Record<string, TTable> {
  const schema: Record<string, TTable> = {};
  const supportsInlineUnique = ops.supportsInlineUnique ?? true;

  for (const model of models) {
    const columns: Record<string, TColumn> = { id: ops.idColumn() };

    for (const [fieldName, field] of Object.entries(model.fields)) {
      if (isVirtual(field)) continue;
      // 0.2.0 wiring: the enum hook, if present, takes priority for enum
      // fields so the path routes through `pgEnum` / `mysqlEnum` instead of
      // the plain adapter.
      const raw =
        field.type === 'enum' && ops.enumColumn
          ? ops.enumColumn(fieldName, model.name, field)
          : ops.adapterColumn(fieldName, field);
      if (!raw) continue;
      columns[fieldName] = applyModifiers(raw, field, ops.nowSql, supportsInlineUnique);
    }

    if (model.options.timestamps) {
      columns.createdAt = applyModifiers(
        ops.timestampColumn('created_at'),
        TIMESTAMP_FIELD,
        ops.nowSql,
        supportsInlineUnique,
      );
      columns.updatedAt = applyModifiers(
        ops.timestampColumn('updated_at'),
        TIMESTAMP_FIELD,
        ops.nowSql,
        supportsInlineUnique,
      );
    }

    schema[model.name] = ops.tableFactory(pluralize(model.name), columns);
  }

  return schema;
}
