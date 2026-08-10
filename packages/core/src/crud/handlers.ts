import { HttpStatus, ValidationError } from '@hopak/common';
import type * as v from 'valibot';
import type { ModelClient } from '../db/client';
import type { RequestContext } from '../http/types';
import type { ModelDefinition } from '../model/define';
import { serializeForResponse, serializeListForResponse } from '../serialize';
import { buildModelSchema, validate } from '../validation';

interface ListQuery {
  limit: number;
  offset: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MIN_LIMIT = 1;
const MIN_OFFSET = 0;

function parsePageParam(query: URLSearchParams, name: string, fallback: number): number {
  const raw = query.get(name);
  if (raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new ValidationError(`Invalid ${name}: expected an integer, got '${raw}'`);
  }
  return value;
}

function parseListQuery(query: URLSearchParams): ListQuery {
  const limit = Math.max(
    MIN_LIMIT,
    Math.min(MAX_LIMIT, parsePageParam(query, 'limit', DEFAULT_LIMIT)),
  );
  const offset = Math.max(MIN_OFFSET, parsePageParam(query, 'offset', MIN_OFFSET));
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

function validateBody(schema: v.GenericSchema, body: unknown): Record<string, unknown> {
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

/**
 * Schemas are built on first request, not when the route is declared.
 * A plugin-registered field type is only in the registry after plugin
 * setup, and route modules can be imported before that (test files
 * assembling a router by hand, tooling importing route files). One
 * build per handler either way — the result is memoized.
 */
function lazySchema(build: () => v.GenericSchema): () => v.GenericSchema {
  let schema: v.GenericSchema | undefined;
  return () => {
    schema ??= build();
    return schema;
  };
}

export function createCreateHandler(model: ModelDefinition) {
  const schemaFor = lazySchema(() => buildModelSchema(model, { omitId: true }));
  return async (ctx: RequestContext) => {
    const data = validateBody(schemaFor(), await ctx.body());
    const row = await clientFor(ctx, model).create(data);
    ctx.setStatus(HttpStatus.Created);
    return serializeForResponse(row, model);
  };
}

export function createUpdateHandler(model: ModelDefinition, partial: boolean) {
  const schemaFor = lazySchema(() => buildModelSchema(model, { omitId: true, partial }));
  return async (ctx: RequestContext) => {
    const data = validateBody(schemaFor(), await ctx.body());
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
