import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { type Logger, pathExists } from '@hopak/common';
import { projectTemplate } from '../templates';

export interface NewCommandOptions {
  name: string;
  cwd?: string;
  log: Logger;
  /** Skip `bun install` after scaffolding. Useful for tests and air-gapped setups. */
  noInstall?: boolean;
}

export async function runNew(options: NewCommandOptions): Promise<number> {
  const target = resolve(options.cwd ?? process.cwd(), options.name);

  if (await pathExists(target)) {
    options.log.error(`Directory already exists: ${target}`);
    return 1;
  }

  const template = projectTemplate(options.name);
  await mkdir(target, { recursive: true });

  for (const [relativePath, contents] of Object.entries(template.files)) {
    const fullPath = join(target, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, contents, 'utf8');
  }

  options.log.info(`Created ${options.name}`, { path: target });

  // Install dependencies inline so the "next step" for the user is simply
  // `cd <name> && hopak dev`. Opt out with `--no-install` for CI / tests /
  // offline setups.
  if (!options.noInstall) {
    const installed = await runBunInstall(target, options.log);
    if (!installed) {
      options.log.warn('bun install failed — run it manually before `hopak dev`.');
      options.log.info('Next steps:', { run: [`cd ${options.name}`, 'bun install', 'hopak dev'] });
      return 1;
    }
  }

  options.log.info('Next steps:', {
    run: options.noInstall
      ? [`cd ${options.name}`, 'bun install', 'hopak dev']
      : [`cd ${options.name}`, 'hopak dev'],
  });
  return 0;
}

async function runBunInstall(cwd: string, log: Logger): Promise<boolean> {
  log.info('Installing dependencies...');
  try {
    const proc = Bun.spawn({
      cmd: ['bun', 'install'],
      cwd,
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const code = await proc.exited;
    return code === 0;
  } catch (err) {
    log.error(`bun install threw: ${(err as Error).message}`);
    return false;
  }
}
