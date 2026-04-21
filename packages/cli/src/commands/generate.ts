import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { type Logger, pathExists } from '@hopak/common';
import { crudRoutesFor, modelTemplate, routeTemplate } from '../templates';

export interface GenerateOptions {
  kind: string;
  name: string;
  cwd?: string;
  log: Logger;
}

interface EmittedFile {
  path: string;
  contents: string;
}

type Generator = (cwd: string, name: string) => EmittedFile[];

const TS_EXT_RE = /\.ts$/;
const LEADING_SLASH_RE = /^\/+/;

const GENERATORS: Record<string, Generator> = {
  model: (cwd, name) => [
    { path: resolve(cwd, 'app/models', `${name}.ts`), contents: modelTemplate(name) },
  ],
  route: (cwd, name) => {
    const normalized = name.replace(LEADING_SLASH_RE, '').replace(TS_EXT_RE, '');
    return [{ path: resolve(cwd, 'app/routes', `${normalized}.ts`), contents: routeTemplate() }];
  },
  crud: (cwd, name) => {
    const { collection, item } = crudRoutesFor(name);
    return [
      { path: resolve(cwd, collection.path), contents: collection.contents },
      { path: resolve(cwd, item.path), contents: item.contents },
    ];
  },
};

const ALLOWED_KINDS = Object.keys(GENERATORS);

export async function runGenerate(options: GenerateOptions): Promise<number> {
  const generator = GENERATORS[options.kind];
  if (!generator) {
    options.log.error(`Unknown generate kind: ${options.kind}`, { allowed: ALLOWED_KINDS });
    return 1;
  }

  const files = generator(options.cwd ?? process.cwd(), options.name);

  for (const file of files) {
    if (await pathExists(file.path)) {
      options.log.error(`File already exists: ${file.path}`);
      return 1;
    }
  }

  for (const file of files) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.contents, 'utf8');
    options.log.info('Created file', { path: file.path });
  }
  return 0;
}
