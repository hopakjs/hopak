import { describe, expect, test } from 'bun:test';
import { Conflict } from '@hopak/common';
import { isUniqueViolation, withUniqueToConflict } from '../src/db/sql/error-translator';

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
  test('unrelated errors are not flagged', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(new Error('connection refused'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('string')).toBe(false);
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

  test('re-throws non-UNIQUE errors unchanged', async () => {
    const err = new Error('some other error');
    await expect(
      withUniqueToConflict(async () => {
        throw err;
      }),
    ).rejects.toBe(err);
  });
});
