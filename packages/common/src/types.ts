import type { LogLevel, Logger } from './logger';
import type { DeepPartial } from './utils';

export type DbDialect = 'sqlite' | 'postgres' | 'mysql';

export interface HopakPaths {
  models: string;
  routes: string;
  jobs: string;
  public: string;
  migrations: string;
  hopakDir: string;
}

export interface ServerOptions {
  port: number;
  host: string;
  https?: HttpsOptions;
}

export interface HttpsOptions {
  /** Enable HTTPS listener. Requires a dev cert at `.hopak/certs/dev.{key,crt}` — run `hopak generate cert` once to create it. Boot fails fast with a pointer if the cert is missing. */
  enabled: boolean;
  /** HTTPS port (default 3443). */
  port?: number;
  /** Path to a PEM-encoded certificate. Defaults to `.hopak/certs/dev.crt`. */
  cert?: string;
  /** Path to a PEM-encoded private key. Defaults to `.hopak/certs/dev.key`. */
  key?: string;
}

export interface DatabaseOptions {
  dialect: DbDialect;
  url?: string;
  file?: string;
}

export interface CorsOptions {
  origins: string[] | '*';
  credentials?: boolean;
}

export interface HopakConfig {
  server: ServerOptions;
  database: DatabaseOptions;
  paths: HopakPaths;
  cors?: CorsOptions;
  logLevel?: LogLevel;
}

export type HopakConfigInput = DeepPartial<HopakConfig>;

export interface RuntimeContext {
  log: Logger;
  config: HopakConfig;
}
