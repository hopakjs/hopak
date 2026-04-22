import { join } from 'node:path';
import type { HopakApp, Logger } from '@hopak/core';
import { createApp, pathExists } from '@hopak/core';

export interface BootOptions {
  cwd: string;
  log: Logger;
  /** Skip the autoload side-effect; callers use it only for path resolution. */
  skipOpen?: boolean;
}

export interface Context {
  app: HopakApp;
  migrationsDir: string;
}

/**
 * Every migrate subcommand boots the app (scans models, opens the db) and
 * resolves `config.paths.migrations`. Centralised so future knobs (quiet
 * mode, alt config) live in one place.
 */
export async function openApp(options: BootOptions): Promise<Context> {
  const app = await createApp({ rootDir: options.cwd, log: options.log });
  const migrationsDir = app.config.paths.migrations;
  return { app, migrationsDir };
}

export async function ensureMigrationsDir(dir: string): Promise<void> {
  if (await pathExists(dir)) return;
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
}

export function migrationFilePath(dir: string, id: string): string {
  return join(dir, `${id}.ts`);
}
