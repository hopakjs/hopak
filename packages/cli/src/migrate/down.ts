import type { Logger } from '@hopak/core';
import { applyDown, createApp, loadMigrations } from '@hopak/core';

export interface DownOptions {
  cwd?: string;
  log: Logger;
  dryRun?: boolean;
  steps?: number;
  to?: string;
}

export async function runDown(options: DownOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const app = await createApp({ rootDir: cwd, log: options.log, skipRoutes: true });
  const { migrations, errors } = await loadMigrations(app.config.paths.migrations);
  for (const err of errors) options.log.error(err.message, { file: err.file });
  if (errors.length > 0) {
    await app.stop();
    return 1;
  }

  try {
    const result = await applyDown(
      {
        db: app.db,
        dialect: app.config.database.dialect,
        log: options.log,
        ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
        ...(options.steps !== undefined ? { steps: options.steps } : {}),
        ...(options.to !== undefined ? { to: options.to } : {}),
      },
      migrations,
    );

    if (result.rolledBack.length === 0) {
      options.log.info('Nothing to roll back.');
    } else {
      options.log.info(
        options.dryRun
          ? `Dry run: ${result.rolledBack.length} migration(s) would be rolled back.`
          : `Rolled back ${result.rolledBack.length} migration(s).`,
      );
    }
    await app.stop();
    return 0;
  } catch (err) {
    options.log.error((err as Error).message);
    await app.stop();
    return 1;
  }
}
