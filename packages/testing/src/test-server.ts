import type { Logger } from '@hopak/common';
import {
  type Database,
  type HopakApp,
  type ListeningServer,
  type Middleware,
  type ModelDefinition,
  Router,
  createApp,
  createDatabase,
  startServer,
} from '@hopak/core';
import { type JsonClient, createJsonClient } from './json-client';

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
  const app: HopakApp = await createApp({ rootDir: options.rootDir });
  const server = await app.listen(0);
  return {
    url: server.url,
    router: app.router,
    db: app.db,
    client: createJsonClient(server.url),
    server,
    requireDb() {
      return app.db;
    },
    async stop() {
      await app.stop();
    },
  };
}

async function createInMemoryServer(options: TestServerOptions): Promise<TestServer> {
  const router = options.router ?? new Router();
  const db = options.models ? createDatabase({ dialect: 'sqlite', models: options.models }) : null;
  if (db) await db.sync();

  const server = await startServer({
    port: 0,
    router,
    ...(db ? { db } : {}),
    ...(options.middleware ? { middleware: options.middleware } : {}),
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
