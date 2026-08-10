import { describe, expect, test } from 'bun:test';
import { crud } from '../src/crud';
import { boolean, email, password, text } from '../src/fields';
import { defineRoute } from '../src/http/route';
import { Router } from '../src/http/router';
import { model } from '../src/model/define';
import { buildOpenApiSpec } from '../src/openapi';

const user = model('user', {
  name: text().required().min(2),
  email: email().required().unique(),
  password: password().required().min(8),
  active: boolean().default(true),
});

function makeRouter(): Router {
  const router = new Router();
  router.add('GET', '/api/users', crud.list(user));
  router.add('POST', '/api/users', crud.create(user));
  router.add('GET', '/api/users/[id]', crud.read(user));
  router.add('DELETE', '/api/users/[id]', crud.remove(user));
  router.add('GET', '/health', defineRoute({ handler: () => ({ ok: true }) }));
  return router;
}

describe('buildOpenApiSpec', () => {
  const spec = buildOpenApiSpec({ models: [user], router: makeRouter() }) as {
    openapi: string;
    paths: Record<string, Record<string, Record<string, unknown>>>;
    components: {
      schemas: Record<string, { properties: Record<string, unknown>; required?: string[] }>;
    };
  };

  test('emits 3.1 document with model schemas', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.components.schemas)).toEqual(
      expect.arrayContaining(['User', 'UserInput']),
    );
  });

  test('response schema strips sensitive fields, input schema keeps them', () => {
    expect(spec.components.schemas.User?.properties.password).toBeUndefined();
    expect(spec.components.schemas.UserInput?.properties.password).toEqual(
      expect.objectContaining({ type: 'string', minLength: 8 }),
    );
  });

  test('crud routes map to typed operations with params', () => {
    expect(spec.paths['/api/users']?.get).toBeDefined();
    expect(spec.paths['/api/users']?.post?.requestBody).toBeDefined();
    const read = spec.paths['/api/users/{id}']?.get as {
      parameters: { name: string; in: string }[];
      responses: Record<string, unknown>;
    };
    expect(read.parameters).toEqual([
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
    ]);
    expect(read.responses['404']).toBeDefined();
    expect(spec.paths['/api/users/{id}']?.delete?.responses).toHaveProperty('204');
  });

  test('custom routes fall back to a generic 200', () => {
    expect(spec.paths['/health']?.get?.responses).toHaveProperty('200');
  });
});
