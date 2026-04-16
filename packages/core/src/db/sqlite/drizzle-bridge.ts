/**
 * Bridge between our dynamic model client and Drizzle's strictly-typed query
 * builders. Drizzle infers `eq()` / `.values()` / `.set()` argument types from
 * the table column they target, but our client looks up columns by name at
 * runtime so we cannot satisfy those generics statically. Runtime behavior is
 * correct; this module is the single, named boundary where we trade
 * compile-time precision for the dynamic shape we expose to users.
 */
import { type AnyColumn, type SQL, eq } from 'drizzle-orm';
import type {
  SQLiteInsertBuilder,
  SQLiteTable,
  SQLiteUpdateBuilder,
} from 'drizzle-orm/sqlite-core';

type DrizzleEqValue = Parameters<typeof eq>[1];
type Insert = SQLiteInsertBuilder<SQLiteTable, 'sync', unknown>;
type InsertReturn = ReturnType<Insert['values']>;
type Update = SQLiteUpdateBuilder<SQLiteTable, 'sync', unknown>;
type UpdateReturn = ReturnType<Update['set']>;

export function whereEq(column: AnyColumn, value: unknown): SQL {
  return eq(column, value as DrizzleEqValue);
}

export function insertValues<T>(builder: Insert, data: Partial<T>): InsertReturn {
  return builder.values(data as unknown as Parameters<Insert['values']>[0]);
}

export function updateSet<T>(builder: Update, data: Partial<T>): UpdateReturn {
  return builder.set(data as unknown as Parameters<Update['set']>[0]);
}

export type { AnyColumn, SQL };
