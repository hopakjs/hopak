import { type Logger, createLogger } from '@hopak/common';
import type { Database } from '../db/client';
import { createCorsHandler } from './cors';
import { DEFAULT_HOST, DEFAULT_PORT, DISPLAY_HOST } from './defaults';
import { EMPTY_MIDDLEWARE, type Middleware } from './middleware';
import { createRequestHandler } from './request-pipeline';
import { Router } from './router';
import { createStaticHandler } from './static';

export interface StartServerOptions {
  port?: number;
  host?: string;
  log?: Logger;
  router?: Router;
  staticDir?: string;
  cors?: { origins: string[] | '*'; credentials?: boolean };
  /** Global middleware accumulated via `hopak().before/after/wrap()`. */
  middleware?: Middleware;
  db?: Database;
  exposeStack?: boolean;
  tls?: { key: string; cert: string };
}

export interface ListeningServer {
  readonly url: string;
  readonly port: number;
  stop(): Promise<void>;
}

function buildUrl(host: string, port: number, secure: boolean): string {
  const protocol = secure ? 'https' : 'http';
  const display = host === DEFAULT_HOST ? DISPLAY_HOST : host;
  return `${protocol}://${display}:${port}`;
}

export async function startServer(options: StartServerOptions): Promise<ListeningServer> {
  const log = options.log ?? createLogger();
  const router = options.router ?? new Router();
  const staticHandler = options.staticDir
    ? createStaticHandler({ publicDir: options.staticDir })
    : null;
  const cors = options.cors
    ? createCorsHandler({ origins: options.cors.origins, credentials: options.cors.credentials })
    : null;

  const handler = createRequestHandler({
    router,
    log,
    staticHandler,
    cors,
    globalMiddleware: options.middleware ?? EMPTY_MIDDLEWARE,
    db: options.db,
    exposeStack: options.exposeStack,
  });

  const host = options.host ?? DEFAULT_HOST;
  const engine = Bun.serve({
    port: options.port ?? DEFAULT_PORT,
    hostname: host,
    fetch: handler,
    ...(options.tls ? { tls: options.tls } : {}),
  });

  // `engine.port` is typed `number | undefined` but always bound by the time
  // `Bun.serve` returns (it throws on bind failure instead of returning).
  const port = engine.port as number;

  return {
    url: buildUrl(host, port, Boolean(options.tls)),
    port,
    async stop() {
      engine.stop();
    },
  };
}
