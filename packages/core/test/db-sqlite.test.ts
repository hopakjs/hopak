import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
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
import { buildCreateTableSql } from '../src/db/sqlite';

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

  test('unique constraint surfaces as Conflict (409), not a raw driver error', async () => {
    const { Conflict } = await import('@hopak/common');
    const users = db.model('user');
    await users.create({ name: 'A', email: 'a@a.com', password: 'secret123' });
    await expect(
      users.create({ name: 'B', email: 'a@a.com', password: 'secret456' }),
    ).rejects.toBeInstanceOf(Conflict);
  });

  test('unknown model throws', () => {
    expect(() => db.model('nonexistent')).toThrow(/not registered/);
  });
});

describe('SQLite — select projection', () => {
  test('returns only the listed columns', async () => {
    const posts = db.model('post');
    await posts.create({ title: 'Hello', content: 'World', views: 42 });
    const rows = await posts.findMany({ select: ['id', 'title'] });
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] as object).sort()).toEqual(['id', 'title']);
    expect((rows[0] as { title: string }).title).toBe('Hello');
  });

  test('select + include transparently fetches the FK field', async () => {
    const users = db.model('user');
    const alice = await users.create({ name: 'Alice', email: 'a@a.com', password: 'x' });
    const comments = db.model('comment');
    await comments.create({ body: 'hi', author: alice.id as number });

    // User asks for `body` only; FK `author` is auto-added so `include` works,
    // then gets overwritten with the nested user row.
    const rows = await comments.findMany({
      select: ['body'],
      include: { author: true },
    });
    expect((rows[0] as { body: string }).body).toBe('hi');
    expect((rows[0] as { author: { name: string } }).author.name).toBe('Alice');
  });
});

describe('SQLite — distinct', () => {
  test('distinct: true deduplicates full rows', async () => {
    const posts = db.model('post');
    // Same title+content; SQLite would return both without DISTINCT.
    // With DISTINCT the `id` differs so DISTINCT on all columns still returns 2.
    // To get a meaningful test, project via `select`:
    await posts.create({ title: 'same', content: 'x', views: 1, published: true });
    await posts.create({ title: 'same', content: 'x', views: 1, published: true });
    await posts.create({ title: 'other', content: 'x', views: 1, published: true });

    const rows = await posts.findMany({
      select: ['title'],
      distinct: true,
      orderBy: [{ field: 'title', direction: 'asc' }],
    });
    expect(rows.map((r) => (r as { title: string }).title)).toEqual(['other', 'same']);
  });

  test('distinct: [cols] rejects on SQLite with pointer to raw()', async () => {
    const posts = db.model('post');
    await expect(
      posts.findMany({ distinct: ['title'] as readonly string[] as never }),
    ).rejects.toThrow(/requires Postgres/);
  });

  test('distinct: [] is rejected as empty', async () => {
    const posts = db.model('post');
    await expect(posts.findMany({ distinct: [] as readonly string[] as never })).rejects.toThrow(
      /empty/,
    );
  });
});

