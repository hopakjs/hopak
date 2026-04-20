import type { MySqlColumnBuilderBase } from 'drizzle-orm/mysql-core';
import {
  boolean as mysqlBoolean,
  datetime as mysqlDatetime,
  double as mysqlDouble,
  int as mysqlInt,
  json as mysqlJson,
  text as mysqlText,
} from 'drizzle-orm/mysql-core';
import type { PgColumnBuilderBase } from 'drizzle-orm/pg-core';
import {
  boolean as pgBoolean,
  doublePrecision as pgDoublePrecision,
  integer as pgInteger,
  jsonb as pgJsonb,
  text as pgText,
  timestamp as pgTimestamp,
} from 'drizzle-orm/pg-core';
import { type SQLiteColumnBuilderBase, integer, real, text } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import type { FieldDefinition, FieldType } from './base';

type SqliteDdl = 'TEXT' | 'INTEGER' | 'REAL';
type PostgresDdl = 'TEXT' | 'INTEGER' | 'DOUBLE PRECISION' | 'BOOLEAN' | 'TIMESTAMPTZ' | 'JSONB';
type MysqlDdl = 'TEXT' | 'INT' | 'DOUBLE' | 'TINYINT(1)' | 'DATETIME(3)' | 'JSON';

type SqliteColumnFactory = (name: string) => SQLiteColumnBuilderBase;
type PostgresColumnFactory = (name: string) => PgColumnBuilderBase;
type MysqlColumnFactory = (name: string) => MySqlColumnBuilderBase;

type ZodFactory = (field: FieldDefinition) => z.ZodType | null;

interface DialectSlot<TDdl, TFactory> {
  readonly ddl: TDdl | null;
  readonly column: TFactory | null;
}

export interface FieldAdapter {
  readonly sqlite: DialectSlot<SqliteDdl, SqliteColumnFactory>;
  readonly postgres: DialectSlot<PostgresDdl, PostgresColumnFactory>;
  readonly mysql: DialectSlot<MysqlDdl, MysqlColumnFactory>;
  readonly zod: ZodFactory;
  readonly virtual?: boolean;
  readonly columnName?: (fieldName: string) => string;
}

const stringZod: ZodFactory = (field) => {
  let s = z.string();
  if (field.min !== undefined) s = s.min(field.min);
  if (field.max !== undefined) s = s.max(field.max);
  if (field.pattern) s = s.regex(new RegExp(field.pattern));
  return s;
};

const numberZod: ZodFactory = (field) => {
  let n = z.number();
  if (field.min !== undefined) n = n.min(field.min);
  if (field.max !== undefined) n = n.max(field.max);
  return n;
};

const fileZod: ZodFactory = () =>
  z.object({
    url: z.string(),
    mimeType: z.string(),
    size: z.number(),
    name: z.string().optional(),
  });

// `z.coerce.date()` silently passes `new Date("not-a-date")` (an Invalid Date
// object), and Zod's downstream check then emits the confusing
// "expected date, received Date" error. A custom schema below accepts
// ISO strings / timestamps / Date instances and fails fast with "Invalid date"
// on anything `new Date(...)` cannot parse.
const dateSchema = z.union([z.date(), z.string(), z.number()]).transform((value, ctx) => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: 'custom', message: 'Invalid date' });
    return z.NEVER;
  }
  return d;
});

const stringText: FieldAdapter = {
  sqlite: { ddl: 'TEXT', column: (name) => text(name) },
  postgres: { ddl: 'TEXT', column: (name) => pgText(name) },
  mysql: { ddl: 'TEXT', column: (name) => mysqlText(name) },
  zod: stringZod,
};

const numberInt: FieldAdapter = {
  sqlite: { ddl: 'INTEGER', column: (name) => integer(name) },
  postgres: { ddl: 'INTEGER', column: (name) => pgInteger(name) },
  mysql: { ddl: 'INT', column: (name) => mysqlInt(name) },
  zod: numberZod,
};

