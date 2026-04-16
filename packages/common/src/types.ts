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
  enabled: boolean;
  port?: number;
  cert?: string;
  key?: string;
  autoCert?: boolean;
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

export interface RateLimitOptions {
  max: number;
  window: string;
}

export interface HopakConfig {
  server: ServerOptions;
  database: DatabaseOptions;
  paths: HopakPaths;
  cors?: CorsOptions;
  rateLimit?: RateLimitOptions;
  strict?: boolean;
  logLevel?: LogLevel;
}

export type HopakConfigInput = DeepPartial<HopakConfig>;

export interface RuntimeContext {
  log: Logger;
  config: HopakConfig;
}