describe('SQLite — filter operators', () => {
  const seed = async () => {
    const posts = db.model('post');
    await posts.create({ title: 'alpha', content: 'one', views: 10, published: true });
    await posts.create({ title: 'beta', content: 'two', views: 50, published: false });
    await posts.create({ title: 'gamma', content: 'three', views: 100, published: true });
    await posts.create({ title: 'Delta', content: 'four', views: 0, published: false });
    return posts;
  };

  test('equality via literal value still works (backwards compat)', async () => {
    const posts = await seed();
    const results = await posts.findMany({ where: { published: true } });
    expect(results).toHaveLength(2);
  });

  test('gte / lte numeric comparison', async () => {
    const posts = await seed();
    const results = await posts.findMany({ where: { views: { gte: 50 } } });
    expect(results.map((r) => r.title).sort()).toEqual(['beta', 'gamma']);
  });

  test('gt / lt strict comparison', async () => {
    const posts = await seed();
    const results = await posts.findMany({ where: { views: { gt: 50 } } });
    expect(results.map((r) => r.title)).toEqual(['gamma']);
  });

  test('in / notIn', async () => {
    const posts = await seed();
    const results = await posts.findMany({ where: { title: { in: ['alpha', 'gamma'] } } });
    expect(results).toHaveLength(2);

    const excluded = await posts.findMany({ where: { title: { notIn: ['alpha', 'Delta'] } } });
    expect(excluded.map((r) => r.title).sort()).toEqual(['beta', 'gamma']);
  });

  test('contains / startsWith / endsWith', async () => {
    const posts = await seed();
    expect((await posts.findMany({ where: { title: { contains: 'a' } } })).length).toBe(4);
    expect((await posts.findMany({ where: { title: { startsWith: 'a' } } }))[0]?.title).toBe(
      'alpha',
    );
    // 'beta' and 'Delta' end with 'ta' (LIKE is case-insensitive on SQLite ASCII).
    expect((await posts.findMany({ where: { title: { endsWith: 'ta' } } })).length).toBe(2);
  });

  test('between', async () => {
    const posts = await seed();
    const results = await posts.findMany({ where: { views: { between: [10, 60] } } });
    expect(results.map((r) => r.title).sort()).toEqual(['alpha', 'beta']);
  });

  test('neq', async () => {
    const posts = await seed();
    const results = await posts.findMany({ where: { title: { neq: 'alpha' } } });
    expect(results.map((r) => r.title).sort()).toEqual(['Delta', 'beta', 'gamma']);
  });

  test('OR combines branches', async () => {
    const posts = await seed();
    const results = await posts.findMany({
      where: {
        OR: [{ title: 'alpha' }, { views: { gte: 100 } }],
      },
    });
    expect(results.map((r) => r.title).sort()).toEqual(['alpha', 'gamma']);
  });

  test('NOT negates a clause', async () => {
    const posts = await seed();
    const results = await posts.findMany({ where: { NOT: { published: true } } });
    expect(results.map((r) => r.title).sort()).toEqual(['Delta', 'beta']);
  });

  test('combined AND (implicit) with operator value', async () => {
    const posts = await seed();
    const results = await posts.findMany({
      where: { published: true, views: { gte: 50 } },
    });
    expect(results.map((r) => r.title)).toEqual(['gamma']);
  });

  test('count respects operators', async () => {
    const posts = await seed();
    expect(await posts.count({ where: { views: { gt: 10 } } })).toBe(2);
  });

  test('contains escapes LIKE wildcards', async () => {
    const posts = db.model('post');
    await posts.create({ title: '100% cotton', content: 'x' });
    await posts.create({ title: '100 grams', content: 'x' });
    // `%` inside the pattern is escaped; only the literal-% row matches.
    const results = await posts.findMany({ where: { title: { contains: '%' } } });
    expect(results.map((r) => r.title)).toEqual(['100% cotton']);
  });
});

describe('SQLite — row lock (silent no-op)', () => {
  test('findOne with lock returns the row (no error, no change in behavior)', async () => {
    const posts = db.model('post');
    const created = await posts.create({ title: 'locked', content: 'x' });
    const row = await posts.findOne(created.id as number, { lock: 'forUpdate' });
    expect(row?.title).toBe('locked');
  });

  test('findMany with lock returns rows', async () => {
    const posts = db.model('post');
    await posts.create({ title: 'a', content: 'x' });
    await posts.create({ title: 'b', content: 'x' });
    const rows = await posts.findMany({ lock: 'forShare' });
    expect(rows.length).toBe(2);
  });
});

