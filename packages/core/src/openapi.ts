import { isVirtual } from './fields/adapters';
import type { FieldDefinition } from './fields/base';
import type { Router } from './http/router';
import type { RouteSegment } from './http/types';
import type { ModelDefinition } from './model/define';

export interface OpenApiInfo {
  title?: string;
  version?: string;
  description?: string;
}

export interface BuildOpenApiOptions {
  models: readonly ModelDefinition[];
  router: Router;
  info?: OpenApiInfo;
}

type JsonObject = Record<string, unknown>;

function fieldSchema(field: FieldDefinition): JsonObject {
  switch (field.type) {
    case 'text':
    case 'phone':
    case 'password':
    case 'secret':
    case 'token':
      return withStringBounds({ type: 'string' }, field);
    case 'email':
      return withStringBounds({ type: 'string', format: 'email' }, field);
    case 'url':
      return withStringBounds({ type: 'string', format: 'uri' }, field);
    case 'enum':
      return { type: 'string', ...(field.enumValues ? { enum: [...field.enumValues] } : {}) };
    case 'number':
      return withNumberBounds({ type: 'integer' }, field);
    case 'money':
      return withNumberBounds({ type: 'number' }, field);
    case 'boolean':
      return { type: 'boolean' };
    case 'date':
    case 'timestamp':
      return { type: 'string', format: 'date-time' };
    case 'json':
      return {};
    case 'file':
    case 'image':
      return {
        type: 'object',
        properties: {
          url: { type: 'string', format: 'uri' },
          mimeType: { type: 'string' },
          size: { type: 'integer' },
          name: { type: 'string' },
        },
        required: ['url', 'mimeType', 'size'],
      };
    case 'belongsTo':
      return { type: 'integer' };
    default:
      return {};
  }
}

function withStringBounds(schema: JsonObject, field: FieldDefinition): JsonObject {
  if (field.min !== undefined) schema.minLength = field.min;
  if (field.max !== undefined) schema.maxLength = field.max;
  if (field.pattern) schema.pattern = field.pattern;
  return schema;
}

function withNumberBounds(schema: JsonObject, field: FieldDefinition): JsonObject {
  if (field.min !== undefined) schema.minimum = field.min;
  if (field.max !== undefined) schema.maximum = field.max;
  return schema;
}

function pascal(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Response schema — sensitive fields stripped, id + timestamps present. */
function responseSchema(model: ModelDefinition): JsonObject {
  const properties: JsonObject = { id: { type: 'integer' } };
  const required: string[] = ['id'];
  for (const [name, field] of Object.entries(model.fields)) {
    if (isVirtual(field) || field.excludeFromJson) continue;
    properties[name] = fieldSchema(field);
    if (field.required) required.push(name);
  }
  if (model.options.timestamps) {
    properties.created_at = { type: 'string', format: 'date-time' };
    properties.updated_at = { type: 'string', format: 'date-time' };
  }
  return { type: 'object', properties, required };
}

/** Request-body schema — no id/timestamps, sensitive fields included. */
function inputSchema(model: ModelDefinition, partial: boolean): JsonObject {
  const properties: JsonObject = {};
  const required: string[] = [];
  for (const [name, field] of Object.entries(model.fields)) {
    if (isVirtual(field)) continue;
    properties[name] = fieldSchema(field);
    if (field.required && !partial) required.push(name);
  }
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) };
}

function openApiPath(segments: readonly RouteSegment[]): string {
  if (segments.length === 0) return '/';
  return `/${segments.map((s) => (s.kind === 'static' ? s.value : `{${s.name}}`)).join('/')}`;
}

function pathParameters(segments: readonly RouteSegment[]): JsonObject[] {
  return segments
    .filter((s) => s.kind !== 'static')
    .map((s) => ({
      name: (s as { name: string }).name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
}

const ERROR_RESPONSE: JsonObject = {
  description: 'Error',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          message: { type: 'string' },
          details: {},
        },
        required: ['error', 'message'],
      },
    },
  },
};

function jsonResponse(description: string, schema: JsonObject): JsonObject {
  return { description, content: { 'application/json': { schema } } };
}

function ref(name: string): JsonObject {
  return { $ref: `#/components/schemas/${name}` };
}

/**
 * Build an OpenAPI 3.1 document from the model registry and router.
 * CRUD routes carry `openapi` metadata linking them to their model, so
 * they get typed schemas; hand-written routes appear with generic
 * request/response objects unless they set `openapi` in `defineRoute`.
 * Exposed via `hopak openapi` in the CLI.
 */
export function buildOpenApiSpec(options: BuildOpenApiOptions): JsonObject {
  const { models, router } = options;
  const schemas: JsonObject = {};
  const modelByName = new Map(models.map((m) => [m.name, m]));

  for (const model of models) {
    schemas[pascal(model.name)] = responseSchema(model);
    schemas[`${pascal(model.name)}Input`] = inputSchema(model, false);
  }

  const paths: Record<string, JsonObject> = {};
  for (const route of router.list()) {
    const path = openApiPath(route.segments);
    const operation: JsonObject = { responses: {} };
    const responses = operation.responses as JsonObject;
    const params = pathParameters(route.segments);
    if (params.length > 0) operation.parameters = params;

    const meta = route.definition.openapi;
    const model = meta?.model ? modelByName.get(meta.model) : undefined;
    if (meta?.summary) operation.summary = meta.summary;

    if (model && meta?.kind) {
      const name = pascal(model.name);
      operation.tags = [model.name];
      switch (meta.kind) {
        case 'list':
          operation.parameters = [
            ...params,
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } },
          ];
          responses['200'] = jsonResponse(`List ${model.name} rows`, {
            type: 'object',
            properties: {
              items: { type: 'array', items: ref(name) },
              total: { type: 'integer' },
              limit: { type: 'integer' },
              offset: { type: 'integer' },
            },
            required: ['items', 'total', 'limit', 'offset'],
          });
          break;
        case 'read':
          responses['200'] = jsonResponse(`One ${model.name}`, ref(name));
          responses['404'] = ERROR_RESPONSE;
          break;
        case 'create':
          operation.requestBody = {
            required: true,
            content: { 'application/json': { schema: ref(`${name}Input`) } },
          };
          responses['201'] = jsonResponse(`Created ${model.name}`, ref(name));
          responses['400'] = ERROR_RESPONSE;
          responses['409'] = ERROR_RESPONSE;
          break;
        case 'update':
        case 'patch':
          operation.requestBody = {
            required: true,
            content: {
              'application/json': {
                schema: meta.kind === 'patch' ? inputSchema(model, true) : ref(`${name}Input`),
              },
            },
          };
          responses['200'] = jsonResponse(`Updated ${model.name}`, ref(name));
          responses['400'] = ERROR_RESPONSE;
          responses['404'] = ERROR_RESPONSE;
          break;
        case 'remove':
          responses['204'] = { description: `Deleted ${model.name}` };
          responses['404'] = ERROR_RESPONSE;
          break;
      }
    } else {
      responses['200'] = jsonResponse('Success', {});
    }

    const entry = paths[path] ?? {};
    entry[route.method.toLowerCase()] = operation;
    paths[path] = entry;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: options.info?.title ?? 'Hopak API',
      version: options.info?.version ?? '1.0.0',
      ...(options.info?.description ? { description: options.info.description } : {}),
    },
    paths,
    components: { schemas },
  };
}
