import type { After, Before, Wrap } from '../http/middleware';
import { defineRoute } from '../http/route';
import type { RouteDefinition } from '../http/types';
import type { ModelDefinition } from '../model/define';
import {
  createCreateHandler,
  createDeleteHandler,
  createFindOneHandler,
  createListHandler,
  createUpdateHandler,
} from './handlers';

export {
  createCreateHandler,
  createDeleteHandler,
  createFindOneHandler,
  createListHandler,
  createUpdateHandler,
} from './handlers';

/** Middleware you can attach to any `crud.*` route. */
export interface CrudRouteOptions {
  before?: readonly Before[];
  after?: readonly After[];
  wrap?: readonly Wrap[];
}

function withOpts(handler: (m: ModelDefinition) => RouteDefinition['handler']) {
  return (model: ModelDefinition, opts?: CrudRouteOptions): RouteDefinition =>
    defineRoute({ handler: handler(model), ...opts });
}

/**
 * Per-verb `RouteDefinition` builders for use inside a route file.
 * Nothing is registered at runtime; the file itself is the source of
 * truth. The `hopak` CLI scaffolds the matching files — see
 * `hopak generate crud <name>`.
 *
 * Typical layout:
 *   app/routes/api/posts.ts         → list + create
 *   app/routes/api/posts/[id].ts    → read + update + patch + delete
 *
 * Optional `{ before, after, wrap }` plugs in middleware — common
 * pattern: `crud.create(post, { before: [requireAuth()] })`.
 */
export const crud = {
  list: withOpts(createListHandler),
  read: withOpts(createFindOneHandler),
  create: withOpts(createCreateHandler),
  update: withOpts((m) => createUpdateHandler(m, false)),
  patch: withOpts((m) => createUpdateHandler(m, true)),
  remove: withOpts(createDeleteHandler),
};
