import { HttpStatus, type Logger } from '@hopak/common';
import type { Server } from 'bun';
import type { Database } from '../db/client';
import type { CorsHandler } from './cors';
import { handleError } from './error-handler';
import {
  type After,
  type Before,
  EMPTY_MIDDLEWARE,
  type Middleware,
  type Wrap,
} from './middleware';
import { buildContext } from './request-context';
import { clientIp, isHttpMethod } from './request-info';
import { toResponse } from './response';
import type { Router } from './router';
import type { StaticHandler } from './static';
import type { RequestContext, RouteDefinition } from './types';

type Engine = Server<unknown>;

export interface PipelineOptions {
  router: Router;
  log: Logger;
  staticHandler: StaticHandler | null;
  cors: CorsHandler | null;
  globalMiddleware?: Middleware;
  db: Database | undefined;
  exposeStack?: boolean;
}

const STATIC_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);
const JSON_CONTENT_TYPE = 'application/json;charset=utf-8';
const METHOD_NOT_ALLOWED_GENERIC = new TextEncoder().encode(
  '{"error":"METHOD_NOT_ALLOWED","message":"Method Not Allowed"}',
);

function notFoundResponse(method: string, path: string): Response {
  return new Response(
    JSON.stringify({ error: 'NOT_FOUND', message: `No route for ${method} ${path}` }),
    { status: HttpStatus.NotFound, headers: { 'content-type': JSON_CONTENT_TYPE } },
  );
}

function methodNotAllowedResponse(allowed: readonly string[] = []): Response {
  if (allowed.length === 0) {
    return new Response(METHOD_NOT_ALLOWED_GENERIC, {
      status: HttpStatus.MethodNotAllowed,
      headers: { 'content-type': JSON_CONTENT_TYPE },
    });
  }
  const allowHeader = allowed.join(', ');
  return new Response(
    JSON.stringify({
      error: 'METHOD_NOT_ALLOWED',
      message: `Allowed methods: ${allowHeader}`,
    }),
    {
      status: HttpStatus.MethodNotAllowed,
      headers: { 'content-type': JSON_CONTENT_TYPE, Allow: allowHeader },
    },
  );
}

function applyContextHeaders(response: Response, headers: Headers): void {
  try {
    for (const [name, value] of headers) {
      if (!response.headers.has(name)) response.headers.set(name, value);
    }
  } catch {
    // A handler that returns a `fetch()` result hands us immutable
    // headers. Proxying is a fair thing to do; losing ctx.setHeader on
    // that one response is better than failing the request.
  }
}

async function runBefore(
  ctx: RequestContext,
  chain: readonly Before[],
): Promise<Response | undefined> {
  for (const step of chain) {
    const ret = await step(ctx);
    if (ret instanceof Response) return ret;
  }
  return undefined;
}

function composeWraps(core: () => Promise<Response>, wraps: readonly Wrap[], ctx: RequestContext) {
  return wraps.reduceRight<() => Promise<Response>>((inner, wrap) => () => wrap(ctx, inner), core);
}

async function runAfter(
  ctx: RequestContext,
  chain: readonly After[],
  result: { response?: Response; error?: unknown },
  log: Logger,
): Promise<void> {
  for (const step of chain) {
    try {
      await step(ctx, result);
    } catch (cause) {
      // After middleware should never crash the response pipeline —
      // they're observability, not request-path. Log and continue.
      log.error('After-middleware threw', {
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
}

function mergeChains(
  global: Middleware,
  route: Pick<RouteDefinition, 'before' | 'after' | 'wrap'>,
): Middleware {
  return {
    before: [...global.before, ...(route.before ?? [])],
    // Route `after`s run BEFORE global `after`s — route-level cleanup
    // first, then process-wide access log.
    after: [...(route.after ?? []), ...global.after],
    wrap: [...global.wrap, ...(route.wrap ?? [])],
  };
}

export function createRequestHandler(options: PipelineOptions) {
  const { router, log, staticHandler, cors, db, exposeStack } = options;
  const globals = options.globalMiddleware ?? EMPTY_MIDDLEWARE;

  const decorate = (req: Request, response: Response): Response =>
    cors ? cors.apply(req, response) : response;

  return async function handle(req: Request, engine: Engine): Promise<Response | undefined> {
    if (cors) {
      const preflight = cors.preflight(req);
      if (preflight) return preflight;
    }

    const method = req.method.toUpperCase();
    if (!isHttpMethod(method)) return methodNotAllowedResponse();

    const url = new URL(req.url);
    const match = router.match(method, url.pathname);

    const ip = clientIp(req, engine);
    const { ctx, responseInit } = buildContext({
      req,
      url,
      method,
      params: match?.params ?? {},
      log,
      ip,
      db,
    });

    // Unmatched requests (static files, 404, 405) flow through the same
    // middleware chains as routed ones, so global auth / rate limiting /
    // request logging see every request, not just the ones with a route.
    const chains = mergeChains(globals, match?.route.definition ?? {});

    let response: Response;
    let error: unknown;
    let upgraded = false;

    try {
      const core = async (): Promise<Response> => {
        const short = await runBefore(ctx, chains.before);
        if (short) return short;
        if (match) {
          // WS upgrade sits after the before-chain so global auth / rate
          // limiting gate WebSocket connections like any other request.
          const ws = match.route.definition.ws;
          if (ws && req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
            const ok = engine.upgrade(req, {
              data: { params: match.params, query: url.searchParams, handlers: ws },
            });
            if (ok) {
              upgraded = true;
              return new Response(null, { status: HttpStatus.Ok });
            }
          }
          const result = await match.route.definition.handler(ctx);
          return toResponse(result, responseInit);
        }
        if (STATIC_METHODS.has(method) && staticHandler) {
          const staticResponse = await staticHandler.serve(url, req);
          if (staticResponse) return staticResponse;
        }
        const allowed = router.allowedMethods(url.pathname);
        if (allowed.length > 0) return methodNotAllowedResponse(allowed);
        return notFoundResponse(method, url.pathname);
      };
      const execute = composeWraps(core, chains.wrap, ctx);
      response = await execute();
    } catch (cause) {
      error = cause;
      response = handleError(cause, { log, exposeStack });
    }

    // `toResponse` already applied these to handler return values, but a
    // Response built elsewhere — static file, 404, 405, an error, or one
    // a handler constructed itself — never saw them. Merge without
    // overwriting: whoever built the Response was more specific.
    applyContextHeaders(response, responseInit.headers);

    await runAfter(ctx, chains.after, { response, error }, log);
    // Bun's contract: return nothing for a request that was upgraded.
    if (upgraded) return undefined;
    return decorate(req, response);
  };
}
