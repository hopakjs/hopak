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
  /** Enable HTTPS listener. When true, a self-signed cert is auto-generated unless `cert`+`key` are provided. */
  enabled: boolean;
  /** HTTPS port (default 3443). */
  port?: number;
  /** Path to an existing PEM-encoded certificate. Leave empty to auto-generate a dev cert. */
  cert?: string;
  /** Path to an existing PEM-encoded private key. Leave empty to auto-generate a dev cert. */
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
