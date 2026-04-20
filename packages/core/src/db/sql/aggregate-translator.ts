/**
 * Shared aggregate builder. Takes an `AggregateOptions` object + a column
 * resolver and produces three things:
 *
 *   - `selectShape` — the object you pass to Drizzle's `.select(shape)`.
 *   - `groupByCols` — columns passed to `.groupBy(...)`, or `undefined`
 *     when the caller asked for a single-row aggregate.
 *   - `unpack(row)` — converts a result row back into the nested shape
 *     exposed to callers, merging group column values for grouped queries.
 *
 * Aliases used in SQL are `c{N}` for aggregates and `g{N}` for group-by
 * columns, so they don't collide with real column names.
 */
import { type AnyColumn, type SQL, sql } from 'drizzle-orm';
import type { AggregateOptions, AggregateResult } from '../client';

type AggregateOp = 'sum' | 'avg' | 'min' | 'max' | 'count';

interface AggregateBinding {
  op: AggregateOp;
  field: string;
  alias: string;
}

interface GroupBinding {
  field: string;
  alias: string;
  column: AnyColumn;
}

export interface AggregatePlan {
  selectShape: Record<string, SQL | AnyColumn>;
  groupByCols?: readonly AnyColumn[];
  unpack: (row: Record<string, unknown>) => AggregateResult & Record<string, unknown>;
}

export type ColumnResolver = (field: string) => AnyColumn;

const OPS: AggregateOp[] = ['sum', 'avg', 'min', 'max'];

export function buildAggregatePlan<TRow>(
  options: AggregateOptions<TRow>,
  resolve: ColumnResolver,
): AggregatePlan {
  const selectShape: Record<string, SQL | AnyColumn> = {};
  const aggregateBindings: AggregateBinding[] = [];
  const groupBindings: GroupBinding[] = [];
  let aggCounter = 0;
  let groupCounter = 0;

  // Group-by columns must be included in the SELECT so they can be read
  // back per group. They are aliased (`g0`, `g1`, ...) with the original
  // field name kept in the binding so unpack can restore it.
  if (options.groupBy) {
    for (const field of options.groupBy) {
      const alias = `g${groupCounter++}`;
      const column = resolve(field);
      selectShape[alias] = column;
      groupBindings.push({ field, alias, column });
    }
  }

  for (const op of OPS) {
    const fields = options[op];
    if (!fields) continue;
    for (const field of fields) {
      const alias = `c${aggCounter++}`;
      selectShape[alias] = buildFragment(op, resolve(field));
      aggregateBindings.push({ op, field, alias });
    }
  }

  if (options.count === '_all') {
    const alias = `c${aggCounter++}`;
    selectShape[alias] = sql<number>`count(*)`;
    aggregateBindings.push({ op: 'count', field: '_all', alias });
  } else if (Array.isArray(options.count)) {
    for (const field of options.count) {
      const alias = `c${aggCounter++}`;
      selectShape[alias] = sql<number>`count(${resolve(field)})`;
      aggregateBindings.push({ op: 'count', field, alias });
    }
  }

  const unpack = (row: Record<string, unknown>): AggregateResult & Record<string, unknown> => {
    const result: AggregateResult & Record<string, unknown> = {};
    for (const { field, alias } of groupBindings) {
      result[field] = row[alias];
    }
    for (const { op, field, alias } of aggregateBindings) {
      let bucket = result[op] as Record<string, number> | undefined;
      if (!bucket) {
        bucket = {};
        result[op] = bucket;
      }
      bucket[field] = Number(row[alias] ?? 0);
    }
    return result;
  };

  return {
    selectShape,
    groupByCols: groupBindings.length > 0 ? groupBindings.map((b) => b.column) : undefined,
    unpack,
  };
}

function buildFragment(op: AggregateOp, column: AnyColumn): SQL {
  switch (op) {
    case 'sum':
      return sql<number>`sum(${column})`;
    case 'avg':
      return sql<number>`avg(${column})`;
    case 'min':
      return sql<number>`min(${column})`;
    case 'max':
      return sql<number>`max(${column})`;
    case 'count':
      return sql<number>`count(${column})`;
  }
}
