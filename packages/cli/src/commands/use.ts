import type { Logger } from '@hopak/common';
import { CAPABILITIES, type UseContext, listCapabilities } from '../use/registry';

export interface UseCommandOptions {
  name?: string;
  cwd?: string;
  log: Logger;
}

export async function runUse(options: UseCommandOptions): Promise<number> {
  const { name, log } = options;
  const root = options.cwd ?? process.cwd();

  if (!name) {
    process.stdout.write(listCapabilities());
    return 0;
  }

  const handler = CAPABILITIES[name];
  if (!handler) {
    log.error(`Unknown capability: ${name}. Allowed: ${Object.keys(CAPABILITIES).join(', ')}.`);
    return 1;
  }

  const ctx: UseContext = { root, log };
  const outcome = await handler.install(ctx);

  switch (outcome.status) {
    case 'ok':
      log.info(`${handler.name} is configured.`);
      process.stdout.write('\nNext:\n');
      for (const step of outcome.nextSteps) {
        process.stdout.write(`  ${step}\n`);
      }
      return 0;

    case 'already-installed':
      log.info(`Already using ${handler.name}.`);
      return 0;

    case 'conflict':
      log.warn(outcome.message);
      process.stdout.write(`\nSnippet for hopak.config.ts:\n  ${outcome.snippet}\n`);
      return 1;

    case 'error':
      log.error(outcome.message);
      return 1;
  }
}
