import { resolve } from 'node:path';
import { type Logger, pathExists } from '@hopak/common';

export interface DevCommandOptions {
  cwd?: string;
  log: Logger;
  entry?: string;
}

const DEFAULT_ENTRY = 'main.ts';

export async function runDev(options: DevCommandOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const entry = options.entry ?? DEFAULT_ENTRY;
  const fullEntry = resolve(cwd, entry);

  if (!(await pathExists(fullEntry))) {
    options.log.error(`Entry file not found: ${entry}`);
    options.log.info('Create a main.ts that imports and starts hopak(), or pass --entry');
    return 1;
  }

  const proc = Bun.spawn(['bun', '--hot', 'run', fullEntry], {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });
  return proc.exited;
}
