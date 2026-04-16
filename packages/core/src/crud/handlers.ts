import { HttpStatus, ValidationError } from '@hopak/common';
import type { z } from 'zod';
import type { Database, ModelClient } from '../db/client';
import type { RequestContext } from '../http/types';
import type { ModelDefinition } from '../model/define';
import { serializeForResponse, serializeListForResponse } from '../serialize';
import { buildModelSchema, validate } from '../validation';

export interface CrudDependencies {
  db: Database;
  model: ModelDefinition;
}

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

function getClient(deps: CrudDependencies): ModelClient {
  return deps.db.model(deps.model.name);
}

function validateBody(schema: z.ZodType, body: unknown): Record<string, unknown> {
  const result = validate<Record<string, unknown>>(schema, body ?? {});
  if (!result.ok) throw new ValidationError('Invalid body', result.errors);
  return result.data;
}

export function createListHandler(deps: CrudDependencies) {
  return async (ctx: RequestContext) => {
    const { limit, offset } = parseListQuery(ctx.query);
    const client = getClient(deps);
    const [rows, total] = await Promise.all([client.findMany({ limit, offset }), client.count()]);
    return {
      items: serializeListForResponse(rows, deps.model),
      total,
      limit,
      offset,
    };
  };
}

export function createFindOneHandler(deps: CrudDependencies) {
  return async (ctx: RequestContext) => {
    const row = await getClient(deps).findOrFail(parseId(ctx.params.id));
    return serializeForResponse(row, deps.model);
  };
}

export function createCreateHandler(deps: CrudDependencies) {
  const schema = buildModelSchema(deps.model, { omitId: true });
  return async (ctx: RequestContext) => {
    const data = validateBody(schema, await ctx.body());
    const row = await getClient(deps).create(data);
    ctx.setStatus(HttpStatus.Created);
    return serializeForResponse(row, deps.model);
  };
}

export function createUpdateHandler(deps: CrudDependencies, partial: boolean) {
  const schema = buildModelSchema(deps.model, { omitId: true, partial });
  return async (ctx: RequestContext) => {
    const data = validateBody(schema, await ctx.body());
    const row = await getClient(deps).update(parseId(ctx.params.id), data);
    return serializeForResponse(row, deps.model);
  };
}

export function createDeleteHandler(deps: CrudDependencies) {
  return async (ctx: RequestContext) => {
    const removed = await getClient(deps).delete(parseId(ctx.params.id));
    ctx.setStatus(removed ? HttpStatus.NoContent : HttpStatus.NotFound);
    return null;
  };
}
