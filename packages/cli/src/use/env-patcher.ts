/**
 * Ensures `.env.example` has a DATABASE_URL line for Postgres / MySQL.
 * Pure string operation — caller reads the file and writes the result.
 * Never removes existing entries; idempotent.
 */
import type { Dialect } from './config-patcher';

export function exampleUrlFor(dialect: Dialect): string | null {
  if (dialect === 'postgres') return 'postgres://user:pass@localhost:5432/myapp';
  if (dialect === 'mysql') return 'mysql://user:pass@localhost:3306/myapp';
  return null;
}

/**
 * Returns the updated file contents, or `null` if no change was needed
 * (line already present) or applicable (sqlite). Callers should skip the
 * write when the return is null.
 */
export function patchEnvExample(source: string, dialect: Dialect): string | null {
  const example = exampleUrlFor(dialect);
  if (!example) return null;
  if (/^DATABASE_URL\s*=/m.test(source)) return null;

  const trimmed = source.endsWith('\n') ? source : `${source}\n`;
  return `${trimmed}DATABASE_URL=${example}\n`;
}
