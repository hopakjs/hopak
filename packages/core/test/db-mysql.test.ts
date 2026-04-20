/**
 * Integration tests for the MySQL dialect. Gated on `MYSQL_URL` — the whole
 * file is a no-op when the env var is unset so local devs without a running
 * MySQL still get a green test run. CI sets the URL via a MySQL service
 * container.
 *
 * Structure mirrors `db-postgres.test.ts` so regressions show up on both
 * dialects. Differences worth noting:
 *   - No RETURNING clause; create/update go through a 2-step round-trip,
 *     which this suite exercises via the same public API.
 *   - `ilike` is emitted as LIKE — MySQL's default collation is already
 *     case-insensitive, so the behavior matches Postgres ILIKE.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getMysqlUrl, resetMysql } from '@hopak/testing';
import {
  type Database,
  belongsTo,
  boolean,
  createDatabase,
  email,
  hasMany,
  hasOne,
  model,
  number,
  password,
  text,
} from '../src';

const MYSQL_URL = getMysqlUrl();
const describeIfMysql = MYSQL_URL ? describe : describe.skip;

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

const author = model('author', {
  name: text().required(),
  email: email().required().unique(),
  posts: hasMany('article'),
  profile: hasOne('profile'),
});
const article = model('article', {
  title: text().required(),
  authorRef: belongsTo('author'),
  published: boolean().default(false),
});
const profile = model('profile', {
  bio: text().required(),
  ownerRef: belongsTo('author'),
});

const CRUD_TABLES = ['comments', 'posts', 'users'] as const;
const INCLUDE_TABLES = ['profiles', 'articles', 'authors'] as const;

describeIfMysql('MySQL — CRUD round-trip (live)', () => {
  let db: Database;

  beforeEach(async () => {
    await resetMysql(MYSQL_URL as string, CRUD_TABLES);
    db = createDatabase({
      dialect: 'mysql',
      url: MYSQL_URL,
      models: [post, user, comment],
    });
    await db.sync();
  });
  afterEach(async () => {
    await db.close();
  });

  test('create + findOne — full row returned via follow-up SELECT', async () => {
    const posts = db.model('post');
    const created = await posts.create({ title: 'Hello', content: 'World', published: true });
    expect(typeof created.id).toBe('number');
    expect(created.title).toBe('Hello');
    const found = await posts.findOne(created.id as number);
    expect(found?.title).toBe('Hello');
  });

  test('unique constraint surfaces', async () => {
    const users = db.model('user');
    await users.create({ name: 'A', email: 'a@a.com', password: 'secret12' });
    await expect(
      users.create({ name: 'B', email: 'a@a.com', password: 'secret12' }),
    ).rejects.toThrow();
  });

  test('findMany with where / orderBy / limit / offset', async () => {
    const posts = db.model('post');
    for (let i = 0; i < 5; i++) {
      await posts.create({ title: `t${i}`, content: 'x', views: i * 10 });
    }
    const page = await posts.findMany({
      where: { views: { gte: 20 } },
      orderBy: [{ field: 'views', direction: 'desc' }],
      limit: 2,
    });
    expect(page.map((r) => r.views)).toEqual([40, 30]);
  });

  test('update returns the fresh row (2-step fetch)', async () => {
    const posts = db.model('post');
    const created = await posts.create({ title: 'orig', content: 'x' });
    const updated = await posts.update(created.id as number, { title: 'changed' });
    expect(updated.title).toBe('changed');
  });

  test('delete returns boolean via affectedRows', async () => {
    const posts = db.model('post');
    const created = await posts.create({ title: 'gone', content: 'x' });
    expect(await posts.delete(created.id as number)).toBe(true);
    expect(await posts.delete(9999)).toBe(false);
  });

  test('count with filter', async () => {
    const posts = db.model('post');
    await posts.create({ title: 'a', content: 'x', published: true });
    await posts.create({ title: 'b', content: 'x', published: false });
    expect(await posts.count({ where: { published: true } })).toBe(1);
  });
});

describeIfMysql('MySQL — filter operators (live)', () => {
  let db: Database;

  beforeEach(async () => {
    await resetMysql(MYSQL_URL as string, CRUD_TABLES);
    db = createDatabase({
      dialect: 'mysql',
      url: MYSQL_URL,
      models: [post, user, comment],
    });
    await db.sync();
  });
  afterEach(async () => {
    await db.close();
  });

  test('gt / lte / between on numeric column', async () => {
    const posts = db.model('post');
    for (let i = 1; i <= 5; i++) {
      await posts.create({ title: `p${i}`, content: 'x', views: i * 10 });
    }
    expect((await posts.findMany({ where: { views: { gt: 30 } } })).length).toBe(2);
    expect((await posts.findMany({ where: { views: { lte: 20 } } })).length).toBe(2);
    expect((await posts.findMany({ where: { views: { between: [20, 40] } } })).length).toBe(3);
  });

  test('ilike works (LIKE with MySQL default case-insensitive collation)', async () => {
    const posts = db.model('post');
    await posts.create({ title: 'Hello World', content: 'x' });
    await posts.create({ title: 'hello there', content: 'x' });
    await posts.create({ title: 'goodbye', content: 'x' });
    const found = await posts.findMany({ where: { title: { ilike: '%hello%' } } });
    expect(found.length).toBe(2);
  });

  test('contains with special char is escaped via ESCAPE clause', async () => {
    const posts = db.model('post');
    await posts.create({ title: '100% cotton', content: 'x' });
    await posts.create({ title: '100 grams', content: 'x' });
    const found = await posts.findMany({ where: { title: { contains: '%' } } });
    expect(found.map((r) => r.title)).toEqual(['100% cotton']);
  });

  test('OR combines branches', async () => {
    const posts = db.model('post');
    await posts.create({ title: 'a', content: 'x', views: 100 });
    await posts.create({ title: 'b', content: 'x', views: 0 });
    await posts.create({ title: 'c', content: 'x', views: 0 });
    const found = await posts.findMany({
      where: { OR: [{ views: { gte: 50 } }, { title: 'c' }] },
    });
    expect(found.map((r) => r.title).sort()).toEqual(['a', 'c']);
  });
});

describeIfMysql('MySQL — batch + aggregate (live)', () => {
  let db: Database;

  beforeEach(async () => {
    await resetMysql(MYSQL_URL as string, CRUD_TABLES);
    db = createDatabase({
      dialect: 'mysql',
      url: MYSQL_URL,
      models: [post, user, comment],
    });
    await db.sync();
  });
  afterEach(async () => {
    await db.close();
  });

  test('createMany returns affectedRows as count', async () => {
    const posts = db.model('post');
    const result = await posts.createMany([
      { title: 'a', content: 'x' },
      { title: 'b', content: 'x' },
      { title: 'c', content: 'x' },
    ]);
    expect(result.count).toBe(3);
  });

  test('updateMany / deleteMany report counts via affectedRows', async () => {
    const posts = db.model('post');
    await posts.create({ title: 'a', content: 'x' });
    await posts.create({ title: 'b', content: 'x' });
    await posts.create({ title: 'c', content: 'x' });

    const updated = await posts.updateMany({
      where: { title: { in: ['a', 'b'] } },
      data: { published: true },
    });
    expect(updated.count).toBe(2);

    const deleted = await posts.deleteMany({ where: { title: 'c' } });
    expect(deleted.count).toBe(1);
  });

  test('upsert via ON DUPLICATE KEY UPDATE + follow-up SELECT', async () => {
    const users = db.model('user');
    await users.upsert({
      where: { email: 'a@a.com' },
      create: { name: 'A', password: 'secret12' },
      update: { name: 'unused' },
    });
    const row = await users.upsert({
      where: { email: 'a@a.com' },
      create: { name: 'unused2', password: 'secret12' },
      update: { name: 'A2' },
    });
    expect(row.name).toBe('A2');
    expect(await users.count()).toBe(1);
  });

  test('aggregate sum / avg / count', async () => {
    const posts = db.model('post');
    for (let i = 1; i <= 4; i++) {
      await posts.create({ title: `t${i}`, content: 'x', views: i * 10 });
    }
    const result = await posts.aggregate({
      sum: ['views'],
      avg: ['views'],
      count: '_all',
    });
    expect(result.sum?.views).toBe(100);
    // MySQL returns DECIMAL for AVG — our unpack coerces to Number
    expect(result.avg?.views).toBe(25);
    expect(result.count?._all).toBe(4);
  });
});

describeIfMysql('MySQL — transactions (live)', () => {
  let db: Database;

  beforeEach(async () => {
    await resetMysql(MYSQL_URL as string, CRUD_TABLES);
    db = createDatabase({
      dialect: 'mysql',
      url: MYSQL_URL,
      models: [post, user, comment],
    });
    await db.sync();
  });
  afterEach(async () => {
    await db.close();
  });

  test('commits on resolve', async () => {
    await db.transaction(async (tx) => {
      await tx.model('post').create({ title: 'a', content: 'x' });
      await tx.model('post').create({ title: 'b', content: 'x' });
    });
    expect(await db.model('post').count()).toBe(2);
  });

  test('rolls back on throw', async () => {
    await db.model('post').create({ title: 'initial', content: 'x' });
    await expect(
      db.transaction(async (tx) => {
        await tx.model('post').create({ title: 'rolledback', content: 'x' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.model('post').count()).toBe(1);
  });
});

describeIfMysql('MySQL — include (live)', () => {
  let db: Database;

  beforeEach(async () => {
    await resetMysql(MYSQL_URL as string, INCLUDE_TABLES);
    db = createDatabase({
      dialect: 'mysql',
      url: MYSQL_URL,
      models: [author, article, profile],
    });
    await db.sync();
  });
  afterEach(async () => {
    await db.close();
  });

  test('belongsTo resolves through a single IN query', async () => {
    const authors = db.model('author');
    const articles = db.model('article');
    const alice = await authors.create({ name: 'Alice', email: 'a@a.com' });
    const bob = await authors.create({ name: 'Bob', email: 'b@b.com' });
    await articles.create({ title: 'A1', authorRef: alice.id });
    await articles.create({ title: 'B1', authorRef: bob.id });

    const rows = await articles.findMany({
      include: { authorRef: true },
      orderBy: [{ field: 'id', direction: 'asc' }],
    });
    expect(rows).toHaveLength(2);
    expect((rows[0]?.authorRef as { name: string }).name).toBe('Alice');
  });

  test('hasMany groups children per parent', async () => {
    const authors = db.model('author');
    const articles = db.model('article');
    const a = await authors.create({ name: 'A', email: 'a@a.com' });
    await authors.create({ name: 'NoPosts', email: 'n@n.com' });
    await articles.create({ title: 'x', authorRef: a.id });
    await articles.create({ title: 'y', authorRef: a.id });

    const rows = await authors.findMany({
      include: { posts: true },
      orderBy: [{ field: 'id', direction: 'asc' }],
    });
    expect((rows[0]?.posts as unknown[]).length).toBe(2);
    expect((rows[1]?.posts as unknown[]).length).toBe(0);
  });
});
