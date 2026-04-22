import { type DbDialect, type Logger, createLogger } from '@hopak/common';
import { runCheck } from './commands/check';
import { runDev } from './commands/dev';
import { runGenerate } from './commands/generate';
import { runMigrate } from './commands/migrate';
import { runNew } from './commands/new';
import { runSync } from './commands/sync';
import { runUse } from './commands/use';
import { CLI_VERSION } from './version';

const HELP = `Hopak.js CLI v${CLI_VERSION}

Usage: hopak <command> [args]

Commands:
  new <name>              Create a new Hopak project (runs bun install)
    --db <sqlite|postgres|mysql>
                          Preconfigure dialect (default: sqlite)
    --no-install          Skip dependency install (useful for CI / offline)
  dev                     Start dev server (hot reload)
  generate <kind> [<name>]  Scaffold files:
                          model | route | crud | cert
  sync                    Create missing tables from models (dev bootstrap).
                          Refuses when app/migrations/ exists — use migrate up.
  migrate <sub>           Schema migrations:
                          init | new <name> | up | down | status
  check                   Audit project state (config, models, routes)
  use <capability>        Enable a capability in an existing project
                          (sqlite, postgres, mysql, request-log, auth)
  --help, -h              Show this help
  --version, -v           Show version

Examples:
  hopak new my-app
  hopak new my-app --db postgres
  hopak dev
  hopak generate model post
  hopak generate crud post
  hopak generate route posts/[id]
  hopak generate cert           # dev HTTPS key + self-signed cert
  hopak sync
  hopak migrate init            # capture current schema as first migration
  hopak migrate new add_role    # empty up/down skeleton
  hopak migrate up              # apply pending
  hopak use postgres
  hopak use request-log
  hopak use auth
`;

const SUPPORTED_DIALECTS: readonly DbDialect[] = ['sqlite', 'postgres', 'mysql'];

function parseDialectFlag(args: readonly string[], log: Logger): DbDialect | 'invalid' | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a) continue;
    let value: string | undefined;
    if (a === '--db' || a === '--dialect') value = args[i + 1];
    else if (a.startsWith('--db=')) value = a.slice(5);
    else if (a.startsWith('--dialect=')) value = a.slice(10);
    else continue;

    if (!value || !SUPPORTED_DIALECTS.includes(value as DbDialect)) {
      log.error(
        `Invalid --db value: '${value ?? ''}'. Supported: ${SUPPORTED_DIALECTS.join(', ')}.`,
      );
      return 'invalid';
    }
    return value as DbDialect;
  }
  return undefined;
}

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
        log.error(
          'Missing project name. Usage: hopak new <name> [--db sqlite|postgres|mysql] [--no-install]',
        );
        return Promise.resolve(1);
      }
      const dialect = parseDialectFlag(args, log);
      if (dialect === 'invalid') return Promise.resolve(1);
      const noInstall = args.includes('--no-install');
      return runNew({
        name,
        log,
        noInstall,
        ...(dialect ? { dialect } : {}),
      });
    },
  },
  dev: {
    describe: 'Start dev server (hot reload)',
    run: ({ log }) => runDev({ log }),
  },
  generate: {
    describe: 'Scaffold a model, route, CRUD resource, or dev HTTPS cert',
    run: ({ args, log }) => {
      const [kind, name] = args;
      if (!kind) {
        log.error('Usage: hopak generate <model|route|crud|cert> [<name>]');
        return Promise.resolve(1);
      }
      return runGenerate({ kind, ...(name ? { name } : {}), log });
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
    describe: 'Enable a capability (sqlite, postgres, mysql, request-log, auth)',
    run: ({ args, log }) => runUse({ name: args[0], log }),
  },
  migrate: {
    describe: 'Schema migrations (init, new, up, down, status)',
    run: ({ args, log }) => runMigrate({ args, log }),
  },
};

const COMMAND_ALIASES: Record<string, string> = {
  g: 'generate',
  m: 'migrate',
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
