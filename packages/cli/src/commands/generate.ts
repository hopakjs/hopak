import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { type Logger, pathExists } from '@hopak/common';
import { generateDevCert } from '@hopak/core';
import { crudRoutesFor, modelTemplate, routeTemplate } from '../templates';

export interface GenerateOptions {
  kind: string;
  name?: string;
  cwd?: string;
  log: Logger;
}

interface EmittedFile {
  path: string;
  contents: string;
}

interface GeneratorContext {
  cwd: string;
  name: string | undefined;
  log: Logger;
}

type Generator = (ctx: GeneratorContext) => Promise<number>;

const TS_EXT_RE = /\.ts$/;
const LEADING_SLASH_RE = /^\/+/;
const DEV_CERT_DIR = '.hopak/certs';

async function emitFiles(log: Logger, files: readonly EmittedFile[]): Promise<number> {
  for (const file of files) {
    if (await pathExists(file.path)) {
      log.error(`File already exists: ${file.path}`);
      return 1;
    }
  }
  for (const file of files) {
    await mkdir(dirname(file.path), { recursive: true });
    await Bun.write(file.path, file.contents);
    log.info('Created file', { path: file.path });
  }
  return 0;
}

function requireName(kind: string, name: string | undefined, log: Logger): name is string {
  if (name) return true;
  log.error(`hopak generate ${kind}: missing <name>.`);
  return false;
}

const GENERATORS: Record<string, Generator> = {
  model: async ({ cwd, name, log }) => {
    if (!requireName('model', name, log)) return 1;
    return emitFiles(log, [
      { path: resolve(cwd, 'app/models', `${name}.ts`), contents: modelTemplate(name) },
    ]);
  },
  route: async ({ cwd, name, log }) => {
    if (!requireName('route', name, log)) return 1;
    const normalized = name.replace(LEADING_SLASH_RE, '').replace(TS_EXT_RE, '');
    return emitFiles(log, [
      { path: resolve(cwd, 'app/routes', `${normalized}.ts`), contents: routeTemplate() },
    ]);
  },
  crud: async ({ cwd, name, log }) => {
    if (!requireName('crud', name, log)) return 1;
    const { collection, item } = crudRoutesFor(name);
    return emitFiles(log, [
      { path: resolve(cwd, collection.path), contents: collection.contents },
      { path: resolve(cwd, item.path), contents: item.contents },
    ]);
  },
  cert: async ({ cwd, log }) => {
    const certDir = resolve(cwd, DEV_CERT_DIR);
    const keyPath = resolve(certDir, 'dev.key');
    const certPath = resolve(certDir, 'dev.crt');
    if ((await pathExists(keyPath)) && (await pathExists(certPath))) {
      log.info('Dev certificate already exists', { path: certDir });
      return 0;
    }
    await generateDevCert({ certDir, log });
    log.info('Dev certificate ready. Re-run `hopak dev` with HTTPS enabled.');
    return 0;
  },
};

const ALLOWED_KINDS = Object.keys(GENERATORS);

export async function runGenerate(options: GenerateOptions): Promise<number> {
  const generator = GENERATORS[options.kind];
  if (!generator) {
    options.log.error(`Unknown generate kind: ${options.kind}`, { allowed: ALLOWED_KINDS });
    return 1;
  }
  return generator({
    cwd: options.cwd ?? process.cwd(),
    name: options.name,
    log: options.log,
  });
}
