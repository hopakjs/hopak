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

/**
 * Run the before-chain. Each `Before`:
 *   - throw → propagates up (outer try/catch turns it into an HTTP response)
 *   - return Response → short-circuits the whole pipeline with that response
 *   - return void → continue to the next before / handler
 */
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

/**
 * Compose `Wrap`s around a core execution function. Outer wraps run
 * first on entry, last on exit (classic onion). Empty array yields
 * `core` unchanged.
 */
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

  return async function handle(req: Request, engine: Engine): Promise<Response> {
    if (cors) {
      const preflight = cors.preflight(req);
      if (preflight) return preflight;
    }

    const method = req.method.toUpperCase();
    if (!isHttpMethod(method)) return methodNotAllowedResponse();

    const url = new URL(req.url);
    const match = router.match(method, url.pathname);

    if (!match) {
      if (STATIC_METHODS.has(method) && staticHandler) {
        const staticResponse = await staticHandler.serve(url);
        if (staticResponse) return decorate(req, staticResponse);
      }
      const allowed = router.allowedMethods(url.pathname);
      if (allowed.length > 0) return decorate(req, methodNotAllowedResponse(allowed));
      return decorate(req, notFoundResponse(method, url.pathname));
    }

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

    const chains = mergeChains(globals, match.route.definition);

    let response: Response;
    let error: unknown;

    try {
      const core = async (): Promise<Response> => {
        const short = await runBefore(ctx, chains.before);
        if (short) return short;
        const result = await match.route.definition.handler(ctx);
        return toResponse(result, responseInit);
      };
      const execute = composeWraps(core, chains.wrap, ctx);
      response = await execute();
    } catch (cause) {
      error = cause;
      response = handleError(cause, { log, exposeStack });
    }

    await runAfter(ctx, chains.after, { response, error }, log);
    return decorate(req, response);
  };
}
