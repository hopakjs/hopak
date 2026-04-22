import { join } from 'node:path';
import { pathExists } from '@hopak/common';
import { type Dialect, buildDatabaseBlock, detectDialect, patchConfig } from './config-patcher';
import { patchEnvExample } from './env-patcher';
import type { UseContext, UseHandler, UseOutcome } from './registry';

export interface DbDialectOptions {
  dialect: Dialect;
  /** NPM package shipping the driver (e.g. `postgres`, `mysql2`). `undefined` for sqlite. */
  driverPkg?: string;
  driverVersion?: string;
}

const DESCRIPTIONS: Record<Dialect, string> = {
  sqlite: 'SQLite via bun:sqlite (default, zero install)',
  postgres: 'Postgres via postgres.js',
  mysql: 'MySQL via mysql2',
};

export function dbDialectHandler(options: DbDialectOptions): UseHandler {
  const { dialect, driverPkg, driverVersion } = options;
  return {
    name: dialect,
    description: DESCRIPTIONS[dialect],

    async isInstalled(ctx) {
      const configPath = join(ctx.root, 'hopak.config.ts');
      if (!(await pathExists(configPath))) return false;
      const source = await Bun.file(configPath).text();
      return detectDialect(source) === dialect;
    },

    async install(ctx): Promise<UseOutcome> {
      const configPath = join(ctx.root, 'hopak.config.ts');
      if (!(await pathExists(configPath))) {
        return {
          status: 'error',
          message: `hopak.config.ts not found in ${ctx.root}. Run this command inside a Hopak project.`,
        };
      }

      const configSource = await Bun.file(configPath).text();
      const patch = patchConfig(configSource, dialect);

      switch (patch.status) {
        case 'already':
          return { status: 'already-installed' };
        case 'conflict':
          return {
            status: 'conflict',
            message: `hopak.config.ts already configures dialect '${patch.current}'. Replace the \`database: { ... }\` block with the snippet below.`,
            snippet: `${patch.snippet},`,
          };
        case 'cant-patch':
          return {
            status: 'conflict',
            message:
              'Could not safely patch hopak.config.ts — the database block is in an unexpected shape. Paste the snippet into your defineConfig({...}) object.',
            snippet: `${patch.snippet},`,
          };
      }

      if (driverPkg) {
        const installed = await installPackage(ctx, driverPkg, driverVersion);
        if (!installed.ok) {
          return {
            status: 'error',
            message: `Failed to install ${driverPkg}: ${installed.error}. Run manually: bun add ${driverPkg}`,
          };
        }
      }

      await Bun.write(configPath, patch.updated);
      if (patch.status === 'replaced') {
        ctx.log.info(`Replaced database block in hopak.config.ts (${patch.previous} → ${dialect})`);
      } else {
        ctx.log.info(`Added database block to hopak.config.ts (dialect: ${dialect})`);
      }

      const envExamplePath = join(ctx.root, '.env.example');
      if (await pathExists(envExamplePath)) {
        const envSource = await Bun.file(envExamplePath).text();
        const updated = patchEnvExample(envSource, dialect);
        if (updated !== null) {
          await Bun.write(envExamplePath, updated);
          ctx.log.info('Added DATABASE_URL to .env.example');
        }
      }

      return { status: 'ok', nextSteps: nextStepsFor(dialect) };
    },
  };
}

function nextStepsFor(dialect: Dialect): string[] {
  if (dialect === 'sqlite') {
    return ['hopak dev  (first boot creates the tables automatically)'];
  }
  if (dialect === 'postgres') {
    return [
      'Start Postgres locally (or use a managed service):',
      '  docker run -d --name hopak-pg -p 5432:5432 -e POSTGRES_PASSWORD=hopak postgres:16-alpine',
      'Copy .env.example → .env and set DATABASE_URL',
      'hopak sync',
      'hopak dev',
    ];
  }
  return [
    'Start MySQL locally (or use a managed service):',
    '  docker run -d --name hopak-mysql -p 3306:3306 -e MYSQL_ROOT_PASSWORD=hopak mysql:8.4',
    'Copy .env.example → .env and set DATABASE_URL',
    'hopak sync',
    'hopak dev',
  ];
}

interface InstallResult {
  ok: boolean;
  error?: string;
}

/**
 * Run `bun add <pkg>@<version>` in the project root. `bun` is invoked only
 * with a validated package name and version — no caller-supplied shell text
 * — so there's no command-injection surface.
 */
async function installPackage(
  ctx: UseContext,
  pkg: string,
  version?: string,
): Promise<InstallResult> {
  ctx.log.info(`Installing ${pkg}...`);
  const spec = version ? `${pkg}@${version}` : pkg;
  const proc = Bun.spawn({
    cmd: ['bun', 'add', spec],
    cwd: ctx.root,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) {
    return { ok: false, error: `exit code ${code}` };
  }
  return { ok: true };
}

export { buildDatabaseBlock };
