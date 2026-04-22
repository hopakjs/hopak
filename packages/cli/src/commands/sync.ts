import { join } from 'node:path';
import { type Logger, pathExists } from '@hopak/common';
import { createApp } from '@hopak/core';
import { Glob } from 'bun';

export interface SyncOptions {
  cwd?: string;
  log: Logger;
}

/**
 * Create missing tables from the current models — the dev-bootstrap path.
 * Once a project has `app/migrations/` files, schema evolution lives there
 * exclusively; sync refuses to run to keep the two mechanisms from fighting.
 */
export async function runSync(options: SyncOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const log = options.log;

  if (await hasMigrations(join(cwd, 'app/migrations'))) {
    log.error(
      'This project uses migrations. Run `hopak migrate up` to apply pending schema changes.',
    );
    return 1;
  }

  log.info('Syncing schema to database', { cwd });
  const app = await createApp({ rootDir: cwd, log, skipRoutes: true });
  log.info('Schema synchronized', {
    models: app.registry.size,
    dialect: app.config.database.dialect,
  });
  await app.stop();
  return 0;
}

async function hasMigrations(dir: string): Promise<boolean> {
  if (!(await pathExists(dir))) return false;
  const glob = new Glob('*.ts');
  for await (const _ of glob.scan({ cwd: dir })) return true;
  return false;
}
