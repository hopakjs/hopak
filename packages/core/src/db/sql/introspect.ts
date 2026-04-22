import { type DbDialect, pluralize } from '@hopak/common';
import { sql as drizzleSql } from 'drizzle-orm';
import { columnNameFor, isVirtual } from '../../fields/adapters';
import type { ModelDefinition } from '../../model/define';
import type { Database } from '../client';

/**
 * Live schema introspection — what columns does each table actually have?
 * Dialect-specific queries go through a drizzle raw-sql path. Read-only.
 *
 * Called from `syncSchemaGeneric` after sync completes to warn when a
 * model has fields that don't yet exist in the table (the case sync
 * itself can't handle — sync is CREATE-only, never ALTER).
 */

const SQL: Record<DbDialect, string> = {
  sqlite: 'SELECT name AS column_name FROM pragma_table_info(?)',
  postgres:
    'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
  // MySQL's information_schema uppercases identifiers; the back-ticked alias
  // preserves the lowercase name we expect when reading `row.column_name`.
  mysql:
    'SELECT column_name AS `column_name` FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
};

export async function listColumns(
  db: Database,
  dialect: DbDialect,
  table: string,
): Promise<readonly string[]> {
  const raw = db.raw() as {
    all?: (sql: unknown) => unknown[];
    execute?: (sql: unknown) => Promise<unknown>;
  };
  const statement = SQL[dialect];

  if (dialect === 'sqlite') {
    // bun-sqlite drizzle accepts parameters inline via sql``; use raw template
    // with the table interpolated because pragma_table_info needs the name as
    // a literal, not a bound param on some sqlite builds.
    const rows = raw.all?.(
      drizzleSql.raw(
        `SELECT name AS column_name FROM pragma_table_info('${table.replace(/'/g, "''")}')`,
      ),
    ) as Array<{ column_name: unknown }> | undefined;
    return (rows ?? []).map((r) => String(r.column_name));
  }

  // pg / mysql — drizzle's execute supports parameter binding via the
  // tagged-template operator, but we assemble from a string so we escape the
  // table name into a literal to keep the code path simple.
  const safe = table.replace(/'/g, "''");
  const paramised = statement.replace(/\$1|\?/, `'${safe}'`);
  const result = await raw.execute?.(drizzleSql.raw(paramised));
  const rows = extractRows(result);
  return rows.map((r) => String((r as { column_name: unknown }).column_name));
}

/**
 * Each driver spells its result differently:
 *   - postgres.js (pg)       → proxy whose iteration yields rows
 *   - drizzle-wrapped pg     → `{ rows: [...] }`
 *   - mysql2                 → `[rows, fields]`
 *   - already-unwrapped array
 */
function extractRows(result: unknown): readonly unknown[] {
  if (!result) return [];
  if (Array.isArray(result)) {
    // mysql2: [rows, fields]; pg.js sometimes: Array-like of rows; pick the
    // form that looks like rows (objects with string keys) vs the [rows, _] tuple.
    if (result.length === 2 && Array.isArray(result[0])) return result[0];
    return result;
  }
  const r = result as { rows?: unknown[] };
  if (Array.isArray(r.rows)) return r.rows;
  // postgres.js returns a Result object that's also iterable.
  if (typeof (result as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function') {
    return Array.from(result as Iterable<unknown>);
  }
  return [];
}

export interface DriftReport {
  readonly model: string;
  readonly table: string;
  readonly missingColumns: readonly string[];
}

/**
 * For every model, list columns the model declares that aren't in the DB.
 * Virtual fields (hasMany/hasOne) and unknown-to-dialect adapters are
 * skipped. Tables that don't exist at all are skipped too — sync will
 * create them.
 */
export async function detectDrift(
  db: Database,
  dialect: DbDialect,
  models: readonly ModelDefinition[],
): Promise<readonly DriftReport[]> {
  const reports: DriftReport[] = [];
  for (const model of models) {
    const table = pluralize(model.name);
    const dbColumns = await listColumns(db, dialect, table);
    if (dbColumns.length === 0) continue; // brand-new table, not drift
    const dbSet = new Set(dbColumns);
    const missing: string[] = [];
    for (const [fieldName, field] of Object.entries(model.fields)) {
      if (isVirtual(field)) continue;
      const col = columnNameFor(fieldName, field);
      if (!dbSet.has(col)) missing.push(col);
    }
    if (missing.length > 0) {
      reports.push({ model: model.name, table, missingColumns: missing });
    }
  }
  return reports;
}
