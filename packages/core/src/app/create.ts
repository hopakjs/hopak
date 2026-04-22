import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  type HopakConfig,
  type HopakConfigInput,
  type Logger,
  createLogger,
  pathExists,
} from '@hopak/common';
import { Glob } from 'bun';
import type { Database } from '../db/client';
import { createDatabase } from '../db/factory';
import { translateConnectError } from '../db/sql/connect-translator';
import { detectDrift } from '../db/sql/introspect';
import { loadDevCert } from '../http/certs';
import { loadFileRoutes } from '../http/loader';
import { EMPTY_MIDDLEWARE, type Middleware } from '../http/middleware';
import { Router } from '../http/router';
import { type ListeningServer, startServer } from '../http/server';
import { ModelRegistry } from '../model/registry';
import { Scanner } from '../scanner';
import { applyConfig, loadConfigFile } from './config';

const DEFAULT_HTTPS_PORT = 3443;
const DEV_CERT_DIRNAME = 'certs';

export interface CreateAppOptions {
  rootDir?: string;
  config?: HopakConfigInput;
  log?: Logger;
  /** Global middleware — accumulated via `hopak().before/after/wrap()`. */
  middleware?: Middleware;
  /**
   * Skip loading route files from `app/routes/`. Intended for CLI subcommands
   * that only need models + db (e.g. `hopak migrate *`, `hopak sync`) — route
   * files often import from `app/middleware/*` which may throw at module load
   * without env vars, and those errors distract from what the subcommand is
   * actually doing.
   */
  skipRoutes?: boolean;
}

export interface HopakApp {
  readonly config: HopakConfig;
  readonly registry: ModelRegistry;
  readonly router: Router;
  readonly db: Database;
  readonly log: Logger;
  listen(port?: number): Promise<ListeningServer>;
  stop(): Promise<void>;
}

async function resolveConfig(
  rootDir: string,
  override: HopakConfigInput | undefined,
): Promise<HopakConfig> {
  const fileConfig = override ?? (await loadConfigFile(rootDir));
  return applyConfig(rootDir, fileConfig);
}

async function discoverModels(config: HopakConfig, log: Logger): Promise<ModelRegistry> {
  const registry = new ModelRegistry();
  const scanner = new Scanner({ modelsDir: config.paths.models, registry, log });
  const result = await scanner.scanModels();
  log.debug('Scanned models', { count: result.models, errors: result.errors.length });
  return registry;
}

async function ensureWritableDirs(config: HopakConfig): Promise<void> {
  if (config.database.file) {
    await mkdir(dirname(config.database.file), { recursive: true });
  }
  await mkdir(config.paths.hopakDir, { recursive: true });
}

async function connectDatabase(
  config: HopakConfig,
  registry: ModelRegistry,
  log: Logger,
): Promise<Database> {
  const db = createDatabase({
    dialect: config.database.dialect,
    models: registry.all(),
    file: config.database.file,
    url: config.database.url,
  });
  try {
    if (await hasMigrationsDir(config.paths.migrations)) {
      log.debug('Schema evolution managed by migrations/ — skipping sync');
    } else {
      await db.sync();
      await warnOnDrift(db, config, registry, log);
    }
  } catch (error) {
    throw translateConnectError(error, config.database.dialect, config.database.url);
  }
  return db;
}

async function warnOnDrift(
  db: Database,
  config: HopakConfig,
  registry: ModelRegistry,
  log: Logger,
): Promise<void> {
  const drift = await detectDrift(db, config.database.dialect, registry.all());
  if (drift.length === 0) return;
  const list = drift
    .map(
      (d) => `    ${d.table}: missing columns ${d.missingColumns.map((c) => `"${c}"`).join(', ')}`,
    )
    .join('\n');
  log.warn(
    `Model schema drifted from the database. \`hopak sync\` only creates new tables; column changes need a migration:\n${list}\n\n  hopak migrate init       # one-time: capture current state\n  hopak migrate new <name> # write ALTER TABLE up/down`,
  );
}

async function hasMigrationsDir(dir: string): Promise<boolean> {
  if (!(await pathExists(dir))) return false;
  const glob = new Glob('*.ts');
  for await (const _ of glob.scan({ cwd: dir })) return true;
  return false;
}

async function buildRouter(config: HopakConfig, log: Logger): Promise<Router> {
  const router = new Router();
  const fileRoutes = await loadFileRoutes({ routesDir: config.paths.routes, router, log });
  log.debug('Loaded file routes', { count: fileRoutes.routes });
  return router;
}

interface TlsMaterial {
  readonly cert: string;
  readonly key: string;
}

function resolveCertPath(value: string, config: HopakConfig): string {
  return isAbsolute(value) ? value : resolve(dirname(config.paths.hopakDir), value);
}

async function resolveTls(config: HopakConfig, log: Logger): Promise<TlsMaterial | undefined> {
  const https = config.server.https;
  if (!https?.enabled) return undefined;

  if (https.cert && https.key) {
    const [cert, key] = await Promise.all([
      Bun.file(resolveCertPath(https.cert, config)).text(),
      Bun.file(resolveCertPath(https.key, config)).text(),
    ]);
    return { cert, key };
  }

  const certDir = join(config.paths.hopakDir, DEV_CERT_DIRNAME);
  return loadDevCert(certDir);
}

function resolveListenPort(
  explicit: number | undefined,
  config: HopakConfig,
  tls: TlsMaterial | undefined,
): number {
  if (explicit !== undefined) return explicit;
  if (tls) return config.server.https?.port ?? DEFAULT_HTTPS_PORT;
  return config.server.port;
}

export async function createApp(options: CreateAppOptions = {}): Promise<HopakApp> {
  const rootDir = options.rootDir ?? process.cwd();
  const config = await resolveConfig(rootDir, options.config);
  // Caller-supplied logger wins over config.logLevel — use it for testing
  // where you want to capture output.
  const log = options.log ?? createLogger({ level: config.logLevel });
  log.debug('Loaded config', { rootDir, logLevel: config.logLevel });

  const registry = await discoverModels(config, log);
  await ensureWritableDirs(config);
  const db = await connectDatabase(config, registry, log);
  const router = options.skipRoutes ? new Router() : await buildRouter(config, log);

  let server: ListeningServer | undefined;

  return {
    config,
    registry,
    router,
    db,
    log,

    async listen(port) {
      const tls = await resolveTls(config, log);
      server = await startServer({
        port: resolveListenPort(port, config, tls),
        host: config.server.host,
        router,
        staticDir: config.paths.public,
        log,
        db,
        middleware: options.middleware ?? EMPTY_MIDDLEWARE,
        ...(config.cors ? { cors: config.cors } : {}),
        ...(tls ? { tls } : {}),
      });
      return server;
    },

    async stop() {
      if (server) {
        await server.stop();
        server = undefined;
      }
      await db.close();
    },
  };
}
