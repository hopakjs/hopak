import type { After, Before, Wrap } from './middleware';
import type { RouteDefinition, RouteHandler, RouteOpenApiMeta } from './types';

export interface RouteInput<TResult = unknown> {
  handler: RouteHandler<TResult>;
  before?: readonly Before[];
  after?: readonly After[];
  wrap?: readonly Wrap[];
  openapi?: RouteOpenApiMeta;
}

export function defineRoute<TResult>(input: RouteInput<TResult>): RouteDefinition<TResult> {
  const def: {
    handler: RouteHandler<TResult>;
    before?: readonly Before[];
    after?: readonly After[];
    wrap?: readonly Wrap[];
    openapi?: RouteOpenApiMeta;
  } = { handler: input.handler };
  if (input.before && input.before.length > 0) def.before = input.before;
  if (input.after && input.after.length > 0) def.after = input.after;
  if (input.wrap && input.wrap.length > 0) def.wrap = input.wrap;
  if (input.openapi) def.openapi = input.openapi;
  return def;
}
