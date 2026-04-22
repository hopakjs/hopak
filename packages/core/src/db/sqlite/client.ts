import { Database as BunDatabase } from 'bun:sqlite';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { ModelDefinition } from '../../model/define';
import type { Database, ModelClient } from '../client';
import type { ResolveClient } from '../include-executor';
import {
  AbstractSqlModelClient,
  type ModelClientDeps,
  type SqlRunner,
} from '../sql/abstract-client';
import { ilikeAsLike } from '../sql/filter-translator';
import { buildSqliteSchema } from './schema';
import { syncSqliteSchema } from './sync';

export interface SqliteOptions {
  models: readonly ModelDefinition[];
  file?: string;
}

// SQLite inherits the base `upsert` (ON CONFLICT DO UPDATE + RETURNING) and
// the default write path; only the ilike strategy differs from the base.
class SqliteModelClient<TRow extends Record<string, unknown>>
  extends AbstractSqlModelClient<TRow>
  implements ModelClient<TRow>
{
  constructor(db: BunSQLiteDatabase, table: SQLiteTable, modelName: string, deps: ModelClientDeps) {
    super(db as unknown as SqlRunner, table, modelName, deps, ilikeAsLike);
  }
}

/**
 * `isTxView` flags a Database returned inside `transaction(fn)`. The tx
 * shares the connection (so `execute` works) but can't open/close it or
 * start a nested tx, and `sync()` is rejected.
 */
interface SqliteInternal {
  bun: BunDatabase;
  drizzleDb: BunSQLiteDatabase;
  tables: Map<string, SQLiteTable>;
  models: readonly ModelDefinition[];
  isTxView: boolean;
}

class SqliteDatabase implements Database {
  private readonly clients = new Map<string, ModelClient<Record<string, unknown>>>();

  constructor(private readonly inner: SqliteInternal) {}

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
    const client = new SqliteModelClient<TRow>(this.inner.drizzleDb, table, name, {
      modelDef,
      allModels: this.inner.models,
      resolveClient,
    });
    this.clients.set(name, client as ModelClient<Record<string, unknown>>);
    return client;
  }

  raw(): BunSQLiteDatabase {
    return this.inner.drizzleDb;
  }

  async sync(): Promise<void> {
    if (this.inner.isTxView) {
      throw new Error('sync() is not supported inside a transaction. Run migrations first.');
    }
    await syncSqliteSchema(this.inner.bun, this.inner.models);
  }

  async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
    type Binding = string | number | bigint | boolean | null | Uint8Array;
    this.inner.bun.prepare(sql).run(...(params as Binding[]));
  }

  async close(): Promise<void> {
    if (!this.inner.isTxView) this.inner.bun.close();
  }

  /**
   * bun:sqlite transactions are sync-only at the driver level, so instead of
   * using Drizzle's `.transaction(fn)` (sync callback only), the user's async
   * callback is wrapped in raw `BEGIN` / `COMMIT` / `ROLLBACK` statements and
   * the single connection is shared with the tx view. Nested transactions
   * aren't supported in 0.1.0 — SAVEPOINTs are accessible via `raw()`.
   */
  async transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
    if (this.inner.isTxView) {
      throw new Error('Nested transactions are not supported in 0.1.0');
    }
    const bun = this.inner.bun;
    const txDb = new SqliteDatabase({
      bun,
      drizzleDb: this.inner.drizzleDb,
      tables: this.inner.tables,
      models: this.inner.models,
      isTxView: true,
    });
    bun.run('BEGIN');
    try {
      const result = await fn(txDb);
      bun.run('COMMIT');
      return result;
    } catch (err) {
      bun.run('ROLLBACK');
      throw err;
    }
  }
}

export function createSqliteDatabase(options: SqliteOptions): Database {
  const bun = new BunDatabase(options.file ?? ':memory:');
  const drizzleDb = drizzle(bun);
  const schema = buildSqliteSchema(options.models);
  const tables = new Map<string, SQLiteTable>();
  for (const model of options.models) {
    const table = schema[model.name];
    if (table) tables.set(model.name, table);
  }
  return new SqliteDatabase({ bun, drizzleDb, tables, models: options.models, isTxView: false });
}
