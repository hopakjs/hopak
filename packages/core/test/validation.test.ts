import { describe, expect, test } from 'bun:test';
import {
  belongsTo,
  boolean,
  buildModelSchema,
  date,
  email,
  enumOf,
  model,
  number,
  password,
  serializeForResponse,
  text,
  validate,
} from '../src';

describe('buildModelSchema', () => {
  test('required text accepts string and rejects missing', () => {
    const m = model('post', { title: text().required() });
    const schema = buildModelSchema(m, { omitId: true });
    expect(validate(schema, { title: 'hi' }).ok).toBe(true);
    expect(validate(schema, {}).ok).toBe(false);
  });

  test('optional text accepts undefined', () => {
    const m = model('post', { title: text().optional() });
    const schema = buildModelSchema(m, { omitId: true });
    expect(validate(schema, {}).ok).toBe(true);
  });

  test('text min/max enforced', () => {
    const m = model('post', { title: text().required().min(3).max(10) });
    const schema = buildModelSchema(m, { omitId: true });
    expect(validate(schema, { title: 'ab' }).ok).toBe(false);
    expect(validate(schema, { title: 'abcdefghijk' }).ok).toBe(false);
    expect(validate(schema, { title: 'abcd' }).ok).toBe(true);
  });

  test('email format enforced', () => {
    const m = model('user', { email: email().required() });
    const schema = buildModelSchema(m, { omitId: true });
    expect(validate(schema, { email: 'not-an-email' }).ok).toBe(false);
    expect(validate(schema, { email: 'a@b.com' }).ok).toBe(true);
  });

  test('enum constrains values', () => {
    const m = model('user', { role: enumOf('admin', 'user').required() });
    const schema = buildModelSchema(m, { omitId: true });
    expect(validate(schema, { role: 'admin' }).ok).toBe(true);
    expect(validate(schema, { role: 'guest' }).ok).toBe(false);
  });

  test('belongsTo accepts number or string id', () => {
    const m = model('comment', { author: belongsTo('user').required() });
    const schema = buildModelSchema(m, { omitId: true });
    expect(validate(schema, { author: 1 }).ok).toBe(true);
    expect(validate(schema, { author: 'uuid-x' }).ok).toBe(true);
    expect(validate(schema, { author: true }).ok).toBe(false);
  });

  test('partial mode makes all fields optional', () => {
    const m = model('post', {
      title: text().required(),
      content: text().required(),
    });
    const schema = buildModelSchema(m, { omitId: true, partial: true });
    expect(validate(schema, {}).ok).toBe(true);
    expect(validate(schema, { title: 'just-title' }).ok).toBe(true);
  });

  test('returns flattened error map on failure', () => {
    const m = model('user', {
      name: text().required().min(2),
      email: email().required(),
    });
    const schema = buildModelSchema(m, { omitId: true });
    const result = validate(schema, { name: 'a', email: 'bad' });
    if (result.ok) throw new Error('expected failure');
    expect(Object.keys(result.errors)).toContain('name');
    expect(Object.keys(result.errors)).toContain('email');
  });
});

describe('serializeForResponse', () => {
  test('strips password fields', () => {
    const m = model('user', {
      name: text().required(),
      password: password().required(),
    });
    const out = serializeForResponse(
      { id: 1, name: 'wince', password: 'hashed', extra: 'x' } as Record<string, unknown>,
      m,
    );
    expect(out.name).toBe('wince');
    expect(out.password).toBeUndefined();
    expect(out.id).toBe(1);
  });

  test('returns same object when nothing excluded', () => {
    const m = model('post', { title: text().required(), views: number() });
    const value = { title: 'hi', views: 1 };
    expect(serializeForResponse(value, m)).toEqual(value);
  });

  test('strips secret and token fields too', () => {
    const m = model('account', {
      apiKey: text().required(),
    });
    const out = serializeForResponse({ apiKey: 'visible' }, m);
    expect(out.apiKey).toBe('visible');
  });
});

describe('boolean validation passes through', () => {
  test('boolean field validated', () => {
    const m = model('post', { published: boolean().required() });
    const schema = buildModelSchema(m, { omitId: true });
    expect(validate(schema, { published: true }).ok).toBe(true);
    expect(validate(schema, { published: 'yes' }).ok).toBe(false);
  });
});

describe('date field', () => {
  test('accepts ISO string', () => {
    const m = model('post', { publishedAt: date().required() });
    const schema = buildModelSchema(m, { omitId: true });
    const result = validate<{ publishedAt: Date }>(schema, { publishedAt: '2026-01-15T10:00:00Z' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.publishedAt).toBeInstanceOf(Date);
    }
  });

  test('rejects invalid date string with clear message', () => {
    const m = model('post', { publishedAt: date().required() });
    const schema = buildModelSchema(m, { omitId: true });
    const result = validate(schema, { publishedAt: 'not-a-date' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.publishedAt?.[0]).toBe('Invalid date');
    }
  });
});
