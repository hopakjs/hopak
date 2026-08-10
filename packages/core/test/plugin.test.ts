import { describe, expect, test } from 'bun:test';
import { PluginError } from '@hopak/common';
import { createLogger } from '@hopak/common';
import * as v from 'valibot';
import { defaultConfig } from '../src/app/config';
import { createSqliteDatabase } from '../src/db/sqlite';
import { FieldBuilder } from '../src/fields/base';
import { text } from '../src/fields/string';
import { model } from '../src/model/define';
import { type HopakPlugin, setupPlugins } from '../src/plugin';
import { buildModelSchema, validate } from '../src/validation';

const config = defaultConfig('/tmp/plugin-test');
const log = createLogger({ level: 'error' });

class UuidField extends FieldBuilder<string, false> {
  constructor() {
    super('uuid');
  }
  required(): UuidField & { __required: true } {
    return this.markAs<UuidField & { __required: true }>(true);
  }
}

const uuid = () => new UuidField();

function uuidPlugin(name = '@hopak/uuid'): HopakPlugin {
  return {
    name,
    setup(ctx) {
      ctx.registerField('uuid', {
        sqlite: { ddl: 'TEXT', column: null },
        postgres: { ddl: 'TEXT', column: null },
        mysql: { ddl: 'TEXT', column: null },
        schema: () => v.pipe(v.string(), v.uuid()),
      });
    },
  };
}

describe('plugin registry', () => {
  test('registered field type validates through buildModelSchema', async () => {
    await setupPlugins([uuidPlugin()], config, log);
    const device = model('device', {
      name: text().required(),
      externalId: uuid().required(),
    });
    const schema = buildModelSchema(device, { omitId: true });

    const ok = validate(schema, {
      name: 'sensor',
      externalId: '7b9f8f64-1c5a-4b7e-9a10-b7c3c4d5e6f7',
    });
    expect(ok.ok).toBe(true);

    const bad = validate(schema, { name: 'sensor', externalId: 'not-a-uuid' });
    expect(bad.ok).toBe(false);
  });

  test('same plugin re-registering on a second boot is a no-op', async () => {
    await setupPlugins([uuidPlugin()], config, log);
    await setupPlugins([uuidPlugin()], config, log);
  });

  test('different plugin claiming a taken type throws PluginError', async () => {
    await setupPlugins([uuidPlugin()], config, log);
    await expect(setupPlugins([uuidPlugin('@rival/uuid')], config, log)).rejects.toThrow(
      PluginError,
    );
  });

  test('claiming a built-in type throws PluginError', async () => {
    const evil: HopakPlugin = {
      name: '@rival/text',
      setup(ctx) {
        ctx.registerField('text', {
          sqlite: { ddl: 'TEXT', column: null },
          postgres: { ddl: 'TEXT', column: null },
          mysql: { ddl: 'TEXT', column: null },
          schema: () => v.string(),
        });
      },
    };
    await expect(setupPlugins([evil], config, log)).rejects.toThrow(/already registered/);
  });

  test('duplicate plugin names are idempotent, middleware and boot hooks accumulate', async () => {
    const calls: string[] = [];
    const plugin: HopakPlugin = {
      name: '@test/observer',
      setup(ctx) {
        ctx.before(() => {
          calls.push('before');
        });
        ctx.onBoot(() => {
          calls.push('boot');
        });
      },
    };
    const runtime = await setupPlugins([plugin, plugin], config, log);
    expect(runtime.middleware.before).toHaveLength(1);
    expect(runtime.bootHooks).toHaveLength(1);
    for (const hook of runtime.bootHooks) await hook();
    expect(calls).toEqual(['boot']);
  });

  test('plugin without a name throws', async () => {
    await expect(setupPlugins([{ name: '', setup() {} }], config, log)).rejects.toThrow(
      PluginError,
    );
  });
});

describe('model lifecycle hooks', () => {
  function makeUserModel(events: string[]) {
    return model(
      'user',
      {
        name: text().required(),
        password: text().required(),
      },
      {
        hooks: {
          async beforeCreate(data) {
            events.push('beforeCreate');
            return { ...data, password: `hashed:${data.password}` };
          },
          afterCreate(row) {
            events.push(`afterCreate:${row.name}`);
          },
          beforeUpdate(data) {
            events.push('beforeUpdate');
            return data.password ? { ...data, password: `hashed:${data.password}` } : data;
          },
          afterUpdate(row) {
            events.push(`afterUpdate:${row.name}`);
          },
          beforeDelete(id) {
            events.push(`beforeDelete:${id}`);
          },
          afterDelete(id) {
            events.push(`afterDelete:${id}`);
          },
        },
      },
    );
  }

  test('create/update/delete run hooks in order and apply transforms', async () => {
    const events: string[] = [];
    const user = makeUserModel(events);
    const db = createSqliteDatabase({ models: [user] });
    await db.sync();
    const users = db.model<{ id: number; name: string; password: string }>('user');

    const created = await users.create({ name: 'ada', password: 'pw' });
    expect(created.password).toBe('hashed:pw');

    const updated = await users.update(created.id, { name: 'ada2', password: 'pw2' });
    expect(updated.password).toBe('hashed:pw2');

    const removed = await users.delete(created.id);
    expect(removed).toBe(true);

    expect(events).toEqual([
      'beforeCreate',
      'afterCreate:ada',
      'beforeUpdate',
      'afterUpdate:ada2',
      `beforeDelete:${created.id}`,
      `afterDelete:${created.id}`,
    ]);
    await db.close();
  });

  test('afterDelete is skipped when nothing was deleted', async () => {
    const events: string[] = [];
    const user = makeUserModel(events);
    const db = createSqliteDatabase({ models: [user] });
    await db.sync();

    const removed = await db.model('user').delete(999);
    expect(removed).toBe(false);
    expect(events).toEqual(['beforeDelete:999']);
    await db.close();
  });

  test('models without hooks are returned unwrapped', async () => {
    const plain = model('plain', { name: text().required() });
    const db = createSqliteDatabase({ models: [plain] });
    await db.sync();
    const row = await db.model('plain').create({ name: 'x' });
    expect(row.name).toBe('x');
    await db.close();
  });
});
