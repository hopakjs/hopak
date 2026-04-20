/**
 * Shared Drizzle query-builder bridge for all 3 SQL dialects.
 *
 * Drizzle exposes dialect-specific generic parameters on its builders
 * (`SQLiteInsert<Table, 'sync', unknown>`, `PgInsert<...>`, ...), but the
 * runtime method names and shapes are identical across dialects. Structural
 * "like" interfaces below capture exactly what the dynamic model client
 * needs; per-dialect clients pass their typed builders in via a single
 * `unknown` cast at the call site.
 *
 * This is the single place where compile-time precision is traded for the
 * dynamic `where: { [field]: value }` surface the public API exposes.
 */
import { type AnyColumn, type SQL, eq } from 'drizzle-orm';

type EqValue = Parameters<typeof eq>[1];

/** Builder returned by `db.insert(table)`. All 3 dialects expose these. */
export interface InsertBuilderLike {
  values(data: unknown): InsertValuesLike;
}

export interface InsertValuesLike extends PromiseLike<unknown> {
  /** Present on SQLite + Postgres. MySQL has no RETURNING. */
  returning?(): Promise<unknown[]>;
  /** SQLite + Postgres. */
  onConflictDoUpdate?(opts: { target: unknown; set: unknown }): InsertValuesLike;
  /** MySQL only. */
  onDuplicateKeyUpdate?(opts: { set: unknown }): InsertValuesLike;
}

/** Builder returned by `db.update(table)`. */
export interface UpdateBuilderLike {
  set(data: unknown): UpdateWhereLike;
}

export interface UpdateWhereLike extends PromiseLike<unknown> {
  where(cond: SQL): UpdateWhereLike;
  returning?(): Promise<unknown[]>;
}

/** Builder returned by `db.delete(table)`. */
export interface DeleteWhereLike extends PromiseLike<unknown> {
  where(cond: SQL): DeleteWhereLike;
  returning?(): Promise<unknown[]>;
}

export function whereEq(column: AnyColumn, value: unknown): SQL {
  return eq(column, value as EqValue);
}

export function insertValues(builder: InsertBuilderLike, data: unknown): InsertValuesLike {
  return builder.values(data);
}

export function updateSet(builder: UpdateBuilderLike, data: unknown): UpdateWhereLike {
  return builder.set(data);
}

/**
 * MySQL's drivers return either `ResultSetHeader` directly or the tuple
 * `[ResultSetHeader, FieldPacket[]]` depending on how Drizzle wraps the
 * result. Normalizer for the single place that shape is inspected.
 */
export function unpackHeader<T>(result: unknown): T {
  if (Array.isArray(result)) return result[0] as T;
  return result as T;
}
