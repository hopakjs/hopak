import type { RequestContext } from './types';

/**
 * Three hooks for the request pipeline. Not a Koa-style `(ctx, next)`
 * chain — three typed functions so there's no `next()` to forget.
 *
 * Execution order for one request:
 *
 *   global.before[]  →  wrap[]  →  route.before[]  →  handler
 *                                   (throw or return Response short-circuits)
 *   route.after[]    →  global.after[]
 *
 * Each `Wrap` outer-wraps everything after it — outer-most runs first
 * on entry, last on exit.
 */

/** Throw or return a Response to short-circuit. Return nothing to continue. */
export type Before = (ctx: RequestContext) => Promise<Response | void> | Response | void;

/** Read-only observability — cannot change the response. For that, use `Wrap`. */
export type After = (
  ctx: RequestContext,
  result: { response?: Response; error?: unknown },
) => Promise<void> | void;

/** `run()` produces the response. Use this when you need code on both sides. */
export type Wrap = (ctx: RequestContext, run: () => Promise<Response>) => Promise<Response>;

export interface Middleware {
  readonly before: readonly Before[];
  readonly after: readonly After[];
  readonly wrap: readonly Wrap[];
}

export const EMPTY_MIDDLEWARE: Middleware = {
  before: [],
  after: [],
  wrap: [],
};
