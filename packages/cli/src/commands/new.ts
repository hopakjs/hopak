import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { type Logger, pathExists } from '@hopak/common';
import { projectTemplate } from '../templates';

export interface NewCommandOptions {
  name: string;
  cwd?: string;
  log: Logger;
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
  options.log.info('Next steps:', { run: [`cd ${options.name}`, 'bun install', 'hopak dev'] });
  return 0;
}
