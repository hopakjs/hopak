export type Id = number | string;

/**
 * Filter operators for a field. Equality is the default when the field value
 * is a primitive; use a FilterOp object when you need anything else.
 *
 * A few operators (contains/startsWith/endsWith/like/ilike/between) are
 * dialect-specific at runtime. The type intentionally allows them on any
 * field — the translator errors at runtime if a column can't support them,
 * which is friendlier than trying to encode every SQL typing rule statically.
 */
export type FilterOp<T> =
  | { eq: T }
  | { neq: T }
  | { gt: T }
  | { gte: T }
  | { lt: T }
  | { lte: T }
  | { in: T[] }
  | { notIn: T[] }
  | { contains: string }
  | { startsWith: string }
  | { endsWith: string }
  | { like: string }
  | { ilike: string }
  | { between: [T, T] }
  | { isNull: true }
  | { isNotNull: true };

/**
 * A `where` object combines equality / operator filters with optional
 * `OR` / `NOT` connectives. Top-level keys not in `{OR, NOT}` are field
 * names; values are either literals (equality) or `FilterOp`.
 *
 * The default `TRow = Record<string, unknown>` keeps untyped calls
 * — `db.model('post')` — flexible, while passing a row type narrows the
 * acceptable keys and values.
 */
export type WhereClause<TRow = Record<string, unknown>> = {
  [K in keyof TRow]?: TRow[K] | FilterOp<TRow[K]>;
} & {
  /** Top-level conditions are AND'd implicitly; use `AND` when you need to
   * combine pre-built clauses (e.g. a user filter with a system filter). */
  AND?: WhereClause<TRow>[];
  OR?: WhereClause<TRow>[];
  NOT?: WhereClause<TRow>;
};

/**
 * Per-relation include spec. `where` / `orderBy` / `limit` apply to the
 * relation query itself. `limit` is applied to the flat relation query and
 * is therefore a global cap across all parents — not per-parent.
 */
export interface IncludeRelationOptions<TRow = Record<string, unknown>> {
  where?: WhereClause<TRow>;
  orderBy?: { field: string; direction?: 'asc' | 'desc' }[];
  limit?: number;
}

/**
 * Eager-load named relations. `true` fetches with no filter; an object form
 * narrows the relation query. Relation keys are the field names declared
 * with `belongsTo` / `hasOne` / `hasMany` on the model.
 */
export type IncludeClause = {
  [relationName: string]: true | IncludeRelationOptions;
};

export interface FindManyOptions<TRow = Record<string, unknown>> {
  where?: WhereClause<TRow>;
  limit?: number;
  offset?: number;
  orderBy?: { field: keyof TRow & string; direction?: 'asc' | 'desc' }[];
  include?: IncludeClause;
  /**
   * Return only the listed columns. The result rows are typed
   * `Pick<TRow, ...>`. When combined with `include`, FK columns needed for
   * relation resolution are transparently added to the projection, so the
   * include still works; the included relations appear on the returned
   * rows regardless of whether you list them in `select`.
   */
  select?: (keyof TRow & string)[];
  /**
   * Deduplicate result rows. `true` emits `SELECT DISTINCT` and works on all
   * dialects. An array of columns emits `SELECT DISTINCT ON (...)` — Postgres
   * only; SQLite and MySQL throw a clear error asking to drop to `raw()`.
   */
  distinct?: true | (keyof TRow & string)[];
  /**
   * Cursor-based (keyset) pagination. Pass the value of the cursor column
   * from the last seen row; returns rows strictly after it. The cursor key
   * must appear in `orderBy` — the direction there decides `>` vs `<`.
   * Single-column cursors only in 0.1.0; multi-column keyset requires
   * tuple-comparison syntax that isn't uniform across dialects.
   */
  cursor?: { [K in keyof TRow]?: TRow[K] };
  /**
   * Row-level locking inside a transaction. `'forUpdate'` emits
   * `SELECT ... FOR UPDATE` (exclusive lock), `'forShare'` emits
   * `FOR SHARE` (allows other readers). **Postgres + MySQL only.**
   * SQLite silently ignores this — its transactions are already exclusive.
   * Only locks the primary rows; an `include` fetches relations via
   * separate, unlocked queries.
   */
  lock?: 'forUpdate' | 'forShare';
}

