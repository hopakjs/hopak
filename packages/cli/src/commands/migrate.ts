import type { Logger } from '@hopak/common';
import { createApp } from '@hopak/core';

export interface MigrateOptions {
  cwd?: string;
  log: Logger;
}

export async function runMigrate(options: MigrateOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const log = options.log;
  log.info('Applying schema to database', { cwd });
  const app = await createApp({ rootDir: cwd, log });
  log.info('Schema synchronized', {
    models: app.registry.size,
    dialect: app.config.database.dialect,
  });
  await app.stop();
  return 0;
}
