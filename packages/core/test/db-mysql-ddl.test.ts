/**
 * MySQL DDL unit tests. Mirrors db-postgres-ddl.test.ts. Integration tests
 * against a real MySQL live in `db-mysql.test.ts` (gated on MYSQL_URL).
 */
import { describe, expect, test } from 'bun:test';
import { belongsTo, boolean, email, json, model, money, number, password, text } from '../src';
import { buildCreateTableSql } from '../src/db/mysql';

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

describe('MySQL — DDL generation', () => {
  test('id column is INT AUTO_INCREMENT PRIMARY KEY', () => {
    const sql = buildCreateTableSql(post);
    expect(sql).toContain('`id` INT AUTO_INCREMENT PRIMARY KEY');
  });

  test('identifiers are wrapped in backticks', () => {
    const sql = buildCreateTableSql(post);
    expect(sql).toContain('`title`');
    expect(sql).toContain('`published`');
  });

  test('text fields emit TEXT', () => {
    const sql = buildCreateTableSql(post);
    expect(sql).toContain('`title` TEXT NOT NULL');
    expect(sql).toContain('`content` TEXT NOT NULL');
  });

  test('boolean column uses TINYINT(1)', () => {
    const sql = buildCreateTableSql(post);
    expect(sql).toContain('`published` TINYINT(1)');
  });

  test('number column is INT', () => {
    const sql = buildCreateTableSql(post);
    expect(sql).toContain('`views` INT');
  });

  test('money column is DOUBLE', () => {
    const sql = buildCreateTableSql(post);
    expect(sql).toContain('`score` DOUBLE');
  });

  test('json column is JSON', () => {
    const sql = buildCreateTableSql(post);
    expect(sql).toContain('`metadata` JSON');
  });

  test('timestamps use DATETIME(3) with CURRENT_TIMESTAMP(3) default', () => {
    const sql = buildCreateTableSql(post);
    expect(sql).toContain('`created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)');
    expect(sql).toContain('`updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)');
  });

  test('timestamps:false omits created_at/updated_at', () => {
    const sql = buildCreateTableSql(user);
    expect(sql).not.toContain('created_at');
    expect(sql).not.toContain('updated_at');
  });

  test('unique on TEXT uses prefix length to survive MySQL key-size limit', () => {
    const sql = buildCreateTableSql(user);
    expect(sql).toContain('`email` TEXT NOT NULL');
    expect(sql).toContain('UNIQUE KEY `uk_users_email` (`email`(191))');
  });

  test('belongsTo column is INT with _id suffix', () => {
    const sql = buildCreateTableSql(comment);
    expect(sql).toContain('`author_id` INT NOT NULL');
  });

  test('belongsTo emits a named FOREIGN KEY constraint', () => {
    const sql = buildCreateTableSql(comment);
    expect(sql).toContain(
      'CONSTRAINT `fk_comments_author_id` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`)',
    );
  });

  test('table name is pluralized', () => {
    expect(buildCreateTableSql(post)).toContain('CREATE TABLE IF NOT EXISTS `posts`');
    expect(buildCreateTableSql(user)).toContain('CREATE TABLE IF NOT EXISTS `users`');
    expect(buildCreateTableSql(comment)).toContain('CREATE TABLE IF NOT EXISTS `comments`');
  });

  test('IF NOT EXISTS makes DDL idempotent', () => {
    expect(buildCreateTableSql(user)).toMatch(/^CREATE TABLE IF NOT EXISTS/);
  });
});
