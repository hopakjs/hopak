import { createRequire } from 'node:module';
import { join } from 'node:path';
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
  // postgres.js's `unsafe` resolves to a `Result` that extends Array and
  // is iterable — typed here as the minimum we rely on.
  unsafe(query: string, params?: readonly unknown[]): Promise<Iterable<unknown>>;
  end(options?: { timeout?: number }): Promise<void>;
}

export interface DrizzleAdapter {
  drizzle(sql: PostgresSql): PostgresJsDatabase;
}

// Try resolving from the user's project first (so a globally-installed CLI
// finds drivers that live in the app's `node_modules`), then fall back to
// this file's location (so tests and monorepo-local installs also work
// where the dep is hoisted alongside `@hopak/core`).
const requireFromCwd = createRequire(join(process.cwd(), 'noop.js'));
const requireFromHere = createRequire(import.meta.url);

function tryRequire<T>(id: string): T | null {
  for (const req of [requireFromCwd, requireFromHere]) {
    try {
      return req(id) as T;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'MODULE_NOT_FOUND' && code !== 'ERR_MODULE_NOT_FOUND') throw error;
    }
  }
  return null;
}

let cachedDriver: PostgresFactory | undefined;
let cachedAdapter: DrizzleAdapter | undefined;

export function loadPostgresDriver(): PostgresFactory {
  if (cachedDriver) return cachedDriver;
  const loaded = tryRequire<PostgresFactory | { default: PostgresFactory }>('postgres');
  if (!loaded) {
    throw new ConfigError(
      'Postgres driver not installed. Run: hopak use postgres (or: bun add postgres)',
    );
  }
  const factory = typeof loaded === 'function' ? loaded : loaded.default;
  cachedDriver = factory;
  return factory;
}

export function loadDrizzleAdapter(): DrizzleAdapter {
  if (cachedAdapter) return cachedAdapter;
  // Loading `drizzle-orm/postgres-js` transitively requires `postgres`, so
  // check the driver first to emit the clearer error message.
  loadPostgresDriver();
  const adapter = tryRequire<DrizzleAdapter>('drizzle-orm/postgres-js');
  if (!adapter) throw new ConfigError('drizzle-orm/postgres-js not resolvable.');
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
