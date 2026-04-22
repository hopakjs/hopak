import type { Logger } from '@hopak/core';
import { collectStatus, createApp, loadMigrations } from '@hopak/core';

export interface StatusOptions {
  cwd?: string;
  log: Logger;
}

export async function runStatus(options: StatusOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const app = await createApp({ rootDir: cwd, log: options.log, skipRoutes: true });
  const { migrations, errors } = await loadMigrations(app.config.paths.migrations);
  for (const err of errors) options.log.warn(err.message, { file: err.file });

  const status = await collectStatus(app.db, app.config.database.dialect, migrations);

  const out = process.stdout;
  if (status.applied.length > 0) {
    out.write('Applied:\n');
    for (const a of status.applied) {
      out.write(`  ✓ ${a.id}\n`);
    }
  }
  if (status.pending.length > 0) {
    out.write('\nPending:\n');
    for (const p of status.pending) {
      out.write(`  ⚠ ${p.id}${p.description ? `  — ${p.description}` : ''}\n`);
    }
  }
  if (status.missing.length > 0) {
    out.write('\nApplied but file missing:\n');
    for (const id of status.missing) {
      out.write(`  ✗ ${id}\n`);
    }
  }
  if (status.applied.length === 0 && status.pending.length === 0) {
    out.write('No migrations.\n');
  }

  await app.stop();
  return status.missing.length > 0 ? 1 : 0;
}
