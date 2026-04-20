import type { Logger } from '@hopak/common';
import { dbDialectHandler } from './db-dialect';

export interface UseContext {
  root: string;
  log: Logger;
}

export type UseOutcome =
  | { status: 'ok'; nextSteps: string[] }
  | { status: 'already-installed' }
  | { status: 'conflict'; message: string; snippet: string }
  | { status: 'error'; message: string };

export interface UseHandler {
  readonly name: string;
  readonly description: string;
  /** Return the outcome without mutating anything — used for `hopak use` no-arg listing. */
  isInstalled(ctx: UseContext): Promise<boolean>;
  /** Perform the install: package dependency + config + env example. */
  install(ctx: UseContext): Promise<UseOutcome>;
}

export const CAPABILITIES: Record<string, UseHandler> = {
  sqlite: dbDialectHandler({ dialect: 'sqlite' }),
  postgres: dbDialectHandler({
    dialect: 'postgres',
    driverPkg: 'postgres',
    driverVersion: '^3.4.0',
  }),
  mysql: dbDialectHandler({
    dialect: 'mysql',
    driverPkg: 'mysql2',
    driverVersion: '^3.11.0',
  }),
};

export function listCapabilities(): string {
  const rows = Object.values(CAPABILITIES).map((h) => `  ${h.name.padEnd(10)} ${h.description}`);
  return `Usage: hopak use <capability>\n\nAvailable:\n${rows.join('\n')}\n`;
}
