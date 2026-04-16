import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { type Logger, pathExists } from '@hopak/common';
import { modelTemplate, routeTemplate } from '../templates';

export interface GenerateOptions {
  kind: string;
  name: string;
  cwd?: string;
  log: Logger;
}

interface Generator {
  /** Resolves the absolute target path for the generated file. */
  resolveTarget(cwd: string, name: string): string;
  /** Returns the file contents to write. */
  render(name: string): string;
}

const TS_EXT_RE = /\.ts$/;
const LEADING_SLASH_RE = /^\/+/;

const GENERATORS: Record<string, Generator> = {
  model: {
    resolveTarget: (cwd, name) => resolve(cwd, 'app/models', `${name}.ts`),
    render: (name) => modelTemplate(name),
  },
  route: {
    resolveTarget: (cwd, name) => {
      const normalized = name.replace(LEADING_SLASH_RE, '').replace(TS_EXT_RE, '');
      return resolve(cwd, 'app/routes', `${normalized}.ts`);
    },
    render: () => routeTemplate(),
  },
};

const ALLOWED_KINDS = Object.keys(GENERATORS);

export async function runGenerate(options: GenerateOptions): Promise<number> {
  const generator = GENERATORS[options.kind];
  if (!generator) {
    options.log.error(`Unknown generate kind: ${options.kind}`, { allowed: ALLOWED_KINDS });
    return 1;
  }

  const target = generator.resolveTarget(options.cwd ?? process.cwd(), options.name);

  if (await pathExists(target)) {
    options.log.error(`File already exists: ${target}`);
    return 1;
  }

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, generator.render(options.name), 'utf8');
  options.log.info('Created file', { path: target });
  return 0;
}
