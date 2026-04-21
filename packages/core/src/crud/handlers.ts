import { HttpStatus, ValidationError } from '@hopak/common';
import type { z } from 'zod';
import type { ModelClient } from '../db/client';
import type { RequestContext } from '../http/types';
import type { ModelDefinition } from '../model/define';
import { serializeForResponse, serializeListForResponse } from '../serialize';
import { buildModelSchema, validate } from '../validation';

/**
 * Handler factories for the six REST verbs over a `ModelDefinition`.
 * Each factory returns a pure `RequestContext → Response` function; the
 * database handle is read off `ctx.db` at call time, not captured at
 * module load. Combined with the `crud` namespace, this lets a user's
 * generated route file register CRUD explicitly:
 *
 *   // app/routes/api/posts.ts
 *   import { crud } from '@hopak/core';
 *   import post from '../../models/post';
 *   export const GET = crud.list(post);
 *   export const POST = crud.create(post);
 *
 * The runtime never walks the model registry to "wire up" anything — the
 * route files are the single source of truth.
 */

interface ListQuery {
  limit: number;
  offset: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MIN_LIMIT = 1;
const MIN_OFFSET = 0;

function parseListQuery(query: URLSearchParams): ListQuery {
  const rawLimit = query.get('limit');
  const rawOffset = query.get('offset');
  const limit = rawLimit
    ? Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, Number(rawLimit)))
    : DEFAULT_LIMIT;
  const offset = rawOffset ? Math.max(MIN_OFFSET, Number(rawOffset)) : MIN_OFFSET;
  return { limit, offset };
}

function parseId(raw: string | undefined): number | string {
  if (raw === undefined) {
    throw new ValidationError('Missing id parameter');
  }
  const asNumber = Number(raw);
  return Number.isFinite(asNumber) ? asNumber : raw;
}

function clientFor(ctx: RequestContext, model: ModelDefinition): ModelClient {
  if (!ctx.db) {
    throw new Error(
      `CRUD handler for '${model.name}' needs a configured database. Set \`database\` in hopak.config.ts or pass a \`db\` to the test server.`,
    );
  }
  return ctx.db.model(model.name);
}

function validateBody(schema: z.ZodType, body: unknown): Record<string, unknown> {
  const result = validate<Record<string, unknown>>(schema, body ?? {});
  if (!result.ok) throw new ValidationError('Invalid body', result.errors);
  return result.data;
}

export function createListHandler(model: ModelDefinition) {
  return async (ctx: RequestContext) => {
    const { limit, offset } = parseListQuery(ctx.query);
    const client = clientFor(ctx, model);
    const [rows, total] = await Promise.all([client.findMany({ limit, offset }), client.count()]);
    return {
      items: serializeListForResponse(rows, model),
      total,
      limit,
      offset,
    };
  };
}

export function createFindOneHandler(model: ModelDefinition) {
  return async (ctx: RequestContext) => {
    const row = await clientFor(ctx, model).findOrFail(parseId(ctx.params.id));
    return serializeForResponse(row, model);
  };
}

export function createCreateHandler(model: ModelDefinition) {
  const schema = buildModelSchema(model, { omitId: true });
  return async (ctx: RequestContext) => {
    const data = validateBody(schema, await ctx.body());
    const row = await clientFor(ctx, model).create(data);
    ctx.setStatus(HttpStatus.Created);
    return serializeForResponse(row, model);
  };
}

export function createUpdateHandler(model: ModelDefinition, partial: boolean) {
  const schema = buildModelSchema(model, { omitId: true, partial });
  return async (ctx: RequestContext) => {
    const data = validateBody(schema, await ctx.body());
    const row = await clientFor(ctx, model).update(parseId(ctx.params.id), data);
    return serializeForResponse(row, model);
  };
}

export function createDeleteHandler(model: ModelDefinition) {
  return async (ctx: RequestContext) => {
    const removed = await clientFor(ctx, model).delete(parseId(ctx.params.id));
    ctx.setStatus(removed ? HttpStatus.NoContent : HttpStatus.NotFound);
    return null;
  };
}
