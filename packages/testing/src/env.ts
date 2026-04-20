/**
 * Helpers for integration tests that talk to a real Postgres / MySQL.
 *
 * Rules:
 *   - Tests that need a live database read `getPostgresUrl()` /
 *     `getMysqlUrl()`. If the env var is unset the helper returns
 *     `undefined` and the suite short-circuits via `describe.skip(...)`.
 *   - `resetPostgres(url, tableNames)` drops the named tables so each suite
 *     starts clean. Targeted drops (not a full schema wipe) keep tests
 *     isolated even when multiple suites share one database.
 *
 * Driver imports are lazy — SQLite-only consumers of @hopak/testing never
 * pay the install cost.
 */
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);

export function getPostgresUrl(): string | undefined {
  return process.env.POSTGRES_URL || undefined;
}

export function getMysqlUrl(): string | undefined {
  return process.env.MYSQL_URL || undefined;
}

interface PostgresSql {
  unsafe(query: string): Promise<unknown>;
  end(options?: { timeout?: number }): Promise<void>;
}

type PostgresFactory = (url: string) => PostgresSql;

/**
 * Drop a specific set of tables. CASCADE so relations with other FKs don't
 * get in the way. `IF EXISTS` makes first-run safe.
 */
export async function resetPostgres(url: string, tableNames: readonly string[]): Promise<void> {
  if (tableNames.length === 0) return;
  const postgres = require_('postgres') as PostgresFactory | { default: PostgresFactory };
  const factory: PostgresFactory = typeof postgres === 'function' ? postgres : postgres.default;
  const sql = factory(url);
  try {
    const list = tableNames.map((n) => `"${n}"`).join(', ');
    await sql.unsafe(`DROP TABLE IF EXISTS ${list} CASCADE`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

interface MysqlConnection {
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}

interface MysqlDriver {
  createConnection(uri: string): Promise<MysqlConnection>;
}

/**
 * MySQL analogue. `FOREIGN_KEY_CHECKS = 0` allows dropping tables that are
 * referenced by FKs without first dropping the referencing ones.
 */
export async function resetMysql(url: string, tableNames: readonly string[]): Promise<void> {
  if (tableNames.length === 0) return;
  const mysql = require_('mysql2/promise') as MysqlDriver;
  const conn = await mysql.createConnection(url);
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const name of tableNames) {
      await conn.query(`DROP TABLE IF EXISTS \`${name}\``);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    await conn.end();
  }
}
