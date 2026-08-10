import type { FieldBuilder, InferFields } from '../fields/base';
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

type FieldMap = Record<string, FieldBuilder<unknown, boolean>>;

export interface CrudListResult<TRow> {
  items: TRow[];
  total: number;
  limit: number;
  offset: number;
}

/** Middleware you can attach to any `crud.*` route. */
export interface CrudRouteOptions {
  before?: readonly Before[];
  after?: readonly After[];
  wrap?: readonly Wrap[];
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
 *
 * Each builder carries the model's row type through to the route's
 * result type, so `crud.read(post)` is a `RouteDefinition<Post>`. The
 * casts below are the single boundary where the untyped handler
 * factories meet the inferred row type.
 */
export const crud = {
  list<TFields extends FieldMap>(
    model: ModelDefinition<TFields>,
    opts?: CrudRouteOptions,
  ): RouteDefinition<CrudListResult<InferFields<TFields>>> {
    return defineRoute({
      handler: createListHandler(model),
      ...opts,
      openapi: { model: model.name, kind: 'list' },
    }) as RouteDefinition<CrudListResult<InferFields<TFields>>>;
  },
  read<TFields extends FieldMap>(
    model: ModelDefinition<TFields>,
    opts?: CrudRouteOptions,
  ): RouteDefinition<InferFields<TFields>> {
    return defineRoute({
      handler: createFindOneHandler(model),
      ...opts,
      openapi: { model: model.name, kind: 'read' },
    }) as RouteDefinition<InferFields<TFields>>;
  },
  create<TFields extends FieldMap>(
    model: ModelDefinition<TFields>,
    opts?: CrudRouteOptions,
  ): RouteDefinition<InferFields<TFields>> {
    return defineRoute({
      handler: createCreateHandler(model),
      ...opts,
      openapi: { model: model.name, kind: 'create' },
    }) as RouteDefinition<InferFields<TFields>>;
  },
  update<TFields extends FieldMap>(
    model: ModelDefinition<TFields>,
    opts?: CrudRouteOptions,
  ): RouteDefinition<InferFields<TFields>> {
    return defineRoute({
      handler: createUpdateHandler(model, false),
      ...opts,
      openapi: { model: model.name, kind: 'update' },
    }) as RouteDefinition<InferFields<TFields>>;
  },
  patch<TFields extends FieldMap>(
    model: ModelDefinition<TFields>,
    opts?: CrudRouteOptions,
  ): RouteDefinition<InferFields<TFields>> {
    return defineRoute({
      handler: createUpdateHandler(model, true),
      ...opts,
      openapi: { model: model.name, kind: 'patch' },
    }) as RouteDefinition<InferFields<TFields>>;
  },
  remove<TFields extends FieldMap>(
    model: ModelDefinition<TFields>,
    opts?: CrudRouteOptions,
  ): RouteDefinition<null> {
    return defineRoute({
      handler: createDeleteHandler(model),
      ...opts,
      openapi: { model: model.name, kind: 'remove' },
    }) as RouteDefinition<null>;
  },
};
