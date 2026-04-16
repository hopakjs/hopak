import { ConfigError } from '@hopak/common';
import type { Database } from '../client';
import type { DialectOptions } from '../dialect';

export function createPostgresDatabase(_options: DialectOptions): Database {
  throw new ConfigError(
    'Postgres dialect is not yet implemented in MVP. Use SQLite for now: { dialect: "sqlite" }',
  );
}
