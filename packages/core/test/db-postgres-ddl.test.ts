/**
 * Postgres DDL unit tests. No live database required — we only assert the
 * shape of the SQL string emitted by `buildCreateTableSql`. Integration
 * tests against a real Postgres live in `db-postgres.test.ts` (gated on
 * POSTGRES_URL).
 */
import { describe, expect, test } from 'bun:test';
import { belongsTo, boolean, email, json, model, money, number, password, text } from '../src';
import { buildCreateTableSql } from '../src/db/postgres';

const post = model('post', {
  title: text().required().min(3).max(200),
  content: text().required(),
  published: boolean().default(false),
  views: number().default(0),
  score: money(),
  metadata: json(),
});

const user = model(
  'user',
  {
    name: text().required(),
    email: email().required().unique(),
    password: password().required(),
  },
  { timestamps: false },
);

const comment = model('comment', {
  body: text().required(),
  author: belongsTo('user').required(),
});

describe('Postgres — DDL generation', () => {
  test('id column is SERIAL PRIMARY KEY', () => {
    const sql = buildCreateTableSql(post);
    expect(sql).toContain('"id" SERIAL PRIMARY KEY');
  });

  test('text fields emit TEXT', () => {
    const sql = buildCreateTableSql(post);
    expect(sql).toContain('"title" TEXT NOT NULL');
    expect(sql).toContain('"content" TEXT NOT NULL');
  });

  test('boolean column uses native BOOLEAN', () => {
    const sql = buildCreateTableSql(post);
    expect(sql).toContain('"published" BOOLEAN');
  });

  test('number column is INTEGER', () => {
    const sql = buildCreateTableSql(post);
    expect(sql).toContain('"views" INTEGER');
  });

  test('money column is DOUBLE PRECISION', () => {
    const sql = buildCreateTableSql(post);
    expect(sql).toContain('"score" DOUBLE PRECISION');
  });

  test('json column is JSONB', () => {
    const sql = buildCreateTableSql(post);
    expect(sql).toContain('"metadata" JSONB');
  });

  test('timestamps produce TIMESTAMPTZ with default now()', () => {
    const sql = buildCreateTableSql(post);
    expect(sql).toContain('"created_at" TIMESTAMPTZ NOT NULL DEFAULT now()');
    expect(sql).toContain('"updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()');
  });

  test('timestamps:false omits created_at/updated_at', () => {
    const sql = buildCreateTableSql(user);
    expect(sql).not.toContain('created_at');
    expect(sql).not.toContain('updated_at');
  });

  test('unique constraint emitted inline', () => {
    const sql = buildCreateTableSql(user);
    expect(sql).toContain('"email" TEXT NOT NULL UNIQUE');
  });

  test('belongsTo column is INTEGER with _id suffix', () => {
    const sql = buildCreateTableSql(comment);
    expect(sql).toContain('"author_id" INTEGER NOT NULL');
  });

  test('belongsTo emits a FOREIGN KEY constraint', () => {
    const sql = buildCreateTableSql(comment);
    expect(sql).toContain(
      'CONSTRAINT "fk_comments_author_id" FOREIGN KEY ("author_id") REFERENCES "users"("id")',
    );
  });

  test('table name is pluralized', () => {
    expect(buildCreateTableSql(post)).toContain('CREATE TABLE IF NOT EXISTS "posts"');
    expect(buildCreateTableSql(user)).toContain('CREATE TABLE IF NOT EXISTS "users"');
    expect(buildCreateTableSql(comment)).toContain('CREATE TABLE IF NOT EXISTS "comments"');
  });

  test('IF NOT EXISTS makes DDL idempotent', () => {
    expect(buildCreateTableSql(user)).toMatch(/^CREATE TABLE IF NOT EXISTS/);
  });
});
