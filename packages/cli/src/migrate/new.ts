import { pathExists } from '@hopak/common';
import type { Logger } from '@hopak/core';
import {
  createApp,
  newMigrationId,
  renderInitMigration,
  renderMigrationTemplate,
} from '@hopak/core';
import { ensureMigrationsDir, migrationFilePath } from './shared';

export interface NewOptions {
  name?: string;
  cwd?: string;
  log: Logger;
  /** True when invoked as `hopak migrate init` — body is the current-schema diff. */
  init?: boolean;
}

export async function runNew(options: NewOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const name = options.name ?? (options.init ? 'init' : '');
  if (!name) {
    options.log.error('Usage: hopak migrate new <name>');
    return 1;
  }

  const app = await createApp({ rootDir: cwd, log: options.log });
  const dir = app.config.paths.migrations;
  await ensureMigrationsDir(dir);

  const id = newMigrationId(name);
  const target = migrationFilePath(dir, id);
  if (await pathExists(target)) {
    options.log.error(`Migration file already exists: ${target}`);
    await app.stop();
    return 1;
  }

  const source = options.init ? renderInitMigration(app.registry.all()) : renderMigrationTemplate();
  await Bun.write(target, source);
  options.log.info('Created migration', { path: target });

  await app.stop();
  return 0;
}
