import { ConfigError, type DbDialect } from '@hopak/common';
import type { ModelDefinition } from '../model/define';
import type { Database } from './client';
import { createMysqlDatabase } from './mysql';
import { createPostgresDatabase } from './postgres';
import { createSqliteDatabase } from './sqlite';

export interface CreateDatabaseOptions {
  dialect: DbDialect;
  models: readonly ModelDefinition[];
  url?: string;
  file?: string;
}

type DialectFactory = (options: CreateDatabaseOptions) => Database;

const DIALECT_FACTORIES: Record<DbDialect, DialectFactory> = {
  sqlite: ({ models, file }) => createSqliteDatabase({ models, file }),
  postgres: ({ models, url }) => createPostgresDatabase({ models, url }),
  mysql: ({ models, url }) => createMysqlDatabase({ models, url }),
};

export function createDatabase(options: CreateDatabaseOptions): Database {
  const factory = DIALECT_FACTORIES[options.dialect];
  if (!factory) {
    throw new ConfigError(`Unknown database dialect: ${String(options.dialect)}`);
  }
  return factory(options);
}
