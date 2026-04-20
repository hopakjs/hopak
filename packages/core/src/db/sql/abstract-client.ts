/**
 * Abstract base for SQL ModelClient implementations.
 *
 * Drizzle's runtime API is structurally identical across its three SQL
 * dialects — `select / from / where / orderBy / limit / offset`, plus
 * `insert / update / delete` with `.returning()` on the two that support
 * it — so 90% of the ModelClient surface can live here. Each concrete
 * subclass supplies:
 *
 *   - a typed `db` handle (via the generic parameter)
 *   - an `ilike` strategy (Postgres has native `ILIKE`; SQLite / MySQL don't)
 *   - the two dialect-specific pieces that can't be avoided:
 *       * `upsert(...)` — `ON CONFLICT DO UPDATE` vs `ON DUPLICATE KEY UPDATE`
 *       * the "no RETURNING" overrides for MySQL (create/update/delete/batch)
 *
 * Everything else is inherited: `findMany / findOne / findOrFail / count /
 * aggregate` plus the shared `buildWhere` and `columnFor` helpers.
 */
import { NotFound } from '@hopak/common';
import { type AnyColumn, type SQL, asc, desc, getTableColumns, sql } from 'drizzle-orm';
import type { ModelDefinition } from '../../model/define';
import type {
  AggregateOptions,
  AggregateResult,
  BatchResult,
  DeleteManyOptions,
  FindManyOptions,
  FindOneOptions,
  Id,
  ModelClient,
  UpdateManyOptions,
  UpsertOptions,
  WhereClause,
} from '../client';
import { type ResolveClient, executeInclude } from '../include-executor';
import { buildAggregatePlan } from './aggregate-translator';
import {
  type DeleteWhereLike,
  type InsertBuilderLike,
  type UpdateBuilderLike,
  insertValues,
  updateSet,
  whereEq,
} from './drizzle-bridge';
import { type IlikeStrategy, translateWhere } from './filter-translator';

/**
 * Duck-typed view of a Drizzle database / transaction handle. Every method
 * listed here has the same signature at runtime across bun-sqlite /
 * postgres-js / mysql2 Drizzle bindings — that symmetry is what lets the
 * method bodies below be shared.
 */
export interface SqlRunner {
  select(): { from(table: unknown): QueryChain };
  select<TShape extends Record<string, AnyColumn | SQL>>(
    shape: TShape,
  ): { from(table: unknown): QueryChain };
  selectDistinct(): { from(table: unknown): QueryChain };
  selectDistinct<TShape extends Record<string, AnyColumn | SQL>>(
    shape: TShape,
  ): { from(table: unknown): QueryChain };
  /** Postgres only. Absent on SQLite + MySQL — checked at runtime. */
  selectDistinctOn?(on: readonly AnyColumn[]): { from(table: unknown): QueryChain };
  selectDistinctOn?<TShape extends Record<string, AnyColumn | SQL>>(
    on: readonly AnyColumn[],
    shape: TShape,
  ): { from(table: unknown): QueryChain };
  insert(table: unknown): InsertBuilderLike;
  update(table: unknown): UpdateBuilderLike;
  delete(table: unknown): DeleteWhereLike;
}

/** The result of `select().from(t)`. PromiseLike so `await` resolves rows. */
interface QueryChain extends PromiseLike<unknown[]> {
  where(cond: SQL): QueryChain;
  orderBy(...cols: SQL[]): QueryChain;
  groupBy(...cols: (AnyColumn | SQL)[]): QueryChain;
  limit(n: number): QueryChain;
  offset(n: number): QueryChain;
  /** Postgres + MySQL only; SQLite omits this method (silent no-op). */
  for?(strength: 'update' | 'share' | 'no key update' | 'key share'): QueryChain;
}

export interface ModelClientDeps {
  modelDef: ModelDefinition;
  allModels: readonly ModelDefinition[];
  resolveClient: ResolveClient;
}

