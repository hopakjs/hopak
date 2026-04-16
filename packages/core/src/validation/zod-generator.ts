import { z } from 'zod';
import { adapterFor } from '../fields/adapters';
import type { FieldDefinition } from '../fields/base';
import type { ModelDefinition } from '../model/define';

export type ZodFieldSchema = z.ZodType;

export interface SchemaOptions {
  partial?: boolean;
  omitId?: boolean;
}

export function buildFieldSchema(field: FieldDefinition): ZodFieldSchema | null {
  const base = adapterFor(field.type).zod(field);
  if (!base) return null;
  return field.required ? base : base.optional();
}

export function buildModelSchema(model: ModelDefinition, options: SchemaOptions = {}): z.ZodObject {
  const shape: Record<string, ZodFieldSchema> = {};

  for (const [name, field] of Object.entries(model.fields)) {
    const schema = buildFieldSchema(field);
    if (!schema) continue;
    shape[name] = options.partial ? schema.optional() : schema;
  }

  if (!options.omitId) {
    shape.id = z.union([z.number(), z.string()]).optional();
  }

  return z.object(shape);
}

export interface ValidationFailure {
  ok: false;
  errors: Record<string, string[]>;
}

export interface ValidationSuccess<T> {
  ok: true;
  data: T;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export function validate<T>(schema: z.ZodType, input: unknown): ValidationResult<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { ok: true, data: result.data as T };
  }
  const errors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    if (!errors[key]) errors[key] = [];
    errors[key].push(issue.message);
  }
  return { ok: false, errors };
}
