/**
 * Translates Hopak's `WhereClause` object into a Drizzle `SQL` fragment.
 * Shared by all SQL dialects — each one supplies its own column resolver
 * plus an ilike strategy (Postgres has native ILIKE; SQLite and MySQL use
 * LIKE which is case-insensitive by default with their standard collations).
 */
import {
  type AnyColumn,
  type SQL,
  and,
  between,
  ilike as drizzleIlike,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  not,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import type { WhereClause } from '../client';

type EqValue = Parameters<typeof eq>[1];

export type ColumnResolver = (field: string) => AnyColumn;
export type IlikeStrategy = (column: AnyColumn, pattern: string) => SQL;
type Combiner = (...conds: SQL[]) => SQL | undefined;

/**
 * Use `drizzleIlike` on Postgres (native ILIKE) and fall back to LIKE on
 * SQLite / MySQL where the default collation is already case-insensitive.
 * All three emit an `ESCAPE '|'` clause so escaped wildcards (`|%`, `|_`)
 * from `contains`/`startsWith`/`endsWith` are honored consistently.
 *
 * Pipe (`|`) is used instead of the more common backslash because MySQL's
 * string literal parser consumes `\\` before it reaches the LIKE engine —
 * which produces `escape '\\'` → a stray single backslash in the literal
 * and an unterminated-string parse error. Pipe has no special meaning in
 * any of the three dialects' string or LIKE layers.
 */
export const ilikeNative: IlikeStrategy = (column, pattern) =>
  sql`${drizzleIlike(column, pattern)} escape '|'`;
export const ilikeAsLike: IlikeStrategy = (column, pattern) =>
  sql`${like(column, pattern)} escape '|'`;

export interface TranslateOptions {
  ilike: IlikeStrategy;
}

const OP_KEYS = new Set([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'notIn',
  'contains',
  'startsWith',
  'endsWith',
  'like',
  'ilike',
  'between',
  'isNull',
  'isNotNull',
]);

function isFilterOp(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  if (value instanceof Date) return false;
  if (Array.isArray(value)) return false;
  return Object.keys(value).some((k) => OP_KEYS.has(k));
}

function opCondition(column: AnyColumn, raw: unknown, options: TranslateOptions): SQL {
  if (!isFilterOp(raw)) {
    return eq(column, raw as EqValue);
  }
  const op = raw;
  if ('eq' in op) return eq(column, op.eq as EqValue);
  if ('neq' in op) return ne(column, op.neq as EqValue);
  if ('gt' in op) return gt(column, op.gt as EqValue);
  if ('gte' in op) return gte(column, op.gte as EqValue);
  if ('lt' in op) return lt(column, op.lt as EqValue);
  if ('lte' in op) return lte(column, op.lte as EqValue);
  if ('in' in op) return inArray(column, op.in as EqValue[]);
  if ('notIn' in op) return notInArray(column, op.notIn as EqValue[]);
  if ('contains' in op) {
    return likeWithEscape(column, `%${escapeLike(op.contains as string)}%`);
  }
  if ('startsWith' in op) {
    return likeWithEscape(column, `${escapeLike(op.startsWith as string)}%`);
  }
  if ('endsWith' in op) {
    return likeWithEscape(column, `%${escapeLike(op.endsWith as string)}`);
  }
  if ('like' in op) return likeWithEscape(column, op.like as string);
  if ('ilike' in op) return options.ilike(column, op.ilike as string);
  if ('between' in op) {
    const [a, b] = op.between as [unknown, unknown];
    return between(column, a as EqValue, b as EqValue);
  }
  if ('isNull' in op) return isNull(column);
  if ('isNotNull' in op) return isNotNull(column);
  throw new Error(`Unknown filter operator on column. Keys: ${Object.keys(op).join(', ')}`);
}

/**
 * Escape the LIKE wildcard characters (`%` and `_`) plus the escape char
 * (`|`) itself, so that user-supplied substrings passed to
 * `contains` / `startsWith` / `endsWith` are matched literally.
 * The emitted pattern is always paired with `ESCAPE '|'` in the SQL —
 * see the note on `ilikeNative` for why backslash is avoided here.
 */
function escapeLike(input: string): string {
  return input.replace(/[|%_]/g, (ch) => `|${ch}`);
}

function likeWithEscape(column: AnyColumn, pattern: string): SQL {
  return sql`${like(column, pattern)} escape '|'`;
}

/**
 * Combine a list of sub-clauses with `and(...)` or `or(...)`. Short-circuits
 * on zero branches (returns `undefined`) and single-branch lists (returns
 * the branch directly) so callers don't synthesize trivial connectives.
 */
function combineBranches<TRow>(
  branches: WhereClause<TRow>[],
  combiner: Combiner,
  resolve: ColumnResolver,
  options: TranslateOptions,
): SQL | undefined {
  const translated = branches
    .map((b) => translateWhere(b, resolve, options))
    .filter((s): s is SQL => s !== undefined);
  if (translated.length === 0) return undefined;
  if (translated.length === 1) return translated[0];
  return combiner(...translated);
}

/**
 * Translate a `WhereClause` into a Drizzle `SQL` fragment, or `undefined` if
 * the clause is empty (so callers can skip the `.where(...)` chain entirely).
 */
export function translateWhere<TRow>(
  where: WhereClause<TRow>,
  resolve: ColumnResolver,
  options: TranslateOptions,
): SQL | undefined {
  const conditions: SQL[] = [];

  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;

    if (key === 'AND') {
      const combined = combineBranches((value as WhereClause<TRow>[]) ?? [], and, resolve, options);
      if (combined) conditions.push(combined);
      continue;
    }

    if (key === 'OR') {
      const combined = combineBranches((value as WhereClause<TRow>[]) ?? [], or, resolve, options);
      if (combined) conditions.push(combined);
      continue;
    }

    if (key === 'NOT') {
      const translated = translateWhere(value as WhereClause<TRow>, resolve, options);
      if (translated) conditions.push(not(translated));
      continue;
    }

    const column = resolve(key);
    conditions.push(opCondition(column, value, options));
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0] as SQL;
  return and(...conditions);
}
