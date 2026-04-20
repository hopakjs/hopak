import { describe, expect, test } from 'bun:test';
import {
  buildDatabaseBlock,
  detectDialect,
  findDatabaseBlock,
  patchConfig,
} from '../src/use/config-patcher';
import { patchEnvExample } from '../src/use/env-patcher';

const CONFIG_WITH_SQLITE = `import { defineConfig } from '@hopak/core';

export default defineConfig({
  server: { port: 3000 },
  database: { dialect: 'sqlite', file: '.hopak/data.db' },
});
`;

const CONFIG_WITHOUT_DATABASE = `import { defineConfig } from '@hopak/core';

export default defineConfig({
  server: { port: 3000 },
});
`;

const CONFIG_MULTILINE_DATABASE = `import { defineConfig } from '@hopak/core';

export default defineConfig({
  server: { port: 3000 },
  database: {
    dialect: 'postgres',
    url: process.env.DATABASE_URL,
  },
});
`;

describe('config-patcher — findDatabaseBlock', () => {
  test('locates an inline database block', () => {
    const block = findDatabaseBlock(CONFIG_WITH_SQLITE);
    expect(block).not.toBeNull();
    const text = CONFIG_WITH_SQLITE.slice(block?.start ?? 0, block?.end ?? 0);
    expect(text).toContain("dialect: 'sqlite'");
    expect(text.endsWith('}')).toBe(true);
  });

  test('returns null when no database block is present', () => {
    expect(findDatabaseBlock(CONFIG_WITHOUT_DATABASE)).toBeNull();
  });

  test('brace-counts multiline blocks (handles nested objects without false-ending)', () => {
    const block = findDatabaseBlock(CONFIG_MULTILINE_DATABASE);
    expect(block).not.toBeNull();
    const text = CONFIG_MULTILINE_DATABASE.slice(block?.start ?? 0, block?.end ?? 0);
    expect(text).toContain('postgres');
    expect(text).toContain('process.env.DATABASE_URL');
  });
});

describe('config-patcher — detectDialect', () => {
  test('returns current dialect when present', () => {
    expect(detectDialect(CONFIG_WITH_SQLITE)).toBe('sqlite');
    expect(detectDialect(CONFIG_MULTILINE_DATABASE)).toBe('postgres');
  });

  test('returns null when no block', () => {
    expect(detectDialect(CONFIG_WITHOUT_DATABASE)).toBeNull();
  });
});

describe('config-patcher — patchConfig', () => {
  test('no-op when the dialect already matches', () => {
    const result = patchConfig(CONFIG_WITH_SQLITE, 'sqlite');
    expect(result.status).toBe('already');
  });

  test('reports conflict when switching dialects on an existing block', () => {
    const result = patchConfig(CONFIG_WITH_SQLITE, 'postgres');
    expect(result.status).toBe('conflict');
    if (result.status === 'conflict') {
      expect(result.current).toBe('sqlite');
      expect(result.snippet).toContain('postgres');
    }
  });

  test('inserts a database block when missing, before the defineConfig close', () => {
    const result = patchConfig(CONFIG_WITHOUT_DATABASE, 'postgres');
    expect(result.status).toBe('inserted');
    if (result.status === 'inserted') {
      expect(result.updated).toContain(
        "database: { dialect: 'postgres', url: process.env.DATABASE_URL }",
      );
      // The new entry sits above the closing `});` line, preserving shape.
      const lines = result.updated.split('\n');
      const closeLine = lines.findIndex((l) => l.trim() === '});');
      const databaseLine = lines.findIndex((l) => l.includes('database:'));
      expect(databaseLine).toBeGreaterThanOrEqual(0);
      expect(databaseLine).toBeLessThan(closeLine);
    }
  });

  test('inserts sqlite block with file path, not URL', () => {
    const result = patchConfig(CONFIG_WITHOUT_DATABASE, 'sqlite');
    expect(result.status).toBe('inserted');
    if (result.status === 'inserted') {
      expect(result.updated).toContain("database: { dialect: 'sqlite', file: '.hopak/data.db' }");
    }
  });

  test('cant-patch when defineConfig shape is unrecognized', () => {
    const weird = "export default 'not a defineConfig call'";
    const result = patchConfig(weird, 'postgres');
    expect(result.status).toBe('cant-patch');
  });
});

describe('config-patcher — buildDatabaseBlock', () => {
  test('sqlite shape uses file, not URL', () => {
    expect(buildDatabaseBlock('sqlite')).toBe(
      "database: { dialect: 'sqlite', file: '.hopak/data.db' }",
    );
  });

  test('postgres / mysql shapes use process.env.DATABASE_URL', () => {
    expect(buildDatabaseBlock('postgres')).toBe(
      "database: { dialect: 'postgres', url: process.env.DATABASE_URL }",
    );
    expect(buildDatabaseBlock('mysql')).toBe(
      "database: { dialect: 'mysql', url: process.env.DATABASE_URL }",
    );
  });
});

describe('env-patcher', () => {
  test('appends DATABASE_URL for postgres when missing', () => {
    const result = patchEnvExample('# Add secrets here\n', 'postgres');
    expect(result).toContain('DATABASE_URL=postgres://');
  });

  test('appends DATABASE_URL for mysql when missing', () => {
    const result = patchEnvExample('', 'mysql');
    expect(result).toContain('DATABASE_URL=mysql://');
  });

  test('returns null (no change) when DATABASE_URL already present', () => {
    const existing = '# header\nDATABASE_URL=postgres://preset\n';
    expect(patchEnvExample(existing, 'postgres')).toBeNull();
  });

  test('returns null for sqlite (no URL required)', () => {
    expect(patchEnvExample('', 'sqlite')).toBeNull();
  });

  test('ensures trailing newline even if the source lacked one', () => {
    const result = patchEnvExample('# header', 'postgres');
    expect(result?.endsWith('\n')).toBe(true);
    expect(result).toContain('# header\n');
  });
});