const numberReal: FieldAdapter = {
  sqlite: { ddl: 'REAL', column: (name) => real(name) },
  postgres: { ddl: 'DOUBLE PRECISION', column: (name) => pgDoublePrecision(name) },
  mysql: { ddl: 'DOUBLE', column: (name) => mysqlDouble(name) },
  zod: numberZod,
};

const booleanCol: FieldAdapter = {
  sqlite: { ddl: 'INTEGER', column: (name) => integer(name, { mode: 'boolean' }) },
  postgres: { ddl: 'BOOLEAN', column: (name) => pgBoolean(name) },
  mysql: { ddl: 'TINYINT(1)', column: (name) => mysqlBoolean(name) },
  zod: () => z.boolean(),
};

const dateCol: FieldAdapter = {
  sqlite: { ddl: 'INTEGER', column: (name) => integer(name, { mode: 'timestamp' }) },
  postgres: {
    ddl: 'TIMESTAMPTZ',
    column: (name) => pgTimestamp(name, { withTimezone: true, mode: 'date' }),
  },
  mysql: {
    ddl: 'DATETIME(3)',
    column: (name) => mysqlDatetime(name, { mode: 'date', fsp: 3 }),
  },
  zod: () => dateSchema,
};

const jsonCol: FieldAdapter = {
  sqlite: { ddl: 'TEXT', column: (name) => text(name, { mode: 'json' }) },
  postgres: { ddl: 'JSONB', column: (name) => pgJsonb(name) },
  mysql: { ddl: 'JSON', column: (name) => mysqlJson(name) },
  zod: () => z.unknown(),
};

const fileCol: FieldAdapter = {
  sqlite: { ddl: 'TEXT', column: (name) => text(name, { mode: 'json' }) },
  postgres: { ddl: 'JSONB', column: (name) => pgJsonb(name) },
  mysql: { ddl: 'JSON', column: (name) => mysqlJson(name) },
  zod: fileZod,
};

const virtualAdapter: FieldAdapter = {
  sqlite: { ddl: null, column: null },
  postgres: { ddl: null, column: null },
  mysql: { ddl: null, column: null },
  zod: () => null,
  virtual: true,
};

const ADAPTERS: Record<FieldType, FieldAdapter> = {
  text: stringText,
  phone: stringText,
  password: stringText,
  secret: stringText,
  token: stringText,
  email: {
    ...stringText,
    zod: (field) => (field.max !== undefined ? z.email().max(field.max) : z.email()),
  },
  url: {
    ...stringText,
    zod: (field) => (field.max !== undefined ? z.url().max(field.max) : z.url()),
  },
  enum: {
    ...stringText,
    zod: (field) => {
      const values = field.enumValues;
      if (!values || values.length === 0) return z.string();
      return z.enum(values as [string, ...string[]]);
    },
  },
  number: numberInt,
  money: numberReal,
  boolean: booleanCol,
  date: dateCol,
  timestamp: dateCol,
  json: jsonCol,
  file: fileCol,
  image: fileCol,
  belongsTo: {
    sqlite: { ddl: 'INTEGER', column: (name) => integer(name) },
    postgres: { ddl: 'INTEGER', column: (name) => pgInteger(name) },
    mysql: { ddl: 'INT', column: (name) => mysqlInt(name) },
    zod: () => z.union([z.number(), z.string()]),
    columnName: (fieldName) => `${fieldName}_id`,
  },
  hasMany: virtualAdapter,
  hasOne: virtualAdapter,
};

export function adapterFor(type: FieldType): FieldAdapter {
  const adapter = ADAPTERS[type];
  if (!adapter) {
    throw new Error(`No adapter registered for field type: ${type}`);
  }
  return adapter;
}

export function columnNameFor(fieldName: string, field: FieldDefinition): string {
  const adapter = adapterFor(field.type);
  return adapter.columnName ? adapter.columnName(fieldName) : fieldName;
}

export function isVirtual(field: FieldDefinition): boolean {
  return adapterFor(field.type).virtual === true;
}