export abstract class AbstractSqlModelClient<TRow extends Record<string, unknown>>
  implements ModelClient<TRow>
{
  protected readonly columns: Record<string, AnyColumn>;
  protected readonly translateOptions: { ilike: IlikeStrategy };

  constructor(
    protected readonly db: SqlRunner,
    protected readonly table: unknown,
    protected readonly modelName: string,
    protected readonly deps: ModelClientDeps,
    ilike: IlikeStrategy,
  ) {
    this.columns = getTableColumns(table as Parameters<typeof getTableColumns>[0]) as Record<
      string,
      AnyColumn
    >;
    this.translateOptions = { ilike };
  }

  // -------- helpers shared by every method --------

  protected columnFor(field: string): AnyColumn {
    const column = this.columns[field];
    if (!column) {
      throw new Error(`Unknown field "${field}" on model "${this.modelName}"`);
    }
    return column;
  }

  protected buildWhere(where?: WhereClause<TRow>): SQL | undefined {
    if (!where) return undefined;
    return translateWhere(where, (field) => this.columnFor(field), this.translateOptions);
  }

  /**
   * Convert a cursor object into a WhereClause the filter-translator handles.
   * Single-key only: validates shape, locates the matching orderBy entry, and
   * emits `{ field: { gt | lt: value } }`. AND-merged with user's `where`.
   */
  private cursorWhere(
    cursor: FindManyOptions<TRow>['cursor'],
    orderBy: FindManyOptions<TRow>['orderBy'],
  ): WhereClause<TRow> | undefined {
    if (!cursor) return undefined;
    const keys = Object.keys(cursor).filter(
      (k) => (cursor as Record<string, unknown>)[k] !== undefined,
    );
    if (keys.length !== 1) {
      throw new Error(
        "cursor must have exactly one key. Multi-column cursors aren't supported in 0.1.0.",
      );
    }
    const [key] = keys as [string];
    const value = (cursor as Record<string, unknown>)[key];
    if (value === null) {
      throw new Error(`cursor.${key} cannot be null — cursor values must be comparable.`);
    }
    const orderEntry = orderBy?.find((o) => o.field === key);
    if (!orderEntry) {
      throw new Error(
        `cursor.${key} requires a matching orderBy entry. Add orderBy: [{ field: '${key}', direction: 'asc' | 'desc' }].`,
      );
    }
    const op = orderEntry.direction === 'desc' ? 'lt' : 'gt';
    // The runtime shape matches `WhereClause<TRow>` structurally; the
    // double-cast acknowledges the clause is built dynamically.
    return { [key]: { [op]: value } } as unknown as WhereClause<TRow>;
  }

  // -------- read path (identical on all three dialects) --------

  findMany<K extends keyof TRow & string>(
    options: FindManyOptions<TRow> & { select: readonly K[] },
  ): Promise<Pick<TRow, K>[]>;
  findMany(options?: FindManyOptions<TRow>): Promise<TRow[]>;
  async findMany(options: FindManyOptions<TRow> = {}): Promise<unknown[]> {
    const cursorWhere = this.cursorWhere(options.cursor, options.orderBy);
    const mergedWhere: WhereClause<TRow> | undefined = cursorWhere
      ? options.where
        ? ({ AND: [options.where, cursorWhere] } as WhereClause<TRow>)
        : cursorWhere
      : options.where;
    const where = this.buildWhere(mergedWhere);
    const orderBy =
      options.orderBy?.map(({ field, direction }) =>
        direction === 'desc' ? desc(this.columnFor(field)) : asc(this.columnFor(field)),
      ) ?? [];

    // When `select` is set, use Drizzle's projection form and additionally
    // ensure any FK field needed by an `include` is present in the
    // projection — otherwise the executor can't resolve the relation.
    const shape = options.select
      ? this.projectionShape(options.select, options.include)
      : undefined;
    const base = this.chooseSelect(options.distinct, shape).from(this.table);
    const filtered = where ? base.where(where) : base;
    const ordered = orderBy.length > 0 ? filtered.orderBy(...orderBy) : filtered;
    const limited = options.limit !== undefined ? ordered.limit(options.limit) : ordered;
    const offsetted = options.offset !== undefined ? limited.offset(options.offset) : limited;
    const locked = this.applyLock(offsetted, options.lock);
    const rows = (await locked) as Record<string, unknown>[];
    if (options.include) {
      await executeInclude(
        this.deps.modelDef,
        rows,
        options.include,
        this.deps.allModels,
        this.deps.resolveClient,
      );
    }
    return rows;
  }

  /**
   * Pick the right Drizzle select entry point based on `distinct`:
   *   - undefined → `.select(...)`
   *   - `true`    → `.selectDistinct(...)` (all dialects)
   *   - `string[]` → `.selectDistinctOn(cols, ...)` — **Postgres only**; the
   *     method is absent on SQLite / MySQL's runner, so a clear error is
   *     thrown instead of letting callers hit an opaque runtime failure.
   */
  private chooseSelect(
    distinct: FindManyOptions<TRow>['distinct'],
    shape: Record<string, AnyColumn> | undefined,
  ): { from(table: unknown): QueryChain } {
    if (distinct === true) {
      return shape ? this.db.selectDistinct(shape) : this.db.selectDistinct();
    }
    if (Array.isArray(distinct)) {
      if (distinct.length === 0) {
        throw new Error('distinct: [] is empty. Use `distinct: true` or list at least one column.');
      }
      if (!this.db.selectDistinctOn) {
        throw new Error(
          'distinct: [columns] requires Postgres (SELECT DISTINCT ON). Use `distinct: true` or drop to raw() on SQLite / MySQL.',
        );
      }
      const onCols = distinct.map((c) => this.columnFor(c));
      return shape ? this.db.selectDistinctOn(onCols, shape) : this.db.selectDistinctOn(onCols);
    }
    return shape ? this.db.select(shape) : this.db.select();
  }

  /**
   * Build a Drizzle `select(shape)` object from the user's `select` keys plus
   * any FK columns an `include` needs. `id` is always present because
   * `hasMany` / `hasOne` relation resolution groups by primary id.
   */
  private projectionShape(
    keys: readonly string[],
    include: FindManyOptions<TRow>['include'],
  ): Record<string, AnyColumn> {
    const picked = new Set<string>(keys);
    if (include) {
      picked.add('id');
      for (const [relationName, raw] of Object.entries(include)) {
        if (raw == null) continue;
        const field = this.deps.modelDef.fields[relationName];
        if (field?.type === 'belongsTo') picked.add(relationName);
      }
    }
    const shape: Record<string, AnyColumn> = {};
    for (const key of picked) shape[key] = this.columnFor(key);
    return shape;
  }

  async findOne(id: Id, options: FindOneOptions = {}): Promise<TRow | null> {
    const base = this.db
      .select()
      .from(this.table)
      .where(whereEq(this.columnFor('id'), id))
      .limit(1);
    const locked = this.applyLock(base, options.lock);
    const rows = await locked;
    return (rows[0] as TRow | undefined) ?? null;
  }

  async findOrFail(id: Id, options: FindOneOptions = {}): Promise<TRow> {
    const row = await this.findOne(id, options);
    if (!row) throw new NotFound(`${this.modelName} #${id} not found`);
    return row;
  }

  /**
   * Apply `SELECT ... FOR UPDATE / FOR SHARE` when the dialect supports it.
   * SQLite's Drizzle runner has no `.for()` method — the call is silently
   * skipped, which is safe since SQLite transactions are already
   * single-writer.
   */
  private applyLock(chain: QueryChain, lock: FindOneOptions['lock']): QueryChain {
    if (!lock) return chain;
    if (!chain.for) return chain; // SQLite — no-op by design
    const strength = lock === 'forUpdate' ? 'update' : 'share';
    return chain.for(strength);
  }

  async count(options: Pick<FindManyOptions<TRow>, 'where'> = {}): Promise<number> {
    const where = this.buildWhere(options.where);
    // Postgres returns count as BigInt → stringified; SQLite / MySQL return number.
    // `Number(row.value ?? 0)` normalizes either shape.
    const base = this.db.select({ value: sql<number>`count(*)` }).from(this.table);
    const filtered = where ? base.where(where) : base;
    const rows = (await filtered) as { value: number | string }[];
    return Number(rows[0]?.value ?? 0);
  }

  aggregate<K extends keyof TRow & string>(
    options: AggregateOptions<TRow> & { groupBy: readonly K[] },
  ): Promise<Array<AggregateResult & Pick<TRow, K>>>;
  aggregate(options: AggregateOptions<TRow>): Promise<AggregateResult>;
  async aggregate(options: AggregateOptions<TRow>): Promise<unknown> {
    const plan = buildAggregatePlan(options, (field) => this.columnFor(field));
    const where = this.buildWhere(options.where);
    const base = this.db.select(plan.selectShape).from(this.table);
    const filtered = where ? base.where(where) : base;
    const grouped = plan.groupByCols ? filtered.groupBy(...plan.groupByCols) : filtered;
    const rows = (await grouped) as Record<string, unknown>[];
    return plan.groupByCols ? rows.map(plan.unpack) : plan.unpack(rows[0] ?? {});
  }

  // -------- write path: default = RETURNING (SQLite / Postgres) --------
  // MySQL subclass overrides all of these to use a 2-step fetch.

  async create(data: Partial<TRow>): Promise<TRow> {
    const builder = insertValues(this.db.insert(this.table), data);
    const returning = builder.returning?.bind(builder);
    if (!returning) {
      throw new Error('returning() unavailable — subclass must override create()');
    }
    const rows = (await returning()) as TRow[];
    return rows[0] as TRow;
  }

  async update(id: Id, data: Partial<TRow>): Promise<TRow> {
    const builder = updateSet(this.db.update(this.table), data).where(
      whereEq(this.columnFor('id'), id),
    );
    const returning = builder.returning?.bind(builder);
    if (!returning) {
      throw new Error('returning() unavailable — subclass must override update()');
    }
    const rows = (await returning()) as TRow[];
    if (!rows[0]) throw new NotFound(`${this.modelName} #${id} not found`);
    return rows[0];
  }

  async delete(id: Id): Promise<boolean> {
    const builder = this.db.delete(this.table).where(whereEq(this.columnFor('id'), id));
    const returning = builder.returning?.bind(builder);
    if (!returning) {
      throw new Error('returning() unavailable — subclass must override delete()');
    }
    const rows = await returning();
    return rows.length > 0;
  }

  async createMany(data: Partial<TRow>[]): Promise<BatchResult> {
    if (data.length === 0) return { count: 0 };
    const builder = insertValues(this.db.insert(this.table), data);
    const returning = builder.returning?.bind(builder);
    if (!returning) {
      throw new Error('returning() unavailable — subclass must override createMany()');
    }
    const rows = await returning();
    return { count: rows.length };
  }

  async updateMany(options: UpdateManyOptions<TRow>): Promise<BatchResult> {
    const where = this.buildWhere(options.where);
    const base = updateSet(this.db.update(this.table), options.data);
    const filtered = where ? base.where(where) : base;
    const returning = filtered.returning?.bind(filtered);
    if (!returning) {
      throw new Error('returning() unavailable — subclass must override updateMany()');
    }
    const rows = await returning();
    return { count: rows.length };
  }

  async deleteMany(options: DeleteManyOptions<TRow>): Promise<BatchResult> {
    const where = this.buildWhere(options.where);
    const base = this.db.delete(this.table);
    const filtered = where ? base.where(where) : base;
    const returning = filtered.returning?.bind(filtered);
    if (!returning) {
      throw new Error('returning() unavailable — subclass must override deleteMany()');
    }
    const rows = await returning();
    return { count: rows.length };
  }

  /**
   * SQLite + Postgres share the `ON CONFLICT DO UPDATE ... RETURNING` shape,
   * so the default uses that. MySQL overrides with `ON DUPLICATE KEY UPDATE`
   * plus a follow-up `SELECT` (no RETURNING in MySQL).
   */
  async upsert(options: UpsertOptions<TRow>): Promise<TRow> {
    const conflictTarget = Object.keys(options.where).map((k) => this.columnFor(k));
    const insertData = { ...options.where, ...options.create } as Partial<TRow>;
    const builder = insertValues(this.db.insert(this.table), insertData);
    if (!builder.onConflictDoUpdate || !builder.returning) {
      throw new Error(
        'upsert(): Drizzle adapter missing onConflictDoUpdate/returning — subclass must override',
      );
    }
    const chained = builder.onConflictDoUpdate({
      target: conflictTarget,
      set: options.update,
    });
    const rows = (await chained.returning?.()) ?? [];
    return rows[0] as TRow;
  }
}
