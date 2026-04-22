import { ConfigError, NotFound } from '@hopak/common';
import { sql as drizzleSql } from 'drizzle-orm';
import type { MySqlTable } from 'drizzle-orm/mysql-core';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import type { ModelDefinition } from '../../model/define';
import type {
  BatchResult,
  Database,
  DeleteManyOptions,
  Id,
  ModelClient,
  UpdateManyOptions,
  UpsertOptions,
  WhereClause,
} from '../client';
import type { ResolveClient } from '../include-executor';
import {
  AbstractSqlModelClient,
  type ModelClientDeps,
  type SqlRunner,
} from '../sql/abstract-client';
import {
  type InsertValuesLike,
  insertValues,
  unpackHeader,
  updateSet,
  whereEq,
} from '../sql/drizzle-bridge';
import { withUniqueToConflict } from '../sql/error-translator';
import { ilikeAsLike } from '../sql/filter-translator';
import { type MysqlPool, loadDrizzleMysqlAdapter, loadMysqlDriver } from './driver-loader';
import { buildMysqlSchema } from './schema';
import { syncMysqlSchema } from './sync';

export interface MysqlOptions {
  models: readonly ModelDefinition[];
  url?: string;
}

/**
 * MySQL lacks `RETURNING` on INSERT/UPDATE/DELETE, so every write path here
 * overrides the abstract base and either does a follow-up SELECT (for
 * `create` / `update` / `upsert`) or reads `affectedRows` / `insertId` off
 * the mysql2 `ResultSetHeader` (for batch ops). `unpackHeader` normalizes
 * both "raw header" and "[header, fields]" shapes Drizzle may surface.
 */
interface MysqlInsertHeader {
  insertId: number;
  affectedRows: number;
}

interface MysqlUpdateHeader {
  affectedRows: number;
}

class MysqlModelClient<TRow extends Record<string, unknown>>
  extends AbstractSqlModelClient<TRow>
  implements ModelClient<TRow>
{
  constructor(db: MySql2Database, table: MySqlTable, modelName: string, deps: ModelClientDeps) {
    super(db as unknown as SqlRunner, table, modelName, deps, ilikeAsLike);
  }

  override async create(data: Partial<TRow>): Promise<TRow> {
    return withUniqueToConflict(async () => {
      const result = await insertValues(this.db.insert(this.table), data);
      const header = unpackHeader<MysqlInsertHeader>(result);
      return this.findOrFail(header.insertId);
    });
  }

  override async update(id: Id, data: Partial<TRow>): Promise<TRow> {
    return withUniqueToConflict(async () => {
      const result = await updateSet(this.db.update(this.table), data).where(
        whereEq(this.columnFor('id'), id),
      );
      const header = unpackHeader<MysqlUpdateHeader>(result);
      if (header.affectedRows === 0) {
        throw new NotFound(`${this.modelName} #${id} not found`);
      }
      return this.findOrFail(id);
    });
  }

  override async delete(id: Id): Promise<boolean> {
    const result = await this.db.delete(this.table).where(whereEq(this.columnFor('id'), id));
    const header = unpackHeader<MysqlUpdateHeader>(result);
    return header.affectedRows > 0;
  }

  override async upsert(options: UpsertOptions<TRow>): Promise<TRow> {
    // The re-fetch below keys on `options.where`, so an `update` that
    // rewrites one of those keys would find the wrong row (or nothing).
    // Caller's bug, but worth catching early — the SQL wouldn't complain.
    for (const key of Object.keys(options.where as Record<string, unknown>)) {
      if (key in (options.update as Record<string, unknown>)) {
        throw new Error(
          `upsert: field "${key}" appears in both \`where\` and \`update\`. Pick one.`,
        );
      }
    }
    const insertData = { ...options.where, ...options.create } as Partial<TRow>;
    const builder = insertValues(this.db.insert(this.table), insertData);
    if (!builder.onDuplicateKeyUpdate) {
      throw new Error('MySQL Drizzle adapter missing onDuplicateKeyUpdate');
    }
    const chained: InsertValuesLike = builder.onDuplicateKeyUpdate({ set: options.update });
    await chained;
    // MySQL has no RETURNING — fetch the row by the stable `where` keys.
    const found = await this.findMany({
      where: options.where as WhereClause<TRow>,
      limit: 1,
    });
    return found[0] as TRow;
  }

  override async createMany(data: Partial<TRow>[]): Promise<BatchResult> {
    if (data.length === 0) return { count: 0 };
    return withUniqueToConflict(async () => {
      const result = await insertValues(this.db.insert(this.table), data);
      const header = unpackHeader<MysqlUpdateHeader>(result);
      return { count: header.affectedRows };
    });
  }

  override async updateMany(options: UpdateManyOptions<TRow>): Promise<BatchResult> {
    return withUniqueToConflict(async () => {
      const where = this.buildWhere(options.where);
      const base = updateSet(this.db.update(this.table), options.data);
      const filtered = where ? base.where(where) : base;
      const header = unpackHeader<MysqlUpdateHeader>(await filtered);
      return { count: header.affectedRows };
    });
  }

  override async deleteMany(options: DeleteManyOptions<TRow>): Promise<BatchResult> {
    const where = this.buildWhere(options.where);
    const base = this.db.delete(this.table);
    const filtered = where ? base.where(where) : base;
    const header = unpackHeader<MysqlUpdateHeader>(await filtered);
    return { count: header.affectedRows };
  }
}

