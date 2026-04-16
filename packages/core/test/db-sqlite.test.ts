import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  type Database,
  belongsTo,
  boolean,
  buildCreateTableSql,
  createDatabase,
  email,
  model,
  number,
  password,
  text,
} from '../src';

let db: Database;

const post = model('post', {
  title: text().required().min(3).max(200),
  content: text().required(),
  published: boolean().default(false),
  views: number().default(0),
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

beforeEach(async () => {
  db = createDatabase({
    dialect: 'sqlite',
    models: [post, user, comment],
  });
  await db.sync();
});

afterEach(async () => {
  await db.close();
});

describe('SQLite — DDL generation', () => {
  test('buildCreateTableSql for post emits expected columns', () => {
    const sql = buildCreateTableSql(post);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "posts"');
    expect(sql).toContain('"title" TEXT NOT NULL');
    expect(sql).toContain('"published" INTEGER');
    expect(sql).toContain('"created_at" INTEGER NOT NULL');
  });

  test('belongsTo column name suffixed with _id', () => {
    const sql = buildCreateTableSql(comment);
    expect(sql).toContain('"author_id" INTEGER NOT NULL');
  });

  test('unique constraint emitted for email', () => {
    const sql = buildCreateTableSql(user);
    expect(sql).toContain('"email" TEXT NOT NULL UNIQUE');
  });

  test('timestamps:false omits created_at/updated_at', () => {
    const sql = buildCreateTableSql(user);
    expect(sql).not.toContain('created_at');
    expect(sql).not.toContain('updated_at');
  });
});

describe('SQLite — CRUD round-trip', () => {
  test('create + findOne returns the row', async () => {
    const posts = db.model('post');
    const created = await posts.create({
      title: 'Hello Hopak',
      content: 'It works!',
      published: true,
    });
    expect(created.id).toBeNumber();
    expect(created.title).toBe('Hello Hopak');

    const found = await posts.findOne(created.id as number);
    expect(found?.title).toBe('Hello Hopak');
    expect(found?.published).toBe(true);
  });

  test('findMany returns inserted rows', async () => {
    const posts = db.model('post');
    await posts.create({ title: 'one', content: 'first' });
    await posts.create({ title: 'two', content: 'second' });
    const all = await posts.findMany();
    expect(all).toHaveLength(2);
  });

  test('findMany with where filter', async () => {
    const posts = db.model('post');
    await posts.create({ title: 'pub', content: 'a', published: true });
    await posts.create({ title: 'draft', content: 'b', published: false });
    const published = await posts.findMany({ where: { published: true } });
    expect(published).toHaveLength(1);
    expect(published[0]?.title).toBe('pub');
  });

  test('findMany with limit/offset', async () => {
    const posts = db.model('post');
    for (let i = 0; i < 5; i++) {
      await posts.create({ title: `t${i}`, content: 'x' });
    }
    const page = await posts.findMany({ limit: 2, offset: 2 });
    expect(page).toHaveLength(2);
  });

  test('findMany with orderBy desc', async () => {
    const posts = db.model('post');
    await posts.create({ title: 'a', content: 'x' });
    await posts.create({ title: 'b', content: 'x' });
    const ordered = await posts.findMany({ orderBy: [{ field: 'title', direction: 'desc' }] });
    expect(ordered[0]?.title).toBe('b');
  });

  test('count works with and without where', async () => {
    const posts = db.model('post');
    await posts.create({ title: 'a', content: 'x', published: true });
    await posts.create({ title: 'b', content: 'x', published: false });
    expect(await posts.count()).toBe(2);
    expect(await posts.count({ where: { published: true } })).toBe(1);
  });

  test('update modifies and returns row', async () => {
    const posts = db.model('post');
    const created = await posts.create({ title: 'orig', content: 'x' });
    const updated = await posts.update(created.id as number, { title: 'changed' });
    expect(updated.title).toBe('changed');
  });

  test('delete returns true when row removed', async () => {
    const posts = db.model('post');
    const created = await posts.create({ title: 'gone', content: 'x' });
    const deleted = await posts.delete(created.id as number);
    expect(deleted).toBe(true);
    expect(await posts.findOne(created.id as number)).toBeNull();
  });

  test('delete returns false for missing id', async () => {
    const posts = db.model('post');
    expect(await posts.delete(9999)).toBe(false);
  });

  test('findOrFail throws NotFound when missing', async () => {
    const posts = db.model('post');
    expect(posts.findOrFail(9999)).rejects.toThrow(/not found/);
  });

  test('unique constraint enforced', async () => {
    const users = db.model('user');
    await users.create({ name: 'A', email: 'a@a.com', password: 'secret123' });
    expect(users.create({ name: 'B', email: 'a@a.com', password: 'secret456' })).rejects.toThrow();
  });

  test('unknown model throws', () => {
    expect(() => db.model('nonexistent')).toThrow(/not registered/);
  });
});

describe('SQLite — dialect dispatch', () => {
  test('postgres throws not implemented error', () => {
    expect(() =>
      createDatabase({ dialect: 'postgres', models: [post], url: 'postgres://x' }),
    ).toThrow(/not yet implemented/);
  });

  test('mysql throws not implemented error', () => {
    expect(() => createDatabase({ dialect: 'mysql', models: [post] })).toThrow(
      /not yet implemented/,
    );
  });
});
