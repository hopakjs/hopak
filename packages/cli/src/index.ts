import { type Logger, createLogger } from '@hopak/common';
import { runCheck } from './commands/check';
import { runDev } from './commands/dev';
import { runGenerate } from './commands/generate';
import { runNew } from './commands/new';
import { runSync } from './commands/sync';
import { runUse } from './commands/use';
import { CLI_VERSION } from './version';

const HELP = `Hopak.js CLI v${CLI_VERSION}

Usage: hopak <command> [args]

Commands:
  new <name>              Create a new Hopak project (runs bun install)
    --no-install          Skip dependency install (useful for CI / offline)
  dev                     Start dev server (hot reload)
  generate <kind> <name>  Scaffold a model or route
  sync                    Apply model schema to the database (CREATE TABLE IF NOT EXISTS)
  check                   Audit project state (config, models, routes)
  use <capability>        Enable a capability (sqlite, postgres, mysql)
  --help, -h              Show this help
  --version, -v           Show version

Examples:
  hopak new my-app
  hopak dev
  hopak generate model post
  hopak generate route posts/[id]
  hopak sync
  hopak use postgres
`;

interface CommandContext {
  args: readonly string[];
  log: Logger;
}

interface Command {
  describe: string;
  run(ctx: CommandContext): Promise<number>;
}

const COMMANDS: Record<string, Command> = {
  new: {
    describe: 'Create a new Hopak project',
    run: ({ args, log }) => {
      const positional = args.filter((a) => !a.startsWith('--'));
      const name = positional[0];
      if (!name) {
        log.error('Missing project name. Usage: hopak new <name> [--no-install]');
        return Promise.resolve(1);
      }
      const noInstall = args.includes('--no-install');
      return runNew({ name, log, noInstall });
    },
  },
  dev: {
    describe: 'Start dev server (hot reload)',
    run: ({ log }) => runDev({ log }),
  },
  generate: {
    describe: 'Scaffold a model or route',
    run: ({ args, log }) => {
      const [kind, name] = args;
      if (!kind || !name) {
        log.error('Usage: hopak generate <model|route> <name>');
        return Promise.resolve(1);
      }
      return runGenerate({ kind, name, log });
    },
  },
  sync: {
    describe: 'Apply model schema to the database',
    run: ({ log }) => runSync({ log }),
  },
  check: {
    describe: 'Audit project state',
    run: ({ log }) => runCheck({ log }),
  },
  use: {
    describe: 'Enable a capability (sqlite, postgres, mysql)',
    run: ({ args, log }) => runUse({ name: args[0], log }),
  },
};

const COMMAND_ALIASES: Record<string, string> = {
  g: 'generate',
};

function resolveCommand(name: string): Command | undefined {
  return COMMANDS[COMMAND_ALIASES[name] ?? name];
}

export async function run(argv: readonly string[]): Promise<number> {
  const log = createLogger({ level: 'info' });
  const [head, ...rest] = argv;

  if (!head || head === '--help' || head === '-h') {
    process.stdout.write(HELP);
    return 0;
  }

  if (head === '--version' || head === '-v') {
    process.stdout.write(`${CLI_VERSION}\n`);
    return 0;
  }

  const command = resolveCommand(head);
  if (!command) {
    log.error(`Unknown command: ${head}`);
    process.stdout.write(HELP);
    return 1;
  }

  return command.run({ args: rest, log });
}
