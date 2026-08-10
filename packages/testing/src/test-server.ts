import type { Logger } from '@hopak/common';
import { createLogger } from '@hopak/common';
import {
  type Database,
  type HopakApp,
  type HopakPlugin,
  type ListeningServer,
  type Middleware,
  type ModelDefinition,
  Router,
  createApp,
  createDatabase,
  defaultConfig,
  setupPlugins,
  startServer,
} from '@hopak/core';
import { type JsonClient, createJsonClient } from './json-client';

function mergeMiddleware(
  plugin: Middleware | undefined,
  user: Middleware | undefined,
): Middleware | undefined {
  if (!plugin) return user;
  if (!user) return plugin;
  return {
    before: [...plugin.before, ...user.before],
    after: [...plugin.after, ...user.after],
    wrap: [...plugin.wrap, ...user.wrap],
  };
}

export interface TestServerOptions {
  /**
   * Boot the server exactly like `hopak dev` would — scan models in
   * `<rootDir>/app/models`, load file routes from `<rootDir>/app/routes`.
   * Mutually exclusive with `models` / `router`.
   */
  rootDir?: string;
  /**
   * Models to sync to an ephemeral SQLite db. Pair with `router` that
   * references the same `ModelDefinition`s via the `crud.*` helpers if
   * you want REST endpoints — nothing auto-registers anymore.
   */
  models?: readonly ModelDefinition[];
  router?: Router;
  /**
   * Plugins the app under test registers via `hopak().use()`. Required
   * whenever a model uses a plugin-provided field type — the registry is
   * populated during plugin setup, before models are scanned.
   */
  plugins?: readonly HopakPlugin[];
  /** Global middleware (before/after/wrap) applied to every request. */
  middleware?: Middleware;
  /** Override the logger — useful for capturing output in tests. */
  log?: Logger;
  exposeStack?: boolean;
  staticDir?: string;
}

export interface TestServer {
  readonly url: string;
  readonly router: Router;
  readonly db: Database | null;
  readonly client: JsonClient;
  readonly server: ListeningServer;
  /** Returns the database, throwing if the server was created without models. */
  requireDb(): Database;
  stop(): Promise<void>;
}

export async function createTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  if (options.rootDir) {
    return createRootDirServer(options);
  }
  return createInMemoryServer(options);
}

async function createRootDirServer(options: TestServerOptions): Promise<TestServer> {
  if (options.router || options.models) {
    throw new Error(
      '`rootDir` is mutually exclusive with `router` / `models`. Point the test server at a project root, or assemble the router in-memory — not both.',
    );
  }
  const app: HopakApp = await createApp({
    rootDir: options.rootDir,
    ...(options.plugins ? { plugins: options.plugins } : {}),
    ...(options.log ? { log: options.log } : {}),
  });
  const server = await app.listen(0);
  return {
    url: server.url,
    router: app.router,
    db: app.db,
    client: createJsonClient(server.url),
    server,
    requireDb() {
      if (!app.db) {
        throw new Error('TestServer booted from rootDir has no database — check hopak.config.ts.');
      }
      return app.db;
    },
    async stop() {
      await app.stop();
    },
  };
}

async function createInMemoryServer(options: TestServerOptions): Promise<TestServer> {
  const router = options.router ?? new Router();

  // Field types a plugin registers must exist before the schema is built.
  let pluginMiddleware: Middleware | undefined;
  if (options.plugins?.length) {
    const runtime = await setupPlugins(
      options.plugins,
      defaultConfig(process.cwd()),
      options.log ?? createLogger({ level: 'error' }),
    );
    for (const hook of runtime.bootHooks) await hook();
    pluginMiddleware = runtime.middleware;
  }

  const db = options.models ? createDatabase({ dialect: 'sqlite', models: options.models }) : null;
  if (db) await db.sync();

  const middleware = mergeMiddleware(pluginMiddleware, options.middleware);

  const server = await startServer({
    port: 0,
    router,
    ...(db ? { db } : {}),
    ...(middleware ? { middleware } : {}),
    ...(options.log ? { log: options.log } : {}),
    ...(options.staticDir !== undefined ? { staticDir: options.staticDir } : {}),
    ...(options.exposeStack !== undefined ? { exposeStack: options.exposeStack } : {}),
  });

  return {
    url: server.url,
    router,
    db,
    client: createJsonClient(server.url),
    server,
    requireDb() {
      if (!db) {
        throw new Error(
          'TestServer was created without `models`; pass at least one model to access the database.',
        );
      }
      return db;
    },
    async stop() {
      await server.stop();
      if (db) await db.close();
    },
  };
}
