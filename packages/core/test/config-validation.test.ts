import { describe, expect, test } from 'bun:test';
import { ConfigError } from '@hopak/common';
import { applyConfig, validateConfig } from '../src/app/config';

describe('config validation', () => {
  test('accepts a clean default config', () => {
    expect(() => applyConfig('/tmp/x')).not.toThrow();
  });

  test('rejects an unknown dialect with a ConfigError that lists allowed values', () => {
    expect(() =>
      applyConfig('/tmp/x', { database: { dialect: 'unknown' as unknown as 'sqlite' } }),
    ).toThrow(ConfigError);
    try {
      applyConfig('/tmp/x', { database: { dialect: 'cassandra' as unknown as 'sqlite' } });
    } catch (err) {
      expect((err as Error).message).toContain('sqlite, postgres, mysql');
    }
  });

  test('rejects non-integer port', () => {
    expect(() =>
      applyConfig('/tmp/x', { server: { port: 'not-a-number' as unknown as number } }),
    ).toThrow(ConfigError);
  });

  test('rejects out-of-range port', () => {
    expect(() => applyConfig('/tmp/x', { server: { port: 99999 } })).toThrow(ConfigError);
  });

  test('rejects unknown logLevel', () => {
    expect(() => applyConfig('/tmp/x', { logLevel: 'verbose' as unknown as 'info' })).toThrow(
      ConfigError,
    );
  });

  test('validateConfig combines multiple issues into one error message', () => {
    try {
      applyConfig('/tmp/x', {
        database: { dialect: 'nope' as unknown as 'sqlite' },
        server: { port: -1 },
        logLevel: 'trace' as unknown as 'info',
      });
      expect.unreachable();
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('dialect');
      expect(msg).toContain('port');
      expect(msg).toContain('logLevel');
    }
    void validateConfig;
  });
});
