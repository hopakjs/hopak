import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type HopakConfig, type HopakConfigInput, type Logger, createLogger } from '@hopak/common';
import { registerCrudRoutes } from '../crud/register';
import type { Database } from '../db/client';
import { createDatabase } from '../db/factory';
import { loadFileRoutes } from '../http/loader';
import { Router } from '../http/router';
import { type ListeningServer, startServer } from '../http/server';
import { ModelRegistry } from '../model/registry';
import { Scanner } from '../scanner';
import { applyConfig, loadConfigFile } from './config';

export interface CreateAppOptions {
  rootDir?: string;
  config?: HopakConfigInput;
  log?: Logger;
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

async function connectDatabase(config: HopakConfig, registry: ModelRegistry): Promise<Database> {
  const db = createDatabase({
    dialect: config.database.dialect,
    models: registry.all(),
    file: config.database.file,
    url: config.database.url,
  });
  await db.sync();
  return db;
}

async function buildRouter(
  config: HopakConfig,
  db: Database,
  registry: ModelRegistry,
  log: Logger,
): Promise<Router> {
  const router = new Router();
  const fileRoutes = await loadFileRoutes({ routesDir: config.paths.routes, router, log });
  log.debug('Loaded file routes', { count: fileRoutes.routes });

  const crud = registerCrudRoutes({ router, db, models: registry.all(), log });
  log.debug('Registered CRUD routes', {
    registered: crud.registered,
    skipped: crud.skipped.length,
  });

  return router;
}

export async function createApp(options: CreateAppOptions = {}): Promise<HopakApp> {
  const rootDir = options.rootDir ?? process.cwd();
  const log = options.log ?? createLogger();

  const config = await resolveConfig(rootDir, options.config);
  log.debug('Loaded config', { rootDir });

  const registry = await discoverModels(config, log);
  await ensureWritableDirs(config);
  const db = await connectDatabase(config, registry);
  const router = await buildRouter(config, db, registry, log);

  let server: ListeningServer | undefined;

  return {
    config,
    registry,
    router,
    db,
    log,

    async listen(port) {
      server = await startServer({
        port: port ?? config.server.port,
        host: config.server.host,
        router,
        staticDir: config.paths.public,
        log,
        db,
        ...(config.cors ? { cors: config.cors } : {}),
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
