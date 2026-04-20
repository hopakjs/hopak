/**
 * Integration tests for the Postgres dialect. Gated on `POSTGRES_URL` — the
 * whole file is a no-op when the env var is unset so local devs without a
 * running Postgres still get a green test run. CI sets the URL via a
 * postgres service container.
 *
 * Each top-level describe drops its own tables in `beforeEach` so concurrent
 * developers sharing a database (or a previous failed run) don't interfere.
 * We stick to this database-scoped reset rather than a nuclear
 * `DROP SCHEMA public CASCADE` because the user's Postgres may host other
 * apps in the same instance.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getPostgresUrl, resetPostgres } from '@hopak/testing';
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

const POSTGRES_URL = getPostgresUrl();
const describeIfPostgres = POSTGRES_URL ? describe : describe.skip;

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

describeIfPostgres('Postgres — CRUD round-trip (live)', () => {
  let db: Database;

  beforeEach(async () => {
    // Drop children before parents — the CASCADE option handles the rest.
    await resetPostgres(POSTGRES_URL as string, CRUD_TABLES);
    db = createDatabase({
      dialect: 'postgres',
      url: POSTGRES_URL,
      models: [post, user, comment],
    });
    await db.sync();
  });
  afterEach(async () => {
    await db.close();
  });

  test('create + findOne', async () => {
    const posts = db.model('post');
    const created = await posts.create({ title: 'Hello', content: 'World', published: true });
    expect(typeof created.id).toBe('number');
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

  test('update / delete / findOrFail', async () => {
    const posts = db.model('post');
    const created = await posts.create({ title: 'orig', content: 'x' });
    const updated = await posts.update(created.id as number, { title: 'changed' });
    expect(updated.title).toBe('changed');

    const deleted = await posts.delete(created.id as number);
    expect(deleted).toBe(true);

    await expect(posts.findOrFail(created.id as number)).rejects.toThrow();
  });

  test('count with filter', async () => {
    const posts = db.model('post');
    await posts.create({ title: 'a', content: 'x', published: true });
    await posts.create({ title: 'b', content: 'x', published: false });
    expect(await posts.count({ where: { published: true } })).toBe(1);
  });
});

describeIfPostgres('Postgres — filter operators (live)', () => {
  let db: Database;

  beforeEach(async () => {
    await resetPostgres(POSTGRES_URL as string, CRUD_TABLES);
    db = createDatabase({
      dialect: 'postgres',
      url: POSTGRES_URL,
      models: [post, user, comment],
    });
    await db.sync();
  });
  afterEach(async () => {
    await db.close();
  });

  test('gt / lte / between on numeric column', async () => {
    const posts = db.model('post');
    for (let i = 1; i <= 5; i++)
      await posts.create({ title: `p${i}`, content: 'x', views: i * 10 });

    expect((await posts.findMany({ where: { views: { gt: 30 } } })).length).toBe(2);
    expect((await posts.findMany({ where: { views: { lte: 20 } } })).length).toBe(2);
    expect((await posts.findMany({ where: { views: { between: [20, 40] } } })).length).toBe(3);
  });

  test('in / notIn', async () => {
    const posts = db.model('post');
    await posts.create({ title: 'a', content: 'x' });
    await posts.create({ title: 'b', content: 'x' });
    await posts.create({ title: 'c', content: 'x' });
    const found = await posts.findMany({ where: { title: { in: ['a', 'c'] } } });
    expect(found.map((r) => r.title).sort()).toEqual(['a', 'c']);
  });

  test('ilike is case-insensitive on Postgres (native)', async () => {
    const posts = db.model('post');
    await posts.create({ title: 'Hello World', content: 'x' });
    await posts.create({ title: 'hello there', content: 'x' });
    await posts.create({ title: 'goodbye', content: 'x' });
    const found = await posts.findMany({ where: { title: { ilike: '%hello%' } } });
    expect(found.length).toBe(2);
  });

  test('contains with special char is escaped (no accidental wildcard)', async () => {
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

describeIfPostgres('Postgres — batch + aggregate (live)', () => {
  let db: Database;

  beforeEach(async () => {
    await resetPostgres(POSTGRES_URL as string, CRUD_TABLES);
    db = createDatabase({
      dialect: 'postgres',
      url: POSTGRES_URL,
      models: [post, user, comment],
    });
    await db.sync();
  });
  afterEach(async () => {
    await db.close();
  });

  test('createMany / updateMany / deleteMany report counts', async () => {
    const posts = db.model('post');
    const created = await posts.createMany([
      { title: 'a', content: 'x' },
      { title: 'b', content: 'x' },
      { title: 'c', content: 'x' },
    ]);
    expect(created.count).toBe(3);

    const updated = await posts.updateMany({
      where: { title: { in: ['a', 'b'] } },
      data: { published: true },
    });
    expect(updated.count).toBe(2);

    const deleted = await posts.deleteMany({ where: { title: 'c' } });
    expect(deleted.count).toBe(1);
    expect(await posts.count()).toBe(2);
  });

  test('upsert inserts when new, updates on conflict', async () => {
    const users = db.model('user');
    const created = await users.upsert({
      where: { email: 'a@a.com' },
      create: { name: 'A', password: 'secret12' },
      update: { name: 'unused' },
    });
    expect(created.name).toBe('A');

    const updated = await users.upsert({
      where: { email: 'a@a.com' },
      create: { name: 'unused2', password: 'secret12' },
      update: { name: 'A2' },
    });
    expect(updated.name).toBe('A2');
    expect(await users.count()).toBe(1);
  });

  test('aggregate sum / avg / count', async () => {
    const posts = db.model('post');
    for (let i = 1; i <= 4; i++)
      await posts.create({ title: `t${i}`, content: 'x', views: i * 10 });

    const result = await posts.aggregate({
      sum: ['views'],
      avg: ['views'],
      count: '_all',
    });
    expect(result.sum?.views).toBe(100);
    expect(result.avg?.views).toBe(25);
    expect(result.count?._all).toBe(4);
  });
});

describeIfPostgres('Postgres — transactions (live, real isolation)', () => {
  let db: Database;

  beforeEach(async () => {
    await resetPostgres(POSTGRES_URL as string, CRUD_TABLES);
    db = createDatabase({
      dialect: 'postgres',
      url: POSTGRES_URL,
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

  test('rolls back on FK / constraint violation', async () => {
    const users = db.model('user');
    await users.create({ name: 'A', email: 'a@a.com', password: 'x' });
    await expect(
      db.transaction(async (tx) => {
        await tx.model('user').create({ name: 'B', email: 'b@b.com', password: 'x' });
        await tx.model('user').create({ name: 'C', email: 'a@a.com', password: 'x' });
      }),
    ).rejects.toThrow();
    expect(await users.count()).toBe(1);
  });

  test('lock: forUpdate serializes concurrent increments inside a tx', async () => {
    const posts = db.model('post');
    const created = await posts.create({ title: 'counter', content: 'x', views: 0 });
    const id = created.id as number;

    // Two transactions both try to read-then-increment; FOR UPDATE means the
    // second waits until the first commits, so the total increment is 2 (not 1).
    const tx1 = db.transaction(async (tx) => {
      const row = await tx.model('post').findOrFail(id, { lock: 'forUpdate' });
      await new Promise((r) => setTimeout(r, 50));
      await tx.model('post').update(id, { views: ((row.views as number) ?? 0) + 1 });
    });
    const tx2 = db.transaction(async (tx) => {
      // small delay so tx1 definitely takes the lock first
      await new Promise((r) => setTimeout(r, 10));
      const row = await tx.model('post').findOrFail(id, { lock: 'forUpdate' });
      await tx.model('post').update(id, { views: ((row.views as number) ?? 0) + 1 });
    });
    await Promise.all([tx1, tx2]);

    const finalRow = await posts.findOrFail(id);
    expect(finalRow.views).toBe(2);
  });
});

describeIfPostgres('Postgres — include (live)', () => {
  let db: Database;

  beforeEach(async () => {
    await resetPostgres(POSTGRES_URL as string, INCLUDE_TABLES);
    db = createDatabase({
      dialect: 'postgres',
      url: POSTGRES_URL,
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
    await articles.create({ title: 'A2', authorRef: alice.id });
    await articles.create({ title: 'B1', authorRef: bob.id });

    const rows = await articles.findMany({
      include: { authorRef: true },
      orderBy: [{ field: 'id', direction: 'asc' }],
    });
    expect(rows).toHaveLength(3);
    expect((rows[0]?.authorRef as { name: string }).name).toBe('Alice');
    expect((rows[2]?.authorRef as { name: string }).name).toBe('Bob');
  });

  test('hasMany groups children per parent, empty → []', async () => {
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

  test('hasMany with nested where filters children', async () => {
    const authors = db.model('author');
    const articles = db.model('article');
    const a = await authors.create({ name: 'A', email: 'a@a.com' });
    await articles.create({ title: 'draft', authorRef: a.id, published: false });
    await articles.create({ title: 'live', authorRef: a.id, published: true });

    const rows = await authors.findMany({
      include: { posts: { where: { published: true } } },
    });
    const posts = rows[0]?.posts as { title: string }[];
    expect(posts).toHaveLength(1);
    expect(posts[0]?.title).toBe('live');
  });

  test('hasOne attaches single object or null', async () => {
    const authors = db.model('author');
    const profiles = db.model('profile');
    const a = await authors.create({ name: 'A', email: 'a@a.com' });
    await authors.create({ name: 'NoProfile', email: 'n@n.com' });
    await profiles.create({ bio: 'bio', ownerRef: a.id });

    const rows = await authors.findMany({
      include: { profile: true },
      orderBy: [{ field: 'id', direction: 'asc' }],
    });
    expect((rows[0]?.profile as { bio: string }).bio).toBe('bio');
    expect(rows[1]?.profile).toBeNull();
  });
});
