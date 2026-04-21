import type { After, Before, Wrap } from './middleware';
import type { RouteDefinition, RouteHandler } from './types';

export interface RouteInput {
  handler: RouteHandler;
  before?: readonly Before[];
  after?: readonly After[];
  wrap?: readonly Wrap[];
}

export function defineRoute(input: RouteInput): RouteDefinition {
  const def: {
    handler: RouteHandler;
    before?: readonly Before[];
    after?: readonly After[];
    wrap?: readonly Wrap[];
  } = { handler: input.handler };
  if (input.before && input.before.length > 0) def.before = input.before;
  if (input.after && input.after.length > 0) def.after = input.after;
  if (input.wrap && input.wrap.length > 0) def.wrap = input.wrap;
  return def;
}
