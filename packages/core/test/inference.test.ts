import { describe, expect, test } from 'bun:test';
import {
  type InferFieldValue,
  type InferRow,
  ModelRegistry,
  boolean,
  email,
  model,
  number,
  text,
} from '../src';

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
  ? true
  : false;
type Expect<T extends true> = T;

describe('field builders', () => {
  test('text() returns optional by default', () => {
    const f = text();
    type V = InferFieldValue<typeof f>;
    type _ = Expect<Equal<V, string | undefined>>;
    expect(f.build().required).toBe(false);
    expect(f.build().type).toBe('text');
  });

  test('text().required() returns required string', () => {
    const f = text().required();
    type V = InferFieldValue<typeof f>;
    type _ = Expect<Equal<V, string>>;
    expect(f.build().required).toBe(true);
  });

  test('text().required().optional() returns optional string', () => {
    const f = text().required().optional();
    type V = InferFieldValue<typeof f>;
    type _ = Expect<Equal<V, string | undefined>>;
    expect(f.build().required).toBe(false);
  });

  test('text() chains all modifiers', () => {
    const f = text()
      .required()
      .min(3)
      .max(100)
      .unique()
      .pattern(/^[a-z]+$/);
    const def = f.build();
    expect(def.required).toBe(true);
    expect(def.min).toBe(3);
    expect(def.max).toBe(100);
    expect(def.unique).toBe(true);
    expect(def.pattern).toBe('^[a-z]+$');
  });

  test('email() has type email', () => {
    expect(email().build().type).toBe('email');
  });

  test('number().required() returns required number', () => {
    const f = number().required().min(0).max(100);
    type V = InferFieldValue<typeof f>;
    type _ = Expect<Equal<V, number>>;
    const def = f.build();
    expect(def.required).toBe(true);
    expect(def.min).toBe(0);
  });

  test('boolean().default(true) sets default', () => {
    const f = boolean().default(true);
    expect(f.build().default).toBe(true);
  });
});

describe('model() inference', () => {
  test('preserves field types in row inference', () => {
    const post = model('post', {
      title: text().required().min(3),
      description: text().optional(),
      views: number().required(),
      published: boolean().default(false),
    });

    type Row = InferRow<typeof post>;
    type Expected = {
      title: string;
      description: string | undefined;
      views: number;
      published: boolean | undefined;
    };
    type _ = Expect<Equal<Row, Expected>>;

    const row: Row = {
      title: 'Hello',
      description: undefined,
      views: 42,
      published: true,
    };
    expect(row.title).toBe('Hello');
  });

  test('builds correct field definitions', () => {
    const user = model('user', {
      name: text().required(),
      email: email().required().unique(),
    });
    expect(user.name).toBe('user');
    expect(user.fields.name?.type).toBe('text');
    expect(user.fields.name?.required).toBe(true);
    expect(user.fields.email?.unique).toBe(true);
  });

  test('default options are applied', () => {
    const m = model('test', { name: text() });
    expect(m.options.timestamps).toBe(true);
    expect(m.options.crud).toBe(false);
  });

  test('user-provided options override defaults', () => {
    const m = model('test', { name: text() }, { crud: true, owner: 'name' });
    expect(m.options.crud).toBe(true);
    expect(m.options.owner).toBe('name');
    expect(m.options.timestamps).toBe(true);
  });
});

describe('ModelRegistry', () => {
  test('registers and retrieves models', () => {
    const reg = new ModelRegistry();
    const post = model('post', { title: text().required() });
    reg.register(post);
    expect(reg.has('post')).toBe(true);
    expect(reg.get('post')).toBe(post);
    expect(reg.size).toBe(1);
  });

  test('throws on duplicate registration', () => {
    const reg = new ModelRegistry();
    reg.register(model('post', { title: text() }));
    expect(() => reg.register(model('post', { title: text() }))).toThrow(/already registered/);
  });

  test('clear() empties registry', () => {
    const reg = new ModelRegistry();
    reg.register(model('post', { title: text() }));
    reg.clear();
    expect(reg.size).toBe(0);
  });

  test('all() returns all registered models', () => {
    const reg = new ModelRegistry();
    reg.register(model('post', { title: text() }));
    reg.register(model('user', { name: text() }));
    expect(reg.all()).toHaveLength(2);
  });

  test('isolated instances do not share state', () => {
    const a = new ModelRegistry();
    const b = new ModelRegistry();
    a.register(model('post', { title: text() }));
    expect(a.size).toBe(1);
    expect(b.size).toBe(0);
  });
});
