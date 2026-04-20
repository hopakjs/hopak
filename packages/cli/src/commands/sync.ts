import type { Logger } from '@hopak/common';
import { createApp } from '@hopak/core';

export interface SyncOptions {
  cwd?: string;
  log: Logger;
}

/**
 * Runs the boot-time schema sync without starting the HTTP server — emits
 * `CREATE TABLE IF NOT EXISTS` for every registered model.
 *
 * This is deliberately NOT called `hopak migrate`. Real versioned migrations
 * (generate / up / down / status) will ship under that name in a later
 * release; keeping `sync` separate avoids a rename later and avoids the
 * expectation that this command handles schema changes — it doesn't.
 * For schema changes today: drop the data file (SQLite) or drop the table
 * (Postgres / MySQL) and sync again.
 */
export async function runSync(options: SyncOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const log = options.log;
  log.info('Syncing schema to database', { cwd });
  const app = await createApp({ rootDir: cwd, log });
  log.info('Schema synchronized', {
    models: app.registry.size,
    dialect: app.config.database.dialect,
  });
  await app.stop();
  return 0;
}
