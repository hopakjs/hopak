import { describe, expect, test } from 'bun:test';
import { ConfigError } from '@hopak/common';
import { translateConnectError } from '../src/db/sql/connect-translator';

describe('translateConnectError', () => {
  test('ECONNREFUSED → friendly ConfigError, no stack leak', () => {
    const wrapped = translateConnectError(
      Object.assign(new Error('connect ECONNREFUSED ::1:5432'), {
        code: 'ECONNREFUSED',
      }),
      'postgres',
      'postgres://u:p@localhost:5432/db',
    );
    expect(wrapped).toBeInstanceOf(ConfigError);
    expect(wrapped.message).toContain('Cannot reach the postgres server');
    expect(wrapped.message).toContain('postgres://***:***@localhost:5432/db');
    expect(wrapped.message).not.toContain(':p@');
  });

  test('Postgres 28P01 → auth error', () => {
    const wrapped = translateConnectError({ code: '28P01' }, 'postgres');
    expect(wrapped).toBeInstanceOf(ConfigError);
    expect(wrapped.message).toContain('Authentication failed');
  });

  test('Postgres 3D000 → missing database', () => {
    const wrapped = translateConnectError({ code: '3D000' }, 'postgres');
    expect(wrapped).toBeInstanceOf(ConfigError);
    expect(wrapped.message).toContain('does not exist');
    expect(wrapped.message).toContain('createdb');
  });

  test('MySQL 1045 / ER_ACCESS_DENIED_ERROR → auth error', () => {
    expect(translateConnectError({ errno: 1045 }, 'mysql')).toBeInstanceOf(ConfigError);
    expect(translateConnectError({ code: 'ER_ACCESS_DENIED_ERROR' }, 'mysql')).toBeInstanceOf(
      ConfigError,
    );
  });

  test('MySQL 1049 / ER_BAD_DB_ERROR → missing database', () => {
    const wrapped = translateConnectError({ errno: 1049 }, 'mysql');
    expect(wrapped).toBeInstanceOf(ConfigError);
    expect((wrapped as Error).message).toContain('CREATE DATABASE');
  });

  test('ENOTFOUND → dns error', () => {
    const wrapped = translateConnectError({ code: 'ENOTFOUND' }, 'postgres');
    expect((wrapped as Error).message).toContain('Cannot resolve');
  });

  test('unknown errors pass through unchanged', () => {
    const original = new Error('something weird');
    expect(translateConnectError(original, 'postgres')).toBe(original);
  });

  test('existing ConfigError passes through', () => {
    const ce = new ConfigError('already clean');
    expect(translateConnectError(ce, 'mysql')).toBe(ce);
  });
});
