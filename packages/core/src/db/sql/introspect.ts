import { type DbDialect, pluralize } from '@hopak/common';
import { columnNameFor, isVirtual } from '../../fields/adapters';
import type { ModelDefinition } from '../../model/define';
import type { Database } from '../client';

/**
 * Live schema introspection — what columns does each table actually have?
 * Every dialect routes through `db.sql` with a bound table name.
 *
 * Called from `syncSchemaGeneric` after sync completes to warn when a
 * model has fields that don't yet exist in the table (sync itself is
 * CREATE-only, never ALTER).
 */

interface ColumnRow {
  readonly column_name: unknown;
}

export async function listColumns(
  db: Database,
  dialect: DbDialect,
  table: string,
): Promise<readonly string[]> {
  const rows = await runListColumns(db, dialect, table);
  return rows.map((r) => String(r.column_name));
}

async function runListColumns(
  db: Database,
  dialect: DbDialect,
  table: string,
): Promise<readonly ColumnRow[]> {
  if (dialect === 'sqlite') {
    // `pragma_table_info(?)` accepts a bound parameter on SQLite ≥3.31
    // (table-valued pragma functions). bun:sqlite is well above that
    // threshold; third-party SQLite bindings must match or this read fails.
    return db.sql<ColumnRow>`SELECT name AS column_name FROM pragma_table_info(${table})`;
  }
  if (dialect === 'postgres') {
    return db.sql<ColumnRow>`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ${table}`;
  }
  // MySQL's information_schema uppercases the column name without the
  // back-ticked alias — preserve the lowercase key we read downstream.
  return db.sql<ColumnRow>`SELECT column_name AS \`column_name\` FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ${table}`;
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
    if (dbColumns.length === 0) continue;
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
