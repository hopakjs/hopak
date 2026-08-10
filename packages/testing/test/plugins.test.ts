import { describe, expect, test } from 'bun:test';
import { FieldBuilder, type HopakPlugin, Router, crud, model, text } from '@hopak/core';
import * as v from 'valibot';
import { type TestServer, createTestServer } from '../src/test-server';

class UuidField extends FieldBuilder<string, false> {
  constructor() {
    super('testing-uuid');
  }
  required(): UuidField & { __required: true } {
    return this.markAs<UuidField & { __required: true }>(true);
  }
}

function uuidPlugin(): HopakPlugin {
  return {
    name: 'testing-uuid-plugin',
    setup(ctx) {
      ctx.registerField('testing-uuid', {
        storage: 'text',
        schema: () => v.pipe(v.string(), v.uuid()),
      });
      ctx.before((reqCtx) => {
        reqCtx.setHeader('X-Test-Plugin', 'on');
      });
    },
  };
}

describe('createTestServer({ plugins })', () => {
  test('a model using a plugin field type boots and validates', async () => {
    const device = model('device', {
      name: text().required(),
      externalId: new UuidField().required(),
    });

    const router = new Router();
    router.add('POST', '/devices', crud.create(device));
    router.add('GET', '/devices', crud.list(device));

    let env: TestServer | undefined;
    try {
      env = await createTestServer({ models: [device], router, plugins: [uuidPlugin()] });

      const ok = await env.client.post('/devices', {
        name: 'sensor',
        externalId: '7b9f8f64-1c5a-4b7e-9a10-b7c3c4d5e6f7',
      });
      expect(ok.status).toBe(201);

      const bad = await env.client.post('/devices', { name: 'sensor', externalId: 'nope' });
      expect(bad.status).toBe(400);

      const list = await env.client.get('/devices');
      expect(list.headers.get('x-test-plugin')).toBe('on');
    } finally {
      await env?.stop();
    }
  });
});
