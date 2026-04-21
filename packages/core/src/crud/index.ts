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

/**
 * Per-verb `RouteDefinition` builders for use inside a route file.
 * Nothing is registered at runtime; the file itself is the source of
 * truth. The `hopak` CLI scaffolds the matching files — see
 * `hopak generate crud <name>`.
 *
 * Typical layout:
 *   app/routes/api/posts.ts         → list + create
 *   app/routes/api/posts/[id].ts    → read + update + patch + delete
 */
export const crud = {
  list: (model: ModelDefinition): RouteDefinition =>
    defineRoute({ handler: createListHandler(model) }),
  read: (model: ModelDefinition): RouteDefinition =>
    defineRoute({ handler: createFindOneHandler(model) }),
  create: (model: ModelDefinition): RouteDefinition =>
    defineRoute({ handler: createCreateHandler(model) }),
  update: (model: ModelDefinition): RouteDefinition =>
    defineRoute({ handler: createUpdateHandler(model, false) }),
  patch: (model: ModelDefinition): RouteDefinition =>
    defineRoute({ handler: createUpdateHandler(model, true) }),
  remove: (model: ModelDefinition): RouteDefinition =>
    defineRoute({ handler: createDeleteHandler(model) }),
};
