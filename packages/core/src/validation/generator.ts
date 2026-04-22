import * as v from 'valibot';
import { adapterFor } from '../fields/adapters';
import type { FieldDefinition } from '../fields/base';
import type { ModelDefinition } from '../model/define';

export type FieldSchema = v.GenericSchema;

export interface SchemaOptions {
  partial?: boolean;
  omitId?: boolean;
}

export function buildFieldSchema(field: FieldDefinition): FieldSchema | null {
  const base = adapterFor(field.type).schema(field);
  if (!base) return null;
  return field.required ? base : v.optional(base);
}

export function buildModelSchema(
  model: ModelDefinition,
  options: SchemaOptions = {},
): v.GenericSchema {
  const shape: Record<string, FieldSchema> = {};

  for (const [name, field] of Object.entries(model.fields)) {
    const schema = buildFieldSchema(field);
    if (!schema) continue;
    shape[name] = options.partial ? v.optional(schema) : schema;
  }

  if (!options.omitId) {
    shape.id = v.optional(v.union([v.number(), v.string()]));
  }

  return v.object(shape);
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

export function validate<T>(schema: v.GenericSchema, input: unknown): ValidationResult<T> {
  const result = v.safeParse(schema, input);
  if (result.success) {
    return { ok: true, data: result.output as T };
  }
  const errors: Record<string, string[]> = {};
  for (const issue of result.issues) {
    const path = issue.path?.map((p) => String(p.key)).join('.') ?? '';
    const key = path.length > 0 ? path : '_';
    if (!errors[key]) errors[key] = [];
    errors[key].push(issue.message);
  }
  return { ok: false, errors };
}