/**
 * `pool` is `null` on a tx-view — a Database returned inside `transaction(fn)`
 * that shares Drizzle's scoped `tx` handle but doesn't own the connection
 * pool.
 */
interface MysqlInternal {
  pool: MysqlPool | null;
  drizzleDb: MySql2Database;
  tables: Map<string, MySqlTable>;
  models: readonly ModelDefinition[];
}

class MysqlDatabase implements Database {
  private readonly clients = new Map<string, ModelClient<Record<string, unknown>>>();

  constructor(private readonly inner: MysqlInternal) {}

  model<TRow extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
  ): ModelClient<TRow> {
    const cached = this.clients.get(name);
    if (cached) return cached as ModelClient<TRow>;
    const table = this.inner.tables.get(name);
    const modelDef = this.inner.models.find((m) => m.name === name);
    if (!table || !modelDef) {
      throw new Error(
        `Model "${name}" is not registered. Create app/models/${name}.ts with a default export, or check that hopak is scanning the right directory.`,
      );
    }
    const resolveClient: ResolveClient = (sibling) => this.model(sibling);
    const client = new MysqlModelClient<TRow>(this.inner.drizzleDb, table, name, {
      modelDef,
      allModels: this.inner.models,
      resolveClient,
    });
    this.clients.set(name, client as ModelClient<Record<string, unknown>>);
    return client;
  }

  raw(): MySql2Database {
    return this.inner.drizzleDb;
  }

  async sync(): Promise<void> {
    if (!this.inner.pool) {
      throw new Error('sync() is not supported inside a transaction. Run migrations first.');
    }
    await syncMysqlSchema(this.inner.pool, this.inner.models);
  }

  async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
    if (this.inner.pool) {
      await this.inner.pool.execute(sql, params as unknown[]);
      return;
    }
    if (params.length > 0) {
      throw new Error(
        'execute(sql, params) is not supported inside a transaction on MySQL. Inline values or use ctx.db.model(...).',
      );
    }
    await this.inner.drizzleDb.execute(drizzleSql.raw(sql));
  }

  async close(): Promise<void> {
    if (this.inner.pool) await this.inner.pool.end();
  }

  async transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
    if (!this.inner.pool) {
      throw new Error('Nested transactions are not supported in 0.1.0');
    }
    return this.inner.drizzleDb.transaction(async (tx) => {
      const txDb = new MysqlDatabase({
        pool: null,
        drizzleDb: tx as MySql2Database,
        tables: this.inner.tables,
        models: this.inner.models,
      });
      return fn(txDb);
    });
  }
}

export function createMysqlDatabase(options: MysqlOptions): Database {
  if (!options.url) {
    throw new ConfigError(
      'MySQL dialect requires a connection URL. Set database.url in hopak.config.ts or DATABASE_URL env.',
    );
  }
  const driver = loadMysqlDriver();
  const { drizzle } = loadDrizzleMysqlAdapter();
  const pool = driver.createPool(options.url);
  const drizzleDb = drizzle(pool);
  const schema = buildMysqlSchema(options.models);
  const tables = new Map<string, MySqlTable>();
  for (const model of options.models) {
    const table = schema[model.name];
    if (table) tables.set(model.name, table);
  }
  return new MysqlDatabase({ pool, drizzleDb, tables, models: options.models });
}
