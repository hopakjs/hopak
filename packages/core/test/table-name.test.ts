import { describe, expect, test } from 'bun:test';
import { createSqliteDatabase } from '../src/db/sqlite';
import { text } from '../src/fields/string';
import { model } from '../src/model/define';

describe('model.tableName', () => {
  test('is the pluralized model name', () => {
    expect(model('post', { title: text() }).tableName).toBe('posts');
    expect(model('category', { title: text() }).tableName).toBe('categories');
    expect(model('box', { title: text() }).tableName).toBe('boxes');
    // Suffix rules only — no irregular-noun dictionary, so `person`
    // is `persons`. Changing that would rename live tables.
    expect(model('person', { title: text() }).tableName).toBe('persons');
  });

  test('matches the physical table db.sql can query', async () => {
    const post = model('post', { title: text().required() });
    const db = createSqliteDatabase({ models: [post] });
    await db.sync();
    await db.model('post').create({ title: 'hello' });

    const rows = await db.sql<{ n: number }>`SELECT COUNT(*) AS n FROM posts`;
    expect(rows[0]?.n).toBe(1);

    const listed = await db.sql<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${post.tableName}
    `;
    expect(listed).toHaveLength(1);
    await db.close();
  });
});
