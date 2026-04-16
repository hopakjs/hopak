import { describe, expect, test } from 'bun:test';
import { Router, defineRoute, parsePattern } from '../src';

describe('parsePattern', () => {
  test('parses static segments', () => {
    expect(parsePattern('/posts')).toEqual([{ kind: 'static', value: 'posts' }]);
  });

  test('parses bracket params', () => {
    expect(parsePattern('/posts/[id]')).toEqual([
      { kind: 'static', value: 'posts' },
      { kind: 'param', name: 'id' },
    ]);
  });

  test('parses colon params', () => {
    expect(parsePattern('/posts/:id')).toEqual([
      { kind: 'static', value: 'posts' },
      { kind: 'param', name: 'id' },
    ]);
  });

  test('parses wildcard', () => {
    expect(parsePattern('/files/[...path]')).toEqual([
      { kind: 'static', value: 'files' },
      { kind: 'wildcard', name: 'path' },
    ]);
  });

  test('handles root', () => {
    expect(parsePattern('/')).toEqual([]);
  });
});

describe('Router.match', () => {
  const handler = defineRoute({ handler: () => null });

  test('matches static path', () => {
    const r = new Router();
    r.add('GET', '/health', handler);
    const m = r.match('GET', '/health');
    expect(m).not.toBeNull();
    expect(m?.params).toEqual({});
  });

  test('matches dynamic param', () => {
    const r = new Router();
    r.add('GET', '/posts/[id]', handler);
    const m = r.match('GET', '/posts/42');
    expect(m?.params.id).toBe('42');
  });

  test('matches multiple params', () => {
    const r = new Router();
    r.add('GET', '/users/[uid]/posts/[pid]', handler);
    const m = r.match('GET', '/users/1/posts/2');
    expect(m?.params).toEqual({ uid: '1', pid: '2' });
  });

  test('catch-all wildcard', () => {
    const r = new Router();
    r.add('GET', '/files/[...path]', handler);
    const m = r.match('GET', '/files/a/b/c');
    expect(m?.params.path).toBe('a/b/c');
  });

  test('static beats dynamic on equal length', () => {
    const r = new Router();
    r.add('GET', '/posts/[id]', defineRoute({ handler: () => 'dynamic' }));
    r.add('GET', '/posts/new', defineRoute({ handler: () => 'static' }));
    const m = r.match('GET', '/posts/new');
    expect(m?.route.pattern).toBe('/posts/new');
  });

  test('method mismatch returns null', () => {
    const r = new Router();
    r.add('GET', '/posts', handler);
    expect(r.match('POST', '/posts')).toBeNull();
  });

  test('decodes URI components in params', () => {
    const r = new Router();
    r.add('GET', '/users/[name]', handler);
    const m = r.match('GET', '/users/john%20doe');
    expect(m?.params.name).toBe('john doe');
  });

  test('returns null for non-matching path', () => {
    const r = new Router();
    r.add('GET', '/posts/[id]', handler);
    expect(r.match('GET', '/users/1')).toBeNull();
  });
});
