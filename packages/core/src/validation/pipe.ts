import { ValidationError } from '@hopak/common';
import type { z } from 'zod';
import { validate } from './zod-generator';

export interface RouteSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

export interface ValidatedInput {
  body: unknown;
  query: Record<string, unknown>;
  params: Record<string, unknown>;
}

export interface ValidationContext {
  body: unknown;
  query: URLSearchParams;
  params: Record<string, string>;
}

function searchParamsToObject(query: URLSearchParams): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of query.entries()) {
    const existing = result[key];
    if (existing === undefined) {
      result[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      result[key] = [existing, value];
    }
  }
  return result;
}

function fail(field: string, errors: Record<string, string[]>): never {
  throw new ValidationError(`Invalid ${field}`, errors);
}

export function validateRequest(schemas: RouteSchemas, ctx: ValidationContext): ValidatedInput {
  const out: ValidatedInput = {
    body: ctx.body,
    query: searchParamsToObject(ctx.query),
    params: { ...ctx.params },
  };

  if (schemas.body) {
    const result = validate<unknown>(schemas.body, ctx.body);
    if (!result.ok) fail('body', result.errors);
    out.body = result.data;
  }

  if (schemas.query) {
    const result = validate<Record<string, unknown>>(schemas.query, out.query);
    if (!result.ok) fail('query', result.errors);
    out.query = result.data;
  }

  if (schemas.params) {
    const result = validate<Record<string, unknown>>(schemas.params, ctx.params);
    if (!result.ok) fail('params', result.errors);
    out.params = result.data;
  }

  return out;
}
