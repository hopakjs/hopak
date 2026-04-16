import {
  type Database,
  type ListeningServer,
  type ModelDefinition,
  Router,
  createDatabase,
  registerCrudRoutes,
  startServer,
} from '@hopak/core';
import { type JsonClient, createJsonClient } from './json-client';

export interface TestServerOptions {
  models?: readonly ModelDefinition[];
  router?: Router;
  exposeStack?: boolean;
  staticDir?: string;
  withCrud?: boolean;
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
  const router = options.router ?? new Router();
  const db = options.models ? createDatabase({ dialect: 'sqlite', models: options.models }) : null;
  if (db) await db.sync();
  if (db && options.withCrud && options.models) {
    registerCrudRoutes({ router, db, models: options.models });
  }

  const server = await startServer({
    port: 0,
    router,
    ...(db ? { db } : {}),
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
