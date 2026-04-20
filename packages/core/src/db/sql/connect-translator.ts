import { ConfigError } from '@hopak/common';
import type { DbDialect } from '@hopak/common';

/**
 * Translate driver-level connection errors into a `ConfigError` whose
 * `.message` reads like something a framework wrote, not a leaked stack
 * trace. Hopak's identity rule: the user-facing surface speaks as Hopak,
 * never the underlying driver.
 *
 * Known codes:
 *   - `ECONNREFUSED`            — host:port unreachable
 *   - `ENOTFOUND`               — DNS failure on the host
 *   - `28P01` / `ER_ACCESS_DENIED_ERROR` (1045) — auth failed
 *   - `3D000` / `ER_BAD_DB_ERROR` (1049) — database does not exist
 */
export function translateConnectError(error: unknown, dialect: DbDialect, url?: string): Error {
  if (error instanceof ConfigError) return error;
  if (!error || typeof error !== 'object') return error as Error;

  const err = error as { code?: unknown; errno?: unknown; message?: unknown };
  const code = typeof err.code === 'string' ? err.code : undefined;
  const errno = typeof err.errno === 'number' ? err.errno : undefined;
  const where = url ? ` (${redact(url)})` : '';

  if (code === 'ECONNREFUSED') {
    return new ConfigError(
      `Cannot reach the ${dialect} server${where}. Is it running and reachable on this host:port?`,
    );
  }
  if (code === 'ENOTFOUND') {
    return new ConfigError(
      `Cannot resolve the ${dialect} host${where}. Double-check DATABASE_URL.`,
    );
  }
  if (code === 'ETIMEDOUT') {
    return new ConfigError(
      `Timed out connecting to the ${dialect} server${where}. Check network / firewall.`,
    );
  }
  if (code === '28P01' || errno === 1045 || code === 'ER_ACCESS_DENIED_ERROR') {
    return new ConfigError(`Authentication failed for the ${dialect} server${where}.`);
  }
  if (code === '3D000' || errno === 1049 || code === 'ER_BAD_DB_ERROR') {
    const howToCreate = dialect === 'postgres' ? '`createdb <name>`' : '`CREATE DATABASE <name>`';
    return new ConfigError(
      `The target ${dialect} database does not exist${where}. Create it (e.g. ${howToCreate}) and try again.`,
    );
  }

  return error as Error;
}

function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.username) u.username = '***';
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return url;
  }
}
