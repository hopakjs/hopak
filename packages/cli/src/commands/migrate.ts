import type { Logger } from '@hopak/core';
import { runDown } from '../migrate/down';
import { runNew } from '../migrate/new';
import { runStatus } from '../migrate/status';
import { runUp } from '../migrate/up';

export interface MigrateOptions {
  args: readonly string[];
  log: Logger;
}

const HELP = `Usage: hopak migrate <subcommand> [options]

Subcommands:
  init                          Create initial migration from current models
  new <name>                    Create an empty migration with up() + down()
  up [--to <id>] [--dry-run]    Apply pending migrations
  down [--steps N] [--to <id>]  Roll back the last N migrations (default 1)
  status                        Show applied / pending / missing
`;

function parseIntFlag(args: readonly string[], flag: string): number | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) {
      const n = Number(args[i + 1]);
      return Number.isFinite(n) ? n : undefined;
    }
    const inline = args[i]?.startsWith(`${flag}=`) ? args[i]?.slice(flag.length + 1) : undefined;
    if (inline) {
      const n = Number(inline);
      return Number.isFinite(n) ? n : undefined;
    }
  }
  return undefined;
}

function parseStringFlag(args: readonly string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) return args[i + 1];
    const inline = args[i]?.startsWith(`${flag}=`) ? args[i]?.slice(flag.length + 1) : undefined;
    if (inline) return inline;
  }
  return undefined;
}

export async function runMigrate(options: MigrateOptions): Promise<number> {
  const [sub, ...rest] = options.args;
  const { log } = options;

  switch (sub) {
    case 'init':
      return runNew({ init: true, log });
    case 'new': {
      const name = rest.find((a) => !a.startsWith('--'));
      return runNew({ ...(name !== undefined ? { name } : {}), log });
    }
    case 'up': {
      const to = parseStringFlag(rest, '--to');
      const dryRun = rest.includes('--dry-run');
      return runUp({ log, dryRun, ...(to !== undefined ? { to } : {}) });
    }
    case 'down': {
      const steps = parseIntFlag(rest, '--steps');
      const to = parseStringFlag(rest, '--to');
      const dryRun = rest.includes('--dry-run');
      return runDown({
        log,
        dryRun,
        ...(steps !== undefined ? { steps } : {}),
        ...(to !== undefined ? { to } : {}),
      });
    }
    case 'status':
      return runStatus({ log });
    case undefined:
    case '--help':
    case '-h':
      process.stdout.write(HELP);
      return 0;
    default:
      log.error(`Unknown subcommand: ${sub}`);
      process.stdout.write(HELP);
      return 1;
  }
}
