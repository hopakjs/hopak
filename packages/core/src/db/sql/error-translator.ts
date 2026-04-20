import { Conflict } from '@hopak/common';

/**
 * Translate driver-level UNIQUE constraint failures into a `Conflict` (409).
 * Any other error is re-thrown unchanged so the server error handler still
 * surfaces it as a 500 with proper logging.
 *
 *   - SQLite (bun:sqlite): `error.code` starts with `SQLITE_CONSTRAINT`;
 *     `error.message` contains "UNIQUE constraint failed:".
 *   - Postgres (postgres.js): `error.code === '23505'` (unique_violation).
 *   - MySQL (mysql2): `error.code === 'ER_DUP_ENTRY'` or `error.errno === 1062`.
 *
 * The three dialects report the offending column in different shapes (SQLite
 * in the message, Postgres in `detail`, MySQL in `sqlMessage`). For the 0.1.x
 * line we surface a stable, generic `Conflict` — callers who need the
 * specific column should do their own pre-check.
 */
export async function withUniqueToConflict<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Conflict('Unique constraint violated');
    }
    throw error;
  }
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: unknown; errno?: unknown; message?: unknown };

  if (err.code === '23505') return true;
  if (err.code === 'ER_DUP_ENTRY') return true;
  if (err.errno === 1062) return true;
  if (typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
    if (typeof err.message === 'string' && err.message.includes('UNIQUE constraint failed')) {
      return true;
    }
  }
  if (typeof err.message === 'string' && err.message.includes('UNIQUE constraint failed')) {
    return true;
  }
  return false;
}
