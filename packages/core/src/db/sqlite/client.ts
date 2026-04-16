import { Database as BunDatabase } from 'bun:sqlite';
import { NotFound } from '@hopak/common';
import { type AnyColumn, type SQL, and, asc, desc, getTableColumns, sql } from 'drizzle-orm';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { ModelDefinition } from '../../model/define';
import type { Database, FindManyOptions, Id, ModelClient } from '../client';
import { insertValues, updateSet, whereEq } from './drizzle-bridge';
import { type SqliteSchema, buildSqliteSchema } from './schema';
import { syncSqliteSchema } from './sync';

export interface SqliteOptions {
  models: readonly ModelDefinition[];
  file?: string;
}

class SqliteModelClient<TRow extends Record<string, unknown>> implements ModelClient<TRow> {
  private readonly columns: Record<string, AnyColumn>;

  constructor(
    private readonly db: BunSQLiteDatabase,
    private readonly table: SQLiteTable,
    private readonly modelName: string,
  ) {
    this.columns = getTableColumns(table) as Record<string, AnyColumn>;
  }

  private columnFor(field: string): AnyColumn {
    const column = this.columns[field];
    if (!column) {
      throw new Error(`Unknown field "${field}" on model "${this.modelName}"`);
    }
    return column;
  }

  private buildWhere(where?: Record<string, unknown>): SQL | undefined {
    if (!where) return undefined;
    const conditions = Object.entries(where).map(([key, value]) =>
      whereEq(this.columnFor(key), value),
    );
    if (conditions.length === 0) return undefined;
    if (conditions.length === 1) return conditions[0];
    return and(...conditions);
  }

  async findMany(options: FindManyOptions = {}): Promise<TRow[]> {
    const where = this.buildWhere(options.where);
    const orderBy =
      options.orderBy?.map(({ field, direction }) =>
        direction === 'desc' ? desc(this.columnFor(field)) : asc(this.columnFor(field)),
      ) ?? [];

    const base = this.db.select().from(this.table);
    const filtered = where ? base.where(where) : base;
    const ordered = orderBy.length > 0 ? filtered.orderBy(...orderBy) : filtered;
    const limited = options.limit !== undefined ? ordered.limit(options.limit) : ordered;
    const final = options.offset !== undefined ? limited.offset(options.offset) : limited;
    return (await final) as TRow[];
  }

  async findOne(id: Id): Promise<TRow | null> {
    const rows = await this.db
      .select()
      .from(this.table)
      .where(whereEq(this.columnFor('id'), id))
      .limit(1);
    return (rows[0] as TRow | undefined) ?? null;
  }

  async findOrFail(id: Id): Promise<TRow> {
    const row = await this.findOne(id);
    if (!row) throw new NotFound(`${this.modelName} #${id} not found`);
    return row;
  }

  async count(options: Pick<FindManyOptions, 'where'> = {}): Promise<number> {
    const where = this.buildWhere(options.where);
    const base = this.db.select({ value: sql<number>`count(*)` }).from(this.table);
    const filtered = where ? base.where(where) : base;
    const rows = (await filtered) as { value: number }[];
    return Number(rows[0]?.value ?? 0);
  }

  async create(data: Partial<TRow>): Promise<TRow> {
    const inserted = await insertValues(this.db.insert(this.table), data).returning();
    return inserted[0] as TRow;
  }

  async update(id: Id, data: Partial<TRow>): Promise<TRow> {
    const updated = await updateSet(this.db.update(this.table), data)
      .where(whereEq(this.columnFor('id'), id))
      .returning();
    if (!updated[0]) throw new NotFound(`${this.modelName} #${id} not found`);
    return updated[0] as TRow;
  }

  async delete(id: Id): Promise<boolean> {
    const result = await this.db
      .delete(this.table)
      .where(whereEq(this.columnFor('id'), id))
      .returning();
    return result.length > 0;
  }
}

class SqliteDatabase implements Database {
  private readonly bun: BunDatabase;
  private readonly drizzleDb: BunSQLiteDatabase;
  private readonly schema: SqliteSchema;
  private readonly tables = new Map<string, SQLiteTable>();
  private readonly clients = new Map<string, ModelClient<Record<string, unknown>>>();
  private readonly models: readonly ModelDefinition[];

  constructor(options: SqliteOptions) {
    this.bun = new BunDatabase(options.file ?? ':memory:');
    this.drizzleDb = drizzle(this.bun);
    this.models = options.models;
    this.schema = buildSqliteSchema(options.models);
    for (const model of options.models) {
      const table = this.schema[model.name];
      if (table) this.tables.set(model.name, table);
    }
  }

  model<TRow extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
  ): ModelClient<TRow> {
    const cached = this.clients.get(name);
    if (cached) return cached as ModelClient<TRow>;
    const table = this.tables.get(name);
    if (!table) {
      throw new Error(
        `Model "${name}" is not registered. Create app/models/${name}.ts with a default export, or check that hopak is scanning the right directory.`,
      );
    }
    const client = new SqliteModelClient<TRow>(this.drizzleDb, table, name);
    this.clients.set(name, client as ModelClient<Record<string, unknown>>);
    return client;
  }

  raw(): BunSQLiteDatabase {
    return this.drizzleDb;
  }

  async sync(): Promise<void> {
    syncSqliteSchema(this.bun, this.models);
  }

  async close(): Promise<void> {
    this.bun.close();
  }
}

export function createSqliteDatabase(options: SqliteOptions): Database {
  return new SqliteDatabase(options);
}
