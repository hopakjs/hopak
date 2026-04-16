import { HttpStatus, type Logger } from '@hopak/common';
import type { Server } from 'bun';
import type { Database } from '../db/client';
import type { CorsHandler } from './cors';
import { handleError } from './error-handler';
import { buildContext } from './request-context';
import { clientIp, isHttpMethod } from './request-info';
import { toResponse } from './response';
import type { Router } from './router';
import type { StaticHandler } from './static';

type Engine = Server<unknown>;

export interface PipelineOptions {
  router: Router;
  log: Logger;
  staticHandler: StaticHandler | null;
  cors: CorsHandler | null;
  db: Database | undefined;
  exposeStack?: boolean;
}

const STATIC_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

function notFoundResponse(method: string, path: string): Response {
  return Response.json(
    { error: 'NOT_FOUND', message: `No route for ${method} ${path}` },
    { status: HttpStatus.NotFound },
  );
}

function methodNotAllowedResponse(): Response {
  return new Response('Method Not Allowed', { status: HttpStatus.MethodNotAllowed });
}

export function createRequestHandler(options: PipelineOptions) {
  const { router, log, staticHandler, cors, db, exposeStack } = options;

  const decorate = (req: Request, response: Response): Response =>
    cors ? cors.apply(req, response) : response;

  return async function handle(req: Request, engine: Engine): Promise<Response> {
    try {
      if (cors) {
        const preflight = cors.preflight(req);
        if (preflight) return preflight;
      }

      const method = req.method.toUpperCase();
      if (!isHttpMethod(method)) return methodNotAllowedResponse();

      const url = new URL(req.url);
      const match = router.match(method, url.pathname);

      if (match) {
        const ip = clientIp(req, engine);
        const { ctx, responseInit } = buildContext({
          req,
          url,
          method,
          params: match.params,
          log,
          ip,
          db,
        });
        const result = await match.route.definition.handler(ctx);
        return decorate(req, toResponse(result, responseInit));
      }

      if (STATIC_METHODS.has(method) && staticHandler) {
        const staticResponse = await staticHandler.serve(url);
        if (staticResponse) return decorate(req, staticResponse);
      }

      return decorate(req, notFoundResponse(method, url.pathname));
    } catch (cause) {
      return decorate(req, handleError(cause, { log, exposeStack }));
    }
  };
}