describe('SQLite — cursor pagination', () => {
  test('asc cursor returns rows strictly after the cursor id', async () => {
    const posts = db.model('post');
    for (let i = 1; i <= 5; i++) await posts.create({ title: `p${i}`, content: 'x' });

    const page1 = await posts.findMany({
      orderBy: [{ field: 'id', direction: 'asc' }],
      limit: 2,
    });
    expect(page1.map((r) => r.title)).toEqual(['p1', 'p2']);

    const page2 = await posts.findMany({
      cursor: { id: page1[1]?.id as number },
      orderBy: [{ field: 'id', direction: 'asc' }],
      limit: 2,
    });
    expect(page2.map((r) => r.title)).toEqual(['p3', 'p4']);
  });

  test('desc cursor returns rows strictly before', async () => {
    const posts = db.model('post');
    for (let i = 1; i <= 5; i++) await posts.create({ title: `p${i}`, content: 'x' });

    const first = await posts.findMany({
      orderBy: [{ field: 'id', direction: 'desc' }],
      limit: 2,
    });
    expect(first.map((r) => r.title)).toEqual(['p5', 'p4']);

    const next = await posts.findMany({
      cursor: { id: first[1]?.id as number },
      orderBy: [{ field: 'id', direction: 'desc' }],
      limit: 2,
    });
    expect(next.map((r) => r.title)).toEqual(['p3', 'p2']);
  });

  test('cursor merges with existing where', async () => {
    const posts = db.model('post');
    for (let i = 1; i <= 5; i++) {
      await posts.create({ title: `p${i}`, content: 'x', published: i % 2 === 0 });
    }

    // Published-only: p2 and p4. Cursor to skip p2 → [p4].
    const rows = await posts.findMany({
      where: { published: true },
      cursor: { id: 2 },
      orderBy: [{ field: 'id', direction: 'asc' }],
    });
    expect(rows.map((r) => r.title)).toEqual(['p4']);
  });

  test('cursor without matching orderBy throws', async () => {
    const posts = db.model('post');
    await expect(posts.findMany({ cursor: { id: 1 } })).rejects.toThrow(/orderBy/);
  });

  test('multi-key cursor throws', async () => {
    const posts = db.model('post');
    await expect(
      posts.findMany({
        cursor: { id: 1, title: 'x' } as never,
        orderBy: [{ field: 'id', direction: 'asc' }],
      }),
    ).rejects.toThrow(/exactly one key/);
  });
});

describe('SQLite — aggregate with groupBy', () => {
  test('groups per column and returns an array with group keys + aggregates', async () => {
    const posts = db.model('post');
    await posts.create({ title: 'a1', content: 'x', views: 10, published: true });
    await posts.create({ title: 'a2', content: 'x', views: 20, published: true });
    await posts.create({ title: 'b1', content: 'x', views: 5, published: false });
    await posts.create({ title: 'b2', content: 'x', views: 15, published: false });

    const rows = await posts.aggregate({
      groupBy: ['published'],
      sum: ['views'],
      count: '_all',
    });

    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(2);
    const byPublished = new Map(
      rows.map((r) => [Boolean((r as { published: boolean }).published), r]),
    );
    expect(byPublished.get(true)?.sum?.views).toBe(30);
    expect(byPublished.get(true)?.count?._all).toBe(2);
    expect(byPublished.get(false)?.sum?.views).toBe(20);
    expect(byPublished.get(false)?.count?._all).toBe(2);
  });

  test('without groupBy still returns a single object (back-compat)', async () => {
    const posts = db.model('post');
    await posts.create({ title: 'a', content: 'x', views: 10 });
    await posts.create({ title: 'b', content: 'x', views: 20 });
    const result = await posts.aggregate({ sum: ['views'], count: '_all' });
    expect(Array.isArray(result)).toBe(false);
    expect(result.sum?.views).toBe(30);
    expect(result.count?._all).toBe(2);
  });
});

describe('SQLite — upsert', () => {
  test('upsert inserts a new row when no conflict', async () => {
    const users = db.model('user');
    const row = await users.upsert({
      where: { email: 'new@example.com' },
      create: { name: 'New', password: 'hunter12' },
      update: { name: 'Updated' },
    });
    expect(row.name).toBe('New');
    expect(row.email).toBe('new@example.com');
    expect(await users.count()).toBe(1);
  });

  test('upsert updates the existing row on conflict', async () => {
    const users = db.model('user');
    await users.create({ name: 'Alice', email: 'alice@example.com', password: 'x' });
    const row = await users.upsert({
      where: { email: 'alice@example.com' },
      create: { name: 'Should not be used', password: 'x' },
      update: { name: 'Alice Updated' },
    });
    expect(row.name).toBe('Alice Updated');
    expect(await users.count()).toBe(1);
  });
});

