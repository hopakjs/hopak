/**
 * Shared `CREATE TABLE IF NOT EXISTS` emitter for the 3 SQL dialects.
 *
 * The three dialects diverge in:
 *   - Identifier quoting (`"..."` vs `` `...` ``)
 *   - Primary-key clause (`SERIAL` vs `INTEGER AUTOINCREMENT` vs `INT AUTO_INCREMENT`)
 *   - Timestamp column syntax (`TIMESTAMPTZ` vs `INTEGER` epoch vs `DATETIME(3)`)
 *   - Whether `.unique()` can live inline (not in MySQL — TEXT columns need a
 *     separate `UNIQUE KEY (col(N))` with prefix length)
 *   - Whether `FOREIGN KEY` constraints are emitted (SQLite currently skips;
 *     Postgres + MySQL include them)
 *   - How to execute the resulting SQL string against the native driver
 *
 * Everything else — column-def formatting, iterating model fields, adding
 * timestamps, composing lines + constraints into a CREATE TABLE — is shared
 * here. Each dialect's `sync.ts` becomes a thin wrapper that provides its
 * `DialectDdlOps`.
 */
import { pluralize } from '@hopak/common';
import { adapterFor, columnNameFor, isVirtual } from '../../fields/adapters';
import type { FieldDefinition } from '../../fields/base';
import type { ModelDefinition } from '../../model/define';

export interface DialectDdlOps {
  /** Quote an identifier. SQLite + Postgres use `"`, MySQL uses backticks. */
  quote: (id: string) => string;
  /** The `id` primary-key clause, already quoted, ready to drop as first line. */
  idClause: string;
  /** Two timestamp clauses for `created_at` and `updated_at`, already quoted. */
  timestampClauses: readonly [string, string];
  /** Pull the dialect-specific DDL string for a field type from the adapter. */
  ddlFor: (field: FieldDefinition) => string | null;
  /**
   * Whether `UNIQUE` can be appended to the column definition inline. True
   * for SQLite and Postgres. False for MySQL, where uniqueness on TEXT
   * columns needs a prefix-length `UNIQUE KEY` clause instead — see
   * `textUniquePrefix`.
   */
  supportsInlineUnique: boolean;
  /** Prefix length for `UNIQUE KEY (col(N))` on TEXT columns. MySQL only. */
  textUniquePrefix?: number;
  /**
   * Emit `FOREIGN KEY` constraints for `belongsTo` fields? SQLite currently
   * doesn't (preserves existing behavior — the pragma is off by default
   * anyway). Postgres + MySQL do.
   */
  emitForeignKeys: boolean;
  /** Execute the composed DDL against the dialect's native runner. */
  run: (runner: unknown, sql: string) => Promise<void>;
}

function columnLine(
  columnName: string,
  field: FieldDefinition,
  ddl: string,
  ops: DialectDdlOps,
): string {
  const notNull = field.required ? ' NOT NULL' : '';
  const unique = field.unique && ops.supportsInlineUnique ? ' UNIQUE' : '';
  return `${ops.quote(columnName)} ${ddl}${notNull}${unique}`;
}

function uniqueKeyClause(
  tableName: string,
  columnName: string,
  ddl: string,
  ops: DialectDdlOps,
): string {
  const isText = ddl === 'TEXT';
  const length = isText && ops.textUniquePrefix ? `(${ops.textUniquePrefix})` : '';
  return `UNIQUE KEY ${ops.quote(`uk_${tableName}_${columnName}`)} (${ops.quote(columnName)}${length})`;
}

function fkConstraintClause(
  tableName: string,
  columnName: string,
  targetTable: string,
  ops: DialectDdlOps,
): string {
  return `CONSTRAINT ${ops.quote(`fk_${tableName}_${columnName}`)} FOREIGN KEY (${ops.quote(columnName)}) REFERENCES ${ops.quote(targetTable)}(${ops.quote('id')})`;
}

export function buildCreateTableSql(model: ModelDefinition, ops: DialectDdlOps): string {
  const tableName = pluralize(model.name);
  const lines: string[] = [ops.idClause];
  const constraints: string[] = [];

  for (const [fieldName, field] of Object.entries(model.fields)) {
    if (isVirtual(field)) continue;
    const ddl = ops.ddlFor(field);
    if (!ddl) continue;
    const columnName = columnNameFor(fieldName, field);

    lines.push(columnLine(columnName, field, ddl, ops));

    if (field.unique && !ops.supportsInlineUnique) {
      constraints.push(uniqueKeyClause(tableName, columnName, ddl, ops));
    }

    if (ops.emitForeignKeys && field.type === 'belongsTo' && field.relationTarget) {
      constraints.push(
        fkConstraintClause(tableName, columnName, pluralize(field.relationTarget), ops),
      );
    }
  }

  if (model.options.timestamps) {
    lines.push(...ops.timestampClauses);
  }

  lines.push(...constraints);

  return `CREATE TABLE IF NOT EXISTS ${ops.quote(tableName)} (\n  ${lines.join(',\n  ')}\n)`;
}

export async function syncSchemaGeneric(
  runner: unknown,
  models: readonly ModelDefinition[],
  ops: DialectDdlOps,
): Promise<void> {
  for (const model of orderByFkDependencies(models)) {
    await ops.run(runner, buildCreateTableSql(model, ops));
  }
}

/**
 * Order models so a `belongsTo` target is created before any dependent child.
 * Without this, Postgres + MySQL reject `CREATE TABLE ... FOREIGN KEY` because
 * the referenced table doesn't exist yet. Models the scanner returned in
 * alphabetical order (comment before post) hit this every time.
 *
 * Cycles are tolerated — the first model in a cycle is emitted in its
 * discovery order, and any remaining constraints resolve on the second pass.
 * SQLite's generic case degenerates harmlessly to the original order.
 */
export function orderByFkDependencies(
  models: readonly ModelDefinition[],
): readonly ModelDefinition[] {
  const byName = new Map(models.map((m) => [m.name, m]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: ModelDefinition[] = [];

  function visit(model: ModelDefinition): void {
    if (visited.has(model.name) || visiting.has(model.name)) return;
    visiting.add(model.name);
    for (const field of Object.values(model.fields)) {
      if (field.type !== 'belongsTo' || !field.relationTarget) continue;
      const parent = byName.get(field.relationTarget);
      if (parent) visit(parent);
    }
    visiting.delete(model.name);
    visited.add(model.name);
    ordered.push(model);
  }

  for (const model of models) visit(model);
  return ordered;
}

/** Small helper used by every dialect's `ddlFor`. */
export function adapterDdlFor(
  field: FieldDefinition,
  dialect: 'sqlite' | 'postgres' | 'mysql',
): string | null {
  const adapter = adapterFor(field.type);
  return adapter[dialect].ddl;
}
