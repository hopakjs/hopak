/**
 * Unit tests for `.index()` emission. The same input model is run through
 * each dialect's builder to assert the same index set is produced, quoted
 * for the dialect's identifier style.
 */
import { describe, expect, test } from 'bun:test';
import { belongsTo, email, hasMany, model, number, text } from '../src';
import { ops as mysqlOps } from '../src/db/mysql/sync';
import { ops as postgresOps } from '../src/db/postgres/sync';
import { buildIndexStatements } from '../src/db/sql/ddl-emitter';
import { ops as sqliteOps } from '../src/db/sqlite/sync';

const post = model('post', {
  title: text().required(),
  authorId: number().required().index(),
  slug: text().unique().index(),
  popularity: number().index(),
  email: email().required(),
  comments: hasMany('comment'),
});

const comment = model('comment', {
  body: text().required(),
  post: belongsTo('post').required().index(),
});

describe('buildIndexStatements — cross-dialect', () => {
  test('emits one CREATE INDEX per `.index()` field, skipping unique', () => {
    const out = buildIndexStatements(post, sqliteOps);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('"idx_posts_authorId"');
    expect(out[0]).toContain('ON "posts"');
    expect(out[1]).toContain('"idx_posts_popularity"');
  });

  test('unique fields skip explicit index (unique creates an implicit one)', () => {
    const stmts = buildIndexStatements(post, sqliteOps).join('\n');
    expect(stmts).not.toContain('idx_posts_slug');
  });

  test('virtual relations (hasMany/hasOne) never produce an index', () => {
    const stmts = buildIndexStatements(post, sqliteOps).join('\n');
    expect(stmts).not.toContain('idx_posts_comments');
  });

  test('belongsTo column name keeps `_id` suffix in the index name', () => {
    const out = buildIndexStatements(comment, sqliteOps);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('idx_comments_post_id');
    expect(out[0]).toContain('("post_id")');
  });

  test('every dialect uses its own identifier quoting', () => {
    const [sqlite] = buildIndexStatements(post, sqliteOps);
    const [pg] = buildIndexStatements(post, postgresOps);
    const [mysql] = buildIndexStatements(post, mysqlOps);
    expect(sqlite).toContain('"idx_posts_authorId"');
    expect(pg).toContain('"idx_posts_authorId"');
    expect(mysql).toContain('`idx_posts_authorId`');
  });

  test('all three dialects emit CREATE INDEX IF NOT EXISTS', () => {
    for (const ops of [sqliteOps, postgresOps, mysqlOps]) {
      const stmts = buildIndexStatements(post, ops);
      expect(stmts.every((s) => s.startsWith('CREATE INDEX IF NOT EXISTS'))).toBe(true);
    }
  });

  test('model without any `.index()` fields produces no statements', () => {
    const bare = model('bare', { name: text().required() });
    for (const ops of [sqliteOps, postgresOps, mysqlOps]) {
      expect(buildIndexStatements(bare, ops)).toHaveLength(0);
    }
  });
});