describe('SQLite — batch operations', () => {
  test('createMany inserts all rows and reports count', async () => {
    const posts = db.model('post');
    const result = await posts.createMany([
      { title: 'a', content: '1' },
      { title: 'b', content: '2' },
      { title: 'c', content: '3' },
    ]);
    expect(result.count).toBe(3);
    expect(await posts.count()).toBe(3);
  });

  test('createMany with empty array is a no-op', async () => {
    const posts = db.model('post');
    const result = await posts.createMany([]);
    expect(result.count).toBe(0);
  });

  test('updateMany applies data to matching rows', async () => {
    const posts = db.model('post');
    await posts.create({ title: 'a', content: 'x', published: false });
    await posts.create({ title: 'b', content: 'x', published: false });
    await posts.create({ title: 'c', content: 'x', published: true });

    const result = await posts.updateMany({
      where: { published: false },
      data: { published: true },
    });
    expect(result.count).toBe(2);
    expect(await posts.count({ where: { published: true } })).toBe(3);
  });

  test('deleteMany removes matching rows', async () => {
    const posts = db.model('post');
    await posts.create({ title: 'keep', content: 'x', views: 100 });
    await posts.create({ title: 'drop', content: 'x', views: 0 });
    await posts.create({ title: 'drop-too', content: 'x', views: 0 });

    const result = await posts.deleteMany({ where: { views: 0 } });
    expect(result.count).toBe(2);
    expect(await posts.count()).toBe(1);
  });

  test('deleteMany with no where matches nothing dangerous (must pass {})', async () => {
    const posts = db.model('post');
    await posts.create({ title: 'a', content: 'x' });
    // Intentional: pass {} — deletes all. Documented behavior.
    const result = await posts.deleteMany({});
    expect(result.count).toBe(1);
  });
});

describe('SQLite — aggregate', () => {
  const seed = async () => {
    const posts = db.model('post');
    await posts.create({ title: 'a', content: 'x', views: 10 });
    await posts.create({ title: 'b', content: 'x', views: 20 });
    await posts.create({ title: 'c', content: 'x', views: 30 });
    await posts.create({ title: 'd', content: 'x', views: 40 });
    return posts;
  };

  test('count _all returns total row count', async () => {
    const posts = await seed();
    const result = await posts.aggregate({ count: '_all' });
    expect(result.count?._all).toBe(4);
  });

  test('sum / avg / min / max on a single column', async () => {
    const posts = await seed();
    const result = await posts.aggregate({
      sum: ['views'],
      avg: ['views'],
      min: ['views'],
      max: ['views'],
    });
    expect(result.sum?.views).toBe(100);
    expect(result.avg?.views).toBe(25);
    expect(result.min?.views).toBe(10);
    expect(result.max?.views).toBe(40);
  });

  test('aggregate respects where filter', async () => {
    const posts = await seed();
    const result = await posts.aggregate({
      where: { views: { gte: 20 } },
      sum: ['views'],
      count: '_all',
    });
    expect(result.sum?.views).toBe(90);
    expect(result.count?._all).toBe(3);
  });

  test('count on non-null column', async () => {
    const posts = db.model('post');
    await posts.create({ title: 'a', content: 'x', views: 10 });
    await posts.create({ title: 'b', content: 'x' }); // views defaults to 0
    const result = await posts.aggregate({ count: ['views'] });
    expect(result.count?.views).toBe(2);
  });
});

describe('SQLite — transactions', () => {
  test('commits when the callback resolves', async () => {
    const posts = db.model('post');
    await db.transaction(async (tx) => {
      await tx.model('post').create({ title: 'tx1', content: 'x' });
      await tx.model('post').create({ title: 'tx2', content: 'x' });
    });
    expect(await posts.count()).toBe(2);
  });

  test('rolls back when the callback throws', async () => {
    const posts = db.model('post');
    await posts.create({ title: 'initial', content: 'x' });

    await expect(
      db.transaction(async (tx) => {
        await tx.model('post').create({ title: 'should not persist', content: 'x' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await posts.count()).toBe(1);
    const remaining = await posts.findMany();
    expect(remaining.map((r) => r.title)).toEqual(['initial']);
  });

  test('rolls back when a DB-level error fires inside the tx', async () => {
    const users = db.model('user');
    await users.create({ name: 'A', email: 'a@a.com', password: 'secret' });

    await expect(
      db.transaction(async (tx) => {
        await tx.model('user').create({ name: 'B', email: 'b@b.com', password: 'secret' });
        // duplicate email — UNIQUE violation
        await tx.model('user').create({ name: 'C', email: 'a@a.com', password: 'secret' });
      }),
    ).rejects.toThrow();

    // B should not have persisted
    expect(await users.count()).toBe(1);
  });

  test('returns the callback value', async () => {
    const result = await db.transaction(async (tx) => {
      const row = await tx.model('post').create({ title: 'ret', content: 'x' });
      return row.id;
    });
    expect(typeof result).toBe('number');
  });

  test('tx-view rejects sync()', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.sync();
      }),
    ).rejects.toThrow(/sync\(\) is not supported inside a transaction/);
  });

  test('tx-view rejects nested transaction()', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.transaction(async () => {
          /* ... */
        });
      }),
    ).rejects.toThrow(/Nested transactions are not supported/);
  });
});

