import type { Logger } from '@hopak/common';
import { authHandler } from './auth-handler';
import { dbDialectHandler } from './db-dialect';
import { requestLogHandler } from './request-log-handler';

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
  'request-log': requestLogHandler,
  auth: authHandler,
};

export function listCapabilities(): string {
  const width = Math.max(...Object.values(CAPABILITIES).map((h) => h.name.length));
  const rows = Object.values(CAPABILITIES).map(
    (h) => `  ${h.name.padEnd(width)}  ${h.description}`,
  );
  return `Usage: hopak use <capability>\n\nAvailable:\n${rows.join('\n')}\n`;
}
