import { describe, expect, test } from 'bun:test';
import {
  type InferFieldValue,
  belongsTo,
  date,
  enumOf,
  file,
  hasMany,
  hasOne,
  image,
  json,
  password,
  secret,
  timestamp,
  token,
} from '../src';

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
  ? true
  : false;
type Expect<T extends true> = T;

describe('date / timestamp', () => {
  test('date().required() infers Date', () => {
    const f = date().required();
    type V = InferFieldValue<typeof f>;
    type _ = Expect<Equal<V, Date>>;
    expect(f.build().type).toBe('date');
    expect(f.build().required).toBe(true);
  });

  test('timestamp().default("now") works', () => {
    const f = timestamp().default('now');
    expect(f.build().type).toBe('timestamp');
    expect(f.build().default).toBe('now');
  });

  test('timestamp().onUpdate("now") sets default marker', () => {
    const f = timestamp().onUpdate('now');
    expect(f.build().default).toBe('now');
  });
});

describe('enumOf', () => {
  test('infers literal union from values', () => {
    const f = enumOf('user', 'admin').required();
    type V = InferFieldValue<typeof f>;
    type _ = Expect<Equal<V, 'user' | 'admin'>>;
    expect(f.build().enumValues).toEqual(['user', 'admin']);
  });

  test('default accepts only enum values', () => {
    const f = enumOf('a', 'b', 'c').default('b');
    expect(f.build().default).toBe('b');
  });
});

describe('json', () => {
  test('infers default JsonValue when no generic', () => {
    const f = json().required();
    const def = f.build();
    expect(def.type).toBe('json');
    expect(def.required).toBe(true);
  });

  test('infers user-provided shape', () => {
    interface Address {
      city: string;
      zip: string;
    }
    const f = json<Address>().required();
    type V = InferFieldValue<typeof f>;
    type _ = Expect<Equal<V, Address>>;
  });
});

describe('relations', () => {
  test('belongsTo infers number FK', () => {
    const f = belongsTo('user').required();
    type V = InferFieldValue<typeof f>;
    type _ = Expect<Equal<V, number>>;
    expect(f.build().type).toBe('belongsTo');
    expect(f.build().relationTarget).toBe('user');
  });

  test('hasMany infers number[]', () => {
    const f = hasMany('post').required();
    type V = InferFieldValue<typeof f>;
    type _ = Expect<Equal<V, number[]>>;
    expect(f.build().type).toBe('hasMany');
  });

  test('hasOne infers number', () => {
    const f = hasOne('profile').required();
    type V = InferFieldValue<typeof f>;
    type _ = Expect<Equal<V, number>>;
    expect(f.build().type).toBe('hasOne');
  });
});

describe('secret family', () => {
  test('password sets excludeFromJson', () => {
    const f = password().required().min(8);
    const def = f.build();
    expect(def.type).toBe('password');
    expect(def.excludeFromJson).toBe(true);
    expect(def.min).toBe(8);
  });

  test('secret sets excludeFromJson', () => {
    expect(secret().build().excludeFromJson).toBe(true);
  });

  test('token sets excludeFromJson', () => {
    expect(token().build().excludeFromJson).toBe(true);
  });
});

describe('file / image', () => {
  test('file().maxSize parses MB', () => {
    const f = file().maxSize('5MB');
    expect(f.build().max).toBe(5 * 1024 * 1024);
  });

  test('image() type is image', () => {
    expect(image().build().type).toBe('image');
  });

  test('numeric maxSize works', () => {
    expect(file().maxSize(1024).build().max).toBe(1024);
  });

  test('throws on invalid size', () => {
    expect(() => file().maxSize('5XB')).toThrow(/Invalid file size/);
  });
});