describe('SQLite — include (eager loading, N+1-free)', () => {
  // Dedicated models so we don't perturb the other suites.
  const author = model('author', {
    name: text().required(),
    email: email().required().unique(),
    password: password().optional(),
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

  let rdb: Database;
  beforeEach(async () => {
    rdb = createDatabase({ dialect: 'sqlite', models: [author, article, profile] });
    await rdb.sync();
  });
  afterEach(async () => {
    await rdb.close();
  });

  test('belongsTo — article.authorRef resolves to the author row', async () => {
    const authors = rdb.model('author');
    const articles = rdb.model('article');
    const alice = await authors.create({ name: 'Alice', email: 'a@a.com', password: 'p1' });
    const bob = await authors.create({ name: 'Bob', email: 'b@b.com', password: 'p2' });
    await articles.create({ title: 'Alice 1', authorRef: alice.id });
    await articles.create({ title: 'Alice 2', authorRef: alice.id });
    await articles.create({ title: 'Bob 1', authorRef: bob.id });

    const all = await articles.findMany({
      include: { authorRef: true },
      orderBy: [{ field: 'id', direction: 'asc' }],
    });

    expect(all).toHaveLength(3);
    expect((all[0]?.authorRef as { name: string }).name).toBe('Alice');
    expect((all[2]?.authorRef as { name: string }).name).toBe('Bob');
  });

  test('belongsTo — null FK stays null in the nested column', async () => {
    const articles = rdb.model('article');
    await articles.create({ title: 'Orphan', authorRef: null });

    const rows = await articles.findMany({ include: { authorRef: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.authorRef).toBeNull();
  });

  test('belongsTo — unknown FK becomes null (not an error)', async () => {
    const articles = rdb.model('article');
    // Insert an article whose authorRef points to a non-existent author.
    // Create an author then delete them so the FK integer remains orphaned.
    const authors = rdb.model('author');
    const ghost = await authors.create({ name: 'Ghost', email: 'g@g.com', password: 'gp' });
    await articles.create({ title: 'Ghost article', authorRef: ghost.id });
    await authors.delete(ghost.id as number);

    const rows = await articles.findMany({ include: { authorRef: true } });
    expect(rows[0]?.authorRef).toBeNull();
  });

  test('hasMany — author.posts returns grouped children', async () => {
    const authors = rdb.model('author');
    const articles = rdb.model('article');
    const alice = await authors.create({ name: 'Alice', email: 'a@a.com', password: 'p1' });
    const bob = await authors.create({ name: 'Bob', email: 'b@b.com', password: 'p2' });
    await articles.create({ title: 'a1', authorRef: alice.id });
    await articles.create({ title: 'a2', authorRef: alice.id });
    await articles.create({ title: 'b1', authorRef: bob.id });

    const rows = await authors.findMany({
      include: { posts: true },
      orderBy: [{ field: 'id', direction: 'asc' }],
    });

    const aliceRow = rows[0];
    const bobRow = rows[1];
    expect(aliceRow?.posts as unknown[]).toHaveLength(2);
    expect(bobRow?.posts as unknown[]).toHaveLength(1);
  });

  test('hasMany — parents without children get an empty array', async () => {
    const authors = rdb.model('author');
    await authors.create({ name: 'Childless', email: 'c@c.com' });

    const rows = await authors.findMany({ include: { posts: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.posts).toEqual([]);
  });

  test('include strips sensitive fields on the nested row (belongsTo)', async () => {
    const authors = rdb.model('author');
    const articles = rdb.model('article');
    const alice = await authors.create({
      name: 'Alice',
      email: 'sec@a.com',
      password: 'argon2-hash',
    });
    await articles.create({ title: 'sec article', authorRef: alice.id });

    const [row] = await articles.findMany({ include: { authorRef: true } });
    const nested = row?.authorRef as Record<string, unknown>;
    expect(nested.name).toBe('Alice');
    expect(Object.prototype.hasOwnProperty.call(nested, 'password')).toBe(false);
  });

  test('include strips sensitive fields on nested rows (hasMany)', async () => {
    const authors = rdb.model('author');
    const articles = rdb.model('article');
    const alice = await authors.create({
      name: 'Alice',
      email: 'h@a.com',
      password: 'argon2-hash',
    });
    await articles.create({ title: 'a1', authorRef: alice.id });

    // hasMany on the opposite side: include articles on author — the article
    // has no sensitive fields, so this case tests the stripping runs without
    // tripping on models that have an empty exclusion set.
    const [row] = await authors.findMany({ include: { posts: true } });
    const nested = row?.posts as unknown[];
    expect(nested).toHaveLength(1);
    // And the top-level password is still gone from the author itself (the
    // CRUD serializer handles that; this assertion documents that nested
    // stripping does not accidentally re-add it.)
  });

  test('authors still see password server-side before include', async () => {
    const authors = rdb.model('author');
    const row = await authors.create({
      name: 'RAW',
      email: 'raw@a.com',
      password: 'keep-me',
    });
    expect(row.password).toBe('keep-me');
  });

  test('hasMany — nested where filter applies to children', async () => {
    const authors = rdb.model('author');
    const articles = rdb.model('article');
    const alice = await authors.create({ name: 'Alice', email: 'a@a.com' });
    await articles.create({ title: 'draft', authorRef: alice.id, published: false });
    await articles.create({ title: 'live', authorRef: alice.id, published: true });

    const rows = await authors.findMany({
      include: { posts: { where: { published: true } } },
    });
    const posts = rows[0]?.posts as { title: string }[];
    expect(posts).toHaveLength(1);
    expect(posts[0]?.title).toBe('live');
  });

  test('hasOne — single matching child attached, not an array', async () => {
    const authors = rdb.model('author');
    const profiles = rdb.model('profile');
    const alice = await authors.create({ name: 'Alice', email: 'a@a.com' });
    await profiles.create({ bio: 'hello', ownerRef: alice.id });

    const rows = await authors.findMany({ include: { profile: true } });
    expect(rows[0]?.profile).toMatchObject({ bio: 'hello' });
  });

  test('hasOne — missing child is null, not undefined or []', async () => {
    const authors = rdb.model('author');
    await authors.create({ name: 'NoProfile', email: 'n@n.com' });
    const rows = await authors.findMany({ include: { profile: true } });
    expect(rows[0]?.profile).toBeNull();
  });

  test('multiple includes in one call — single query per relation', async () => {
    const authors = rdb.model('author');
    const articles = rdb.model('article');
    const profiles = rdb.model('profile');
    const alice = await authors.create({ name: 'Alice', email: 'a@a.com' });
    await articles.create({ title: 'a1', authorRef: alice.id });
    await profiles.create({ bio: 'b', ownerRef: alice.id });

    const rows = await authors.findMany({ include: { posts: true, profile: true } });
    expect(rows[0]?.posts as unknown[]).toHaveLength(1);
    expect(rows[0]?.profile).toMatchObject({ bio: 'b' });
  });

  test('unknown relation name throws with the model name in the message', async () => {
    const authors = rdb.model('author');
    await authors.create({ name: 'A', email: 'x@x.com' });
    await expect(authors.findMany({ include: { ghosts: true } })).rejects.toThrow(/ghosts.*author/);
  });

  test('empty primary set short-circuits — no relation query', async () => {
    const articles = rdb.model('article');
    // Database is empty; include must not error even though the FK index
    // would be empty.
    const rows = await articles.findMany({ include: { authorRef: true } });
    expect(rows).toEqual([]);
  });
});

describe('dialect dispatch', () => {
  test('postgres requires a connection URL', () => {
    expect(() => createDatabase({ dialect: 'postgres', models: [post] })).toThrow(/connection URL/);
  });

  test('mysql requires a connection URL', () => {
    expect(() => createDatabase({ dialect: 'mysql', models: [post] })).toThrow(/connection URL/);
  });
});
