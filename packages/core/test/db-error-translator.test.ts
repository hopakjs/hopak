import { describe, expect, test } from 'bun:test';
import { Conflict } from '@hopak/common';
import {
  isForeignKeyViolation,
  isUniqueViolation,
  withUniqueToConflict,
} from '../src/db/sql/error-translator';

describe('isUniqueViolation', () => {
  test('Postgres code 23505', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });
  test('MySQL ER_DUP_ENTRY', () => {
    expect(isUniqueViolation({ code: 'ER_DUP_ENTRY' })).toBe(true);
    expect(isUniqueViolation({ errno: 1062 })).toBe(true);
  });
  test('SQLite message', () => {
    expect(
      isUniqueViolation({
        code: 'SQLITE_CONSTRAINT_UNIQUE',
        message: 'UNIQUE constraint failed: users.email',
      }),
    ).toBe(true);
    expect(isUniqueViolation({ message: 'UNIQUE constraint failed: posts.slug' })).toBe(true);
  });
  test('Drizzle-wrapped error — unwraps .cause (postgres.js)', () => {
    // What Drizzle throws in practice: a plain Error whose cause is the
    // original driver error with the code. The wrapper's own message
    // starts with "Failed query: ...".
    const wrapped = Object.assign(new Error('Failed query: insert into "users" ...'), {
      cause: Object.assign(
        new Error('duplicate key value violates unique constraint "users_email_key"'),
        {
          code: '23505',
        },
      ),
    });
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  test('Drizzle-wrapped error — unwraps .cause (mysql2)', () => {
    const wrapped = Object.assign(new Error('Failed query: insert into `users` ...'), {
      cause: Object.assign(new Error("Duplicate entry 'a@b.com' for key 'users.email'"), {
        code: 'ER_DUP_ENTRY',
        errno: 1062,
      }),
    });
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  test('Message fallback catches Postgres / MySQL wording even without .code', () => {
    expect(
      isUniqueViolation({
        message: 'Failed query ... duplicate key value violates unique constraint "x"',
      }),
    ).toBe(true);
    expect(isUniqueViolation({ message: "Failed query ... Duplicate entry 'a' for key 'b'" })).toBe(
      true,
    );
  });

  test('unrelated errors are not flagged', () => {
    expect(isUniqueViolation(new Error('connection refused'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('string')).toBe(false);
    expect(isUniqueViolation({ message: 'something random' })).toBe(false);
    // FK code is distinctly NOT a unique violation:
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
  });
});

describe('isForeignKeyViolation', () => {
  test('Postgres 23503', () => {
    expect(isForeignKeyViolation({ code: '23503' })).toBe(true);
  });
  test('MySQL ER_NO_REFERENCED_ROW_2 / 1452', () => {
    expect(isForeignKeyViolation({ code: 'ER_NO_REFERENCED_ROW_2' })).toBe(true);
    expect(isForeignKeyViolation({ errno: 1452 })).toBe(true);
  });
  test('SQLite FOREIGN KEY message', () => {
    expect(
      isForeignKeyViolation({
        code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
        message: 'FOREIGN KEY constraint failed',
      }),
    ).toBe(true);
  });
  test('Drizzle-wrapped FK (postgres.js via .cause)', () => {
    const wrapped = Object.assign(new Error('Failed query: insert into "posts"'), {
      cause: Object.assign(
        new Error('insert or update on table "posts" violates foreign key constraint'),
        {
          code: '23503',
        },
      ),
    });
    expect(isForeignKeyViolation(wrapped)).toBe(true);
  });
  test('Unique code is not a FK violation', () => {
    expect(isForeignKeyViolation({ code: '23505' })).toBe(false);
  });
});

describe('withUniqueToConflict', () => {
  test('passes through successful results', async () => {
    const result = await withUniqueToConflict(async () => 42);
    expect(result).toBe(42);
  });

  test('translates UNIQUE violations into Conflict (409)', async () => {
    await expect(
      withUniqueToConflict(async () => {
        throw Object.assign(new Error('UNIQUE constraint failed: users.email'), {
          code: 'SQLITE_CONSTRAINT_UNIQUE',
        });
      }),
    ).rejects.toThrow(Conflict);
  });

  test('translates FK violations into Conflict (409) too', async () => {
    await expect(
      withUniqueToConflict(async () => {
        throw Object.assign(new Error('Failed query'), {
          cause: { code: '23503', message: 'violates foreign key constraint' },
        });
      }),
    ).rejects.toThrow(Conflict);
  });

  test('re-throws non-constraint errors unchanged', async () => {
    const err = new Error('some other error');
    await expect(
      withUniqueToConflict(async () => {
        throw err;
      }),
    ).rejects.toBe(err);
  });
});
