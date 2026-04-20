import { isAbsolute, resolve } from 'node:path';
import {
  ConfigError,
  type HopakConfig,
  type HopakConfigInput,
  deepMerge,
  pathExists,
} from '@hopak/common';
import { DEFAULT_HOST, DEFAULT_PORT } from '../http/defaults';

const SUPPORTED_DIALECTS = ['sqlite', 'postgres', 'mysql'] as const;
const SUPPORTED_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

type Issues = string[];

function validate(config: HopakConfig): Issues {
  const issues: Issues = [];

  const dialect = config.database.dialect as string;
  if (!SUPPORTED_DIALECTS.includes(dialect as (typeof SUPPORTED_DIALECTS)[number])) {
    issues.push(
      `database.dialect: '${dialect}' is not supported. Use one of: ${SUPPORTED_DIALECTS.join(', ')}.`,
    );
  }

  const port = config.server.port as unknown;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535) {
    issues.push(
      `server.port: expected integer 0–65535, got ${typeof port === 'number' ? port : JSON.stringify(port)}.`,
    );
  }

  const httpsPort = config.server.https?.port as unknown;
  if (
    httpsPort !== undefined &&
    (typeof httpsPort !== 'number' ||
      !Number.isInteger(httpsPort) ||
      httpsPort < 0 ||
      httpsPort > 65535)
  ) {
    issues.push(`server.https.port: expected integer 0–65535, got ${JSON.stringify(httpsPort)}.`);
  }

  if (config.logLevel !== undefined) {
    const level = config.logLevel as string;
    if (!SUPPORTED_LOG_LEVELS.includes(level as (typeof SUPPORTED_LOG_LEVELS)[number])) {
      issues.push(
        `logLevel: '${level}' is not supported. Use one of: ${SUPPORTED_LOG_LEVELS.join(', ')}.`,
      );
    }
  }

  // `database.url` is intentionally not validated here: the default template
  // writes `url: process.env.DATABASE_URL`, which evaluates to `undefined` on
  // machines that haven't populated .env yet. The driver raises a clear
  // `ConfigError` at connect time in that case — checking here would force
  // every CI invocation to export the variable before even running
  // `hopak check`, which is exactly the opposite of what `check` is for.

  return issues;
}

export function validateConfig(config: HopakConfig): void {
  const issues = validate(config);
  if (issues.length === 0) return;
  throw new ConfigError(
    `Invalid hopak.config.ts:\n  - ${issues.join('\n  - ')}\nFix the file and re-run the command.`,
  );
}

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
  validateConfig(merged);
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
