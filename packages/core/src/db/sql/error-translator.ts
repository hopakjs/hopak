import { Conflict } from '@hopak/common';

/**
 * Drizzle wraps every driver error in a plain `Error` whose message is
 * "Failed query: INSERT ..." — the original `code`, `errno`, and
 * `sqlState` sit on `.cause` (the original driver error). Anything that
 * walks the error shape has to unwrap that chain, or UNIQUE violations
 * on Postgres / MySQL sail through as 500s.
 */
function unwrap(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let cur: unknown = error;
  let depth = 0;
  while (cur && depth < 5) {
    chain.push(cur);
    const c = (cur as { cause?: unknown }).cause;
    if (!c || c === cur) break;
    cur = c;
    depth += 1;
  }
  return chain;
}

/** True if any error in the chain is a UNIQUE / duplicate-key violation. */
export function isUniqueViolation(error: unknown): boolean {
  for (const node of unwrap(error)) {
    if (!node || typeof node !== 'object') continue;
    const err = node as { code?: unknown; errno?: unknown; message?: unknown };

    // Postgres: 23505 (unique_violation).
    if (err.code === '23505') return true;
    // MySQL: ER_DUP_ENTRY / 1062.
    if (err.code === 'ER_DUP_ENTRY') return true;
    if (err.errno === 1062) return true;
    // SQLite (bun:sqlite).
    if (typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
      if (typeof err.message === 'string' && err.message.includes('UNIQUE constraint failed')) {
        return true;
      }
    }
    // Message fallback — catches both SQLite's "UNIQUE constraint failed"
    // and Drizzle-wrapped errors where the original message survives as
    // part of the stack (MySQL: "Duplicate entry", Postgres: "duplicate
    // key value violates unique constraint").
    if (typeof err.message === 'string') {
      if (err.message.includes('UNIQUE constraint failed')) return true;
      if (err.message.includes('Duplicate entry')) return true;
      if (err.message.includes('duplicate key value violates unique constraint')) return true;
    }
  }
  return false;
}

/** True if any error in the chain is a FK / referential-integrity failure. */
export function isForeignKeyViolation(error: unknown): boolean {
  for (const node of unwrap(error)) {
    if (!node || typeof node !== 'object') continue;
    const err = node as { code?: unknown; errno?: unknown; message?: unknown };

    // Postgres: 23503 (foreign_key_violation).
    if (err.code === '23503') return true;
    // MySQL: ER_NO_REFERENCED_ROW_2 (1452), ER_ROW_IS_REFERENCED_2 (1451).
    if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2') return true;
    if (err.errno === 1451 || err.errno === 1452) return true;
    // SQLite (when FKs are enforced — opt-in via PRAGMA):
    if (typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
      if (
        typeof err.message === 'string' &&
        err.message.includes('FOREIGN KEY constraint failed')
      ) {
        return true;
      }
    }
    if (typeof err.message === 'string') {
      if (err.message.includes('FOREIGN KEY constraint failed')) return true;
      if (err.message.includes('violates foreign key constraint')) return true;
      if (err.message.includes('a foreign key constraint fails')) return true;
    }
  }
  return false;
}

/**
 * Wrap a write path so that driver-level constraint errors become
 * friendly HTTP errors (`409 Conflict`). FK and UNIQUE both land as
 * `Conflict` — they're indistinguishable from the client's point of
 * view: "the shape's valid, but the DB won't let me do this right
 * now". The message differs so it's still useful in logs.
 */
export async function withUniqueToConflict<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Conflict('Unique constraint violated');
    }
    if (isForeignKeyViolation(error)) {
      throw new Conflict('Foreign key constraint violated');
    }
    throw error;
  }
}
