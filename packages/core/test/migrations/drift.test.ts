/**
 * Drift detection — live SQLite. Create a table with one column, then
 * ask the detector to compare against a model that has extra fields.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type Database, createDatabase, model, text } from '../../src';
import { detectDrift } from '../../src/db/sql/introspect';

let db: Database;

beforeEach(async () => {
  db = createDatabase({ dialect: 'sqlite', models: [] });
});

afterEach(async () => {
  await db.close();
});

describe('detectDrift', () => {
  test('flags columns declared on the model but missing in the table', async () => {
    await db.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
    const userModel = model('user', {
      name: text().required(),
      email: text().required(),
      role: text(),
    });
    const drift = await detectDrift(db, 'sqlite', [userModel]);
    expect(drift).toHaveLength(1);
    expect(drift[0]?.table).toBe('users');
    expect(drift[0]?.missingColumns.sort()).toEqual(['email', 'role']);
  });

  test('skips tables that do not exist yet (sync will create them)', async () => {
    const m = model('ghost', { name: text().required() });
    const drift = await detectDrift(db, 'sqlite', [m]);
    expect(drift).toHaveLength(0);
  });

  test('no drift when every field has a matching column', async () => {
    await db.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)');
    const m = model('user', { name: text().required(), email: text().required() });
    const drift = await detectDrift(db, 'sqlite', [m]);
    expect(drift).toHaveLength(0);
  });
});
