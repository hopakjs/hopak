import type { Logger } from '@hopak/core';
import { applyUp, createApp, loadMigrations } from '@hopak/core';

export interface UpOptions {
  cwd?: string;
  log: Logger;
  dryRun?: boolean;
  to?: string;
}

export async function runUp(options: UpOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const app = await createApp({ rootDir: cwd, log: options.log });
  const { migrations, errors } = await loadMigrations(app.config.paths.migrations);
  for (const err of errors) options.log.error(err.message, { file: err.file });
  if (errors.length > 0) {
    await app.stop();
    return 1;
  }

  try {
    const result = await applyUp(
      {
        db: app.db,
        dialect: app.config.database.dialect,
        log: options.log,
        ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
        ...(options.to !== undefined ? { to: options.to } : {}),
      },
      migrations,
    );

    if (result.applied.length === 0) {
      options.log.info('No pending migrations.');
    } else {
      options.log.info(
        options.dryRun
          ? `Dry run: ${result.applied.length} migration(s) would be applied.`
          : `Applied ${result.applied.length} migration(s).`,
      );
    }
    await app.stop();
    return 0;
  } catch (err) {
    options.log.error(`Migration failed: ${err instanceof Error ? err.message : String(err)}`);
    await app.stop();
    return 1;
  }
}
