import { type Logger, createLogger } from '@hopak/common';
import { runCheck } from './commands/check';
import { runDev } from './commands/dev';
import { runGenerate } from './commands/generate';
import { runMigrate } from './commands/migrate';
import { runNew } from './commands/new';
import { CLI_VERSION } from './version';

const HELP = `Hopak.js CLI v${CLI_VERSION}

Usage: hopak <command> [args]

Commands:
  new <name>              Create a new Hopak project
  dev                     Start dev server (hot reload)
  generate <kind> <name>  Scaffold a model or route
  migrate                 Sync database schema (dev)
  check                   Audit project state (config, models, routes)
  --help, -h              Show this help
  --version, -v           Show version

Examples:
  hopak new my-app
  hopak dev
  hopak generate model post
  hopak generate route posts/[id]
  hopak migrate
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
      const name = args[0];
      if (!name) {
        log.error('Missing project name. Usage: hopak new <name>');
        return Promise.resolve(1);
      }
      return runNew({ name, log });
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
  migrate: {
    describe: 'Sync database schema (dev)',
    run: ({ log }) => runMigrate({ log }),
  },
  check: {
    describe: 'Audit project state',
    run: ({ log }) => runCheck({ log }),
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
