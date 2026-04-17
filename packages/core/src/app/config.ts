import { isAbsolute, resolve } from 'node:path';
import { type HopakConfig, type HopakConfigInput, deepMerge, pathExists } from '@hopak/common';
import { DEFAULT_HOST, DEFAULT_PORT } from '../http/defaults';

const DEFAULT_PATHS = {
  models: 'app/models',
  routes: 'app/routes',
  jobs: 'app/jobs',
  public: 'public',
  migrations: 'migrations',
  hopakDir: '.hopak',
} as const;

const DEFAULT_DATABASE_FILE = '.hopak/data.db';

export function defaultConfig(rootDir: string): HopakConfig {
  return {
    server: { port: DEFAULT_PORT, host: DEFAULT_HOST },
    database: { dialect: 'sqlite', file: resolve(rootDir, DEFAULT_DATABASE_FILE) },
    paths: {
      models: resolve(rootDir, DEFAULT_PATHS.models),
      routes: resolve(rootDir, DEFAULT_PATHS.routes),
      jobs: resolve(rootDir, DEFAULT_PATHS.jobs),
      public: resolve(rootDir, DEFAULT_PATHS.public),
      migrations: resolve(rootDir, DEFAULT_PATHS.migrations),
      hopakDir: resolve(rootDir, DEFAULT_PATHS.hopakDir),
    },
    logLevel: 'info',
  };
}

const PATH_KEYS = Object.keys(DEFAULT_PATHS) as readonly (keyof HopakConfig['paths'])[];

function resolveRelativePaths(config: HopakConfig, rootDir: string): void {
  for (const key of PATH_KEYS) {
    const value = config.paths[key];
    if (value && !isAbsolute(value)) {
      config.paths[key] = resolve(rootDir, value);
    }
  }
  if (config.database.file && !isAbsolute(config.database.file)) {
    config.database.file = resolve(rootDir, config.database.file);
  }
}

export function applyConfig(rootDir: string, input?: HopakConfigInput): HopakConfig {
  const merged = deepMerge(defaultConfig(rootDir), input);
  resolveRelativePaths(merged, rootDir);
  return merged;
}

const CONFIG_FILENAMES = ['hopak.config.ts', 'hopak.config.js', 'hopak.config.mjs'] as const;

export async function loadConfigFile(rootDir: string): Promise<HopakConfigInput | undefined> {
  for (const filename of CONFIG_FILENAMES) {
    const path = resolve(rootDir, filename);
    if (!(await pathExists(path))) continue;
    const mod = (await import(path)) as { default?: HopakConfigInput };
    if (mod.default) return mod.default;
  }
  return undefined;
}
