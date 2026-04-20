import { createRequire } from 'node:module';
import { ConfigError } from '@hopak/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/**
 * postgres.js and drizzle-orm/postgres-js are loaded synchronously via
 * `createRequire` so the Database factory stays synchronous and SQLite-only
 * users never pay the install cost. `drizzle-orm/postgres-js` imports
 * `postgres` at module load, so both are required together and a single
 * `ConfigError` is surfaced if the driver is missing.
 */

export type PostgresFactory = (url: string, options?: Record<string, unknown>) => PostgresSql;

export interface PostgresSql {
  unsafe(query: string): Promise<unknown>;
  end(options?: { timeout?: number }): Promise<void>;
}

export interface DrizzleAdapter {
  drizzle(sql: PostgresSql): PostgresJsDatabase;
}

const require_ = createRequire(import.meta.url);

let cachedDriver: PostgresFactory | undefined;
let cachedAdapter: DrizzleAdapter | undefined;

export function loadPostgresDriver(): PostgresFactory {
  if (cachedDriver) return cachedDriver;
  try {
    const loaded = require_('postgres') as PostgresFactory | { default: PostgresFactory };
    const factory = typeof loaded === 'function' ? loaded : loaded.default;
    cachedDriver = factory;
    return factory;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') {
      throw new ConfigError(
        'Postgres driver not installed. Run: hopak use postgres (or: bun add postgres)',
      );
    }
    throw error;
  }
}

export function loadDrizzleAdapter(): DrizzleAdapter {
  if (cachedAdapter) return cachedAdapter;
  // Loading `drizzle-orm/postgres-js` transitively requires `postgres`, so
  // check the driver first to emit the clearer error message.
  loadPostgresDriver();
  const adapter = require_('drizzle-orm/postgres-js') as DrizzleAdapter;
  cachedAdapter = adapter;
  return adapter;
}

/**
 * Masks the userinfo portion of a Postgres URL for safe logging.
 * `postgres://user:pass@host/db` → `postgres://***:***@host/db`.
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
