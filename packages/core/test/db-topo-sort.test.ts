import { describe, expect, test } from 'bun:test';
import { orderByFkDependencies } from '../src/db/sql/ddl-emitter';
import { belongsTo, hasMany, text } from '../src/fields';
import { model } from '../src/model/define';

const user = model('user', { name: text().required() });
const post = model('post', { title: text().required(), author: belongsTo('user') });
const comment = model('comment', {
  body: text().required(),
  post: belongsTo('post'),
  author: belongsTo('user'),
});
const tag = model('tag', { name: text().required() });

describe('orderByFkDependencies', () => {
  test('puts belongsTo targets before dependents', () => {
    const ordered = orderByFkDependencies([comment, post, user]);
    const names = ordered.map((m) => m.name);
    expect(names.indexOf('user')).toBeLessThan(names.indexOf('post'));
    expect(names.indexOf('post')).toBeLessThan(names.indexOf('comment'));
    expect(names.indexOf('user')).toBeLessThan(names.indexOf('comment'));
  });

  test('scanner-default alphabetical order (comment, post, tag, user) is rewritten', () => {
    const ordered = orderByFkDependencies([tag, comment, user, post]);
    const names = ordered.map((m) => m.name);
    expect(names.indexOf('user')).toBeLessThan(names.indexOf('post'));
    expect(names.indexOf('post')).toBeLessThan(names.indexOf('comment'));
    expect(names).toContain('tag');
  });

  test('models without belongsTo keep a stable position', () => {
    const ordered = orderByFkDependencies([user, tag]);
    expect(ordered.map((m) => m.name)).toEqual(['user', 'tag']);
  });

  test('hasMany is virtual — does not add an ordering edge', () => {
    const userWithHasMany = model('user', {
      name: text().required(),
      posts: hasMany('post'),
    });
    const ordered = orderByFkDependencies([userWithHasMany, post]);
    expect(ordered.map((m) => m.name)).toEqual(['user', 'post']);
  });

  test('cycles do not hang — each model is emitted exactly once', () => {
    const a = model('a', { b: belongsTo('b') });
    const b = model('b', { a: belongsTo('a') });
    const ordered = orderByFkDependencies([a, b]);
    expect(ordered.map((m) => m.name).sort()).toEqual(['a', 'b']);
  });
});
