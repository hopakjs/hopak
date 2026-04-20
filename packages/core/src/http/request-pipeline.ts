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

function methodNotAllowedResponse(allowed: readonly string[] = []): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json;charset=utf-8' };
  if (allowed.length > 0) headers.Allow = allowed.join(', ');
  return new Response(
    JSON.stringify({
      error: 'METHOD_NOT_ALLOWED',
      message: allowed.length > 0 ? `Allowed methods: ${allowed.join(', ')}` : 'Method Not Allowed',
    }),
    { status: HttpStatus.MethodNotAllowed, headers },
  );
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

      // The path has handlers under other verbs — `405` with an `Allow`
      // header is the correct surface, not `404`. Browsers and proxies
      // (CORS preflight, caches) rely on this distinction.
      const allowed = router.allowedMethods(url.pathname);
      if (allowed.length > 0) return decorate(req, methodNotAllowedResponse(allowed));

      return decorate(req, notFoundResponse(method, url.pathname));
    } catch (cause) {
      return decorate(req, handleError(cause, { log, exposeStack }));
    }
  };
}
