import type { RouteDefinition, RouteHandler } from './types';

export interface RouteInput {
  handler: RouteHandler;
  auth?: boolean;
  validate?: boolean;
}

export function defineRoute(input: RouteInput): RouteDefinition {
  return {
    handler: input.handler,
    auth: input.auth,
    validate: input.validate,
  };
}
