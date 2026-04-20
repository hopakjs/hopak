import { createRequire } from 'node:module';
import { ConfigError } from '@hopak/common';
import type { MySql2Database } from 'drizzle-orm/mysql2';

/**
 * mysql2 and drizzle-orm/mysql2 are loaded synchronously via `createRequire`
 * so the Database factory stays synchronous. `drizzle-orm/mysql2` pulls
 * mysql2 at module load, so both are required together and a single
 * `ConfigError` with an install hint is surfaced if the driver is missing.
 */

export interface MysqlPool {
  query(sql: string): Promise<unknown>;
  execute(sql: string, params?: unknown[]): Promise<unknown>;
  end(): Promise<void>;
}

export interface MysqlDriver {
  createPool(uri: string): MysqlPool;
}

export interface DrizzleMysqlAdapter {
  drizzle(pool: MysqlPool): MySql2Database;
}

const require_ = createRequire(import.meta.url);

let cachedDriver: MysqlDriver | undefined;
let cachedAdapter: DrizzleMysqlAdapter | undefined;

export function loadMysqlDriver(): MysqlDriver {
  if (cachedDriver) return cachedDriver;
  try {
    const loaded = require_('mysql2/promise') as MysqlDriver;
    cachedDriver = loaded;
    return loaded;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') {
      throw new ConfigError(
        'MySQL driver not installed. Run: hopak use mysql (or: bun add mysql2)',
      );
    }
    throw error;
  }
}

export function loadDrizzleMysqlAdapter(): DrizzleMysqlAdapter {
  if (cachedAdapter) return cachedAdapter;
  // Trigger the driver check first so the user sees the clearer error.
  loadMysqlDriver();
  const adapter = require_('drizzle-orm/mysql2') as DrizzleMysqlAdapter;
  cachedAdapter = adapter;
  return adapter;
}

/**
 * Masks the userinfo portion of a MySQL URL for safe logging.
 * `mysql://user:pass@host/db` → `mysql://***:***@host/db`.
 */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.username) u.username = '***';
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return url;
  }
}