export interface UpsertOptions<TRow = Record<string, unknown>> {
  /**
   * Columns and values that identify the row. Their keys become the conflict
   * target on SQLite/Postgres and are merged into the create payload. Only
   * flat equality is supported — operators (`gte`, `OR`, ...) aren't
   * meaningful as conflict targets.
   */
  where: { [K in keyof TRow]?: TRow[K] };
  create: Partial<TRow>;
  update: Partial<TRow>;
}

export interface UpdateManyOptions<TRow = Record<string, unknown>> {
  where?: WhereClause<TRow>;
  data: Partial<TRow>;
}

export interface DeleteManyOptions<TRow = Record<string, unknown>> {
  where?: WhereClause<TRow>;
}

export interface AggregateOptions<TRow = Record<string, unknown>> {
  where?: WhereClause<TRow>;
  sum?: (keyof TRow & string)[];
  avg?: (keyof TRow & string)[];
  min?: (keyof TRow & string)[];
  max?: (keyof TRow & string)[];
  /**
   * Count non-null values for specific columns, or `'_all'` for the row count
   * (equivalent to `count(*)`). Defaults to no count if omitted.
   */
  count?: (keyof TRow & string)[] | '_all';
  /**
   * Group rows by the listed columns. When present, `aggregate` returns an
   * array — one row per distinct combination of group values. Each row is
   * `AggregateResult` merged with the group column values.
   */
  groupBy?: (keyof TRow & string)[];
}

export interface AggregateResult {
  sum?: Record<string, number>;
  avg?: Record<string, number>;
  min?: Record<string, number>;
  max?: Record<string, number>;
  count?: Record<string, number>;
}

export interface BatchResult {
  count: number;
}

export interface FindOneOptions {
  lock?: 'forUpdate' | 'forShare';
}

export interface ModelClient<TRow = Record<string, unknown>> {
  /** Column-projection overload. Invoked when `select` is present. */
  findMany<K extends keyof TRow & string>(
    options: FindManyOptions<TRow> & { select: readonly K[] },
  ): Promise<Pick<TRow, K>[]>;
  findMany(options?: FindManyOptions<TRow>): Promise<TRow[]>;
  findOne(id: Id, options?: FindOneOptions): Promise<TRow | null>;
  findOrFail(id: Id, options?: FindOneOptions): Promise<TRow>;
  count(options?: Pick<FindManyOptions<TRow>, 'where'>): Promise<number>;
  create(data: Partial<TRow>): Promise<TRow>;
  update(id: Id, data: Partial<TRow>): Promise<TRow>;
  delete(id: Id): Promise<boolean>;
  upsert(options: UpsertOptions<TRow>): Promise<TRow>;
  createMany(data: Partial<TRow>[]): Promise<BatchResult>;
  updateMany(options: UpdateManyOptions<TRow>): Promise<BatchResult>;
  deleteMany(options: DeleteManyOptions<TRow>): Promise<BatchResult>;
  /** Grouped overload: array of rows, one per group. */
  aggregate<K extends keyof TRow & string>(
    options: AggregateOptions<TRow> & { groupBy: readonly K[] },
  ): Promise<Array<AggregateResult & Pick<TRow, K>>>;
  aggregate(options: AggregateOptions<TRow>): Promise<AggregateResult>;
}

export interface Database {
  model<TRow extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
  ): ModelClient<TRow>;
  raw(): unknown;
  sync(): Promise<void>;
  close(): Promise<void>;
  /**
   * Run `fn` inside a database transaction. Commits when `fn` resolves,
   * rolls back if `fn` (or any query inside) throws. The `tx` argument is a
   * scoped `Database` whose `model(name)` returns clients bound to the
   * transaction — outside queries on the parent `Database` are not part of
   * the transaction.
   *
   * Nested transactions (calling `tx.transaction(...)` inside another
   * transaction) are not supported in 0.1.0. Calling `tx.sync()` is also
   * an error — run migrations before entering a transaction.
   */
  transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T>;
}
