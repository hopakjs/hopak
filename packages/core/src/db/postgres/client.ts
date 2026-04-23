import { ConfigError } from '@hopak/common';
import { sql as drizzleSql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ModelDefinition } from '../../model/define';
import type { Database, ModelClient } from '../client';
import type { ResolveClient } from '../include-executor';
import {
  AbstractSqlModelClient,
  type ModelClientDeps,
  type SqlRunner,
} from '../sql/abstract-client';
import { ilikeNative } from '../sql/filter-translator';
import { compileTag } from '../sql/tag';
import { type PostgresSql, loadDrizzleAdapter, loadPostgresDriver } from './driver-loader';
import { buildPostgresSchema } from './schema';
import { syncPostgresSchema } from './sync';

export interface PostgresOptions {
  models: readonly ModelDefinition[];
  url?: string;
}

// Postgres inherits the base client — ON CONFLICT DO UPDATE with RETURNING,
// plus the shared read/write paths. Only the ilike strategy is dialect-specific.
class PostgresModelClient<TRow extends Record<string, unknown>>
  extends AbstractSqlModelClient<TRow>
  implements ModelClient<TRow>
{
  constructor(db: PostgresJsDatabase, table: PgTable, modelName: string, deps: ModelClientDeps) {
    super(db as unknown as SqlRunner, table, modelName, deps, ilikeNative);
  }
}

/**
 * `sql` is `null` on a tx-view — a Database returned inside `transaction(fn)`
 * that shares Drizzle's scoped `tx` handle but doesn't own the connection
 * pool.
 */
interface PostgresInternal {
  sql: PostgresSql | null;
  drizzleDb: PostgresJsDatabase;
  tables: Map<string, PgTable>;
  models: readonly ModelDefinition[];
}

class PostgresDatabase implements Database {
  private readonly clients = new Map<string, ModelClient<Record<string, unknown>>>();

  constructor(private readonly inner: PostgresInternal) {}

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
    const client = new PostgresModelClient<TRow>(this.inner.drizzleDb, table, name, {
      modelDef,
      allModels: this.inner.models,
      resolveClient,
    });
    this.clients.set(name, client as ModelClient<Record<string, unknown>>);
    return client;
  }

  builder(): PostgresJsDatabase {
    return this.inner.drizzleDb;
  }

  async sql<T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<readonly T[]> {
    const { text, bindings } = compileTag(strings, values, 'numbered');
    if (this.inner.sql) {
      // Non-tx: native postgres.js path. `sql.unsafe` returns a Result
      // that's array-like (iterable) with rows or empty for writes.
      const result = await this.inner.sql.unsafe(text, bindings as unknown[]);
      return Array.from(result as Iterable<T>);
    }
    // Tx-view fallback — native postgres.js sql isn't reachable through
    // Drizzle's tx handle, so raw SQL in a transaction defers to Drizzle's
    // own `sql` template for placeholder synthesis ($N for postgres-js).
    // Peer-dep pinning covers the shape-stability assumption.
    const stmt = drizzleSql(strings, ...values);
    const result = await this.inner.drizzleDb.execute(stmt);
    if (Array.isArray(result)) return result as T[];
    const rows = (result as { rows?: unknown[] }).rows;
    if (Array.isArray(rows)) return rows as T[];
    if (typeof (result as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function') {
      return Array.from(result as Iterable<T>);
    }
    return [];
  }

  async sync(): Promise<void> {
    if (!this.inner.sql) {
      throw new Error('sync() is not supported inside a transaction. Run migrations first.');
    }
    await syncPostgresSchema(this.inner.sql, this.inner.models);
  }

  /** @deprecated Use `db.sql\`...\`` — see db/client.ts. Forwarder kept for 0.5.0. */
  async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
    if (this.inner.sql) {
      await this.inner.sql.unsafe(sql, params as unknown[]);
      return;
    }
    if (params.length > 0) {
      throw new Error(
        'execute(sql, params) is not supported inside a transaction on Postgres. Inline values or use ctx.db.model(...).',
      );
    }
    await this.inner.drizzleDb.execute(drizzleSql.raw(sql));
  }

  async close(): Promise<void> {
    if (this.inner.sql) await this.inner.sql.end({ timeout: 5 });
  }

  async transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
    if (!this.inner.sql) {
      throw new Error('Nested transactions are not supported in 0.1.0');
    }
    return this.inner.drizzleDb.transaction(async (tx) => {
      const txDb = new PostgresDatabase({
        sql: null,
        drizzleDb: tx as PostgresJsDatabase,
        tables: this.inner.tables,
        models: this.inner.models,
      });
      return fn(txDb);
    });
  }
}

export function createPostgresDatabase(options: PostgresOptions): Database {
  if (!options.url) {
    throw new ConfigError(
      'Postgres dialect requires a connection URL. Set database.url in hopak.config.ts or DATABASE_URL env.',
    );
  }
  const postgres = loadPostgresDriver();
  const { drizzle } = loadDrizzleAdapter();
  const sql = postgres(options.url);
  const drizzleDb = drizzle(sql);
  const schema = buildPostgresSchema(options.models);
  const tables = new Map<string, PgTable>();
  for (const model of options.models) {
    const table = schema[model.name];
    if (table) tables.set(model.name, table);
  }
  return new PostgresDatabase({ sql, drizzleDb, tables, models: options.models });
}
