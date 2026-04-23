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
import * as v from 'valibot';
import type { FieldDefinition, FieldType } from './base';

type SqliteDdl = 'TEXT' | 'INTEGER' | 'REAL';
type PostgresDdl = 'TEXT' | 'INTEGER' | 'DOUBLE PRECISION' | 'BOOLEAN' | 'TIMESTAMPTZ' | 'JSONB';
type MysqlDdl = 'TEXT' | 'INT' | 'DOUBLE' | 'TINYINT(1)' | 'DATETIME(3)' | 'JSON';

type SqliteColumnFactory = (name: string) => SQLiteColumnBuilderBase;
type PostgresColumnFactory = (name: string) => PgColumnBuilderBase;
type MysqlColumnFactory = (name: string) => MySqlColumnBuilderBase;

type SchemaFactory = (field: FieldDefinition) => v.GenericSchema | null;

// Valibot's `pipe` has fixed-arity overloads, so a dynamic spread
// doesn't type-check. This assertion keeps the variadic builder usable.
type VariadicPipe = <T>(
  schema: v.BaseSchema<T, T, v.BaseIssue<unknown>>,
  ...items: v.PipeItem<T, T, v.BaseIssue<unknown>>[]
) => v.GenericSchema;
const pipe = v.pipe as unknown as VariadicPipe;

interface DialectSlot<TDdl, TFactory> {
  readonly ddl: TDdl | null;
  readonly column: TFactory | null;
}

export interface FieldAdapter {
  readonly sqlite: DialectSlot<SqliteDdl, SqliteColumnFactory>;
  readonly postgres: DialectSlot<PostgresDdl, PostgresColumnFactory>;
  readonly mysql: DialectSlot<MysqlDdl, MysqlColumnFactory>;
  readonly schema: SchemaFactory;
  readonly virtual?: boolean;
  readonly columnName?: (fieldName: string) => string;
}

const stringSchema: SchemaFactory = (field) => {
  const actions: v.PipeItem<string, string, v.BaseIssue<unknown>>[] = [];
  if (field.min !== undefined) actions.push(v.minLength(field.min));
  if (field.max !== undefined) actions.push(v.maxLength(field.max));
  if (field.pattern) actions.push(v.regex(new RegExp(field.pattern)));
  return actions.length === 0 ? v.string() : pipe<string>(v.string(), ...actions);
};

const numberSchema: SchemaFactory = (field) => {
  const actions: v.PipeItem<number, number, v.BaseIssue<unknown>>[] = [];
  if (field.min !== undefined) actions.push(v.minValue(field.min));
  if (field.max !== undefined) actions.push(v.maxValue(field.max));
  return actions.length === 0 ? v.number() : pipe<number>(v.number(), ...actions);
};

const fileMetaSchema = v.object({
  url: v.string(),
  mimeType: v.string(),
  size: v.number(),
  name: v.optional(v.string()),
});

type FileMetaOutput = v.InferOutput<typeof fileMetaSchema>;

const fileSchema: SchemaFactory = (field) => {
  // Respect `.maxSize(...)` declared on file()/image() fields.
  if (field.max !== undefined) {
    const limit = field.max;
    return v.pipe(
      fileMetaSchema,
      v.check(
        (m: FileMetaOutput) => m.size <= limit,
        `File exceeds maximum size of ${limit} bytes`,
      ),
    );
  }
  return fileMetaSchema;
};

// `new Date("not-a-date")` returns an Invalid Date object, so a plain
// coerce-to-Date path silently passes junk strings. Accept ISO strings,
// timestamps, and Date instances; reject anything that can't parse.
const dateSchema: v.GenericSchema = v.pipe(
  v.union([v.date(), v.string(), v.number()]),
  v.transform((value) => (value instanceof Date ? value : new Date(value as string | number))),
  v.check((d: Date) => !Number.isNaN(d.getTime()), 'Invalid date'),
);

const stringText: FieldAdapter = {
  sqlite: { ddl: 'TEXT', column: (name) => text(name) },
  postgres: { ddl: 'TEXT', column: (name) => pgText(name) },
  mysql: { ddl: 'TEXT', column: (name) => mysqlText(name) },
  schema: stringSchema,
};

const numberInt: FieldAdapter = {
  sqlite: { ddl: 'INTEGER', column: (name) => integer(name) },
  postgres: { ddl: 'INTEGER', column: (name) => pgInteger(name) },
  mysql: { ddl: 'INT', column: (name) => mysqlInt(name) },
  schema: numberSchema,
};

const numberReal: FieldAdapter = {
  sqlite: { ddl: 'REAL', column: (name) => real(name) },
  postgres: { ddl: 'DOUBLE PRECISION', column: (name) => pgDoublePrecision(name) },
  mysql: { ddl: 'DOUBLE', column: (name) => mysqlDouble(name) },
  schema: numberSchema,
};

const booleanCol: FieldAdapter = {
  sqlite: { ddl: 'INTEGER', column: (name) => integer(name, { mode: 'boolean' }) },
  postgres: { ddl: 'BOOLEAN', column: (name) => pgBoolean(name) },
  mysql: { ddl: 'TINYINT(1)', column: (name) => mysqlBoolean(name) },
  schema: () => v.boolean(),
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
  schema: () => dateSchema,
};

const jsonCol: FieldAdapter = {
  sqlite: { ddl: 'TEXT', column: (name) => text(name, { mode: 'json' }) },
  postgres: { ddl: 'JSONB', column: (name) => pgJsonb(name) },
  mysql: { ddl: 'JSON', column: (name) => mysqlJson(name) },
  schema: () => v.unknown(),
};

const fileCol: FieldAdapter = {
  sqlite: { ddl: 'TEXT', column: (name) => text(name, { mode: 'json' }) },
  postgres: { ddl: 'JSONB', column: (name) => pgJsonb(name) },
  mysql: { ddl: 'JSON', column: (name) => mysqlJson(name) },
  schema: fileSchema,
};

const virtualAdapter: FieldAdapter = {
  sqlite: { ddl: null, column: null },
  postgres: { ddl: null, column: null },
  mysql: { ddl: null, column: null },
  schema: () => null,
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
    schema: (field) =>
      field.max !== undefined
        ? v.pipe(v.string(), v.email(), v.maxLength(field.max))
        : v.pipe(v.string(), v.email()),
  },
  url: {
    ...stringText,
    schema: (field) =>
      field.max !== undefined
        ? v.pipe(v.string(), v.url(), v.maxLength(field.max))
        : v.pipe(v.string(), v.url()),
  },
  enum: {
    ...stringText,
    schema: (field) => {
      const values = field.enumValues;
      if (!values || values.length === 0) return v.string();
      return v.picklist(values as readonly [string, ...string[]]);
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
    schema: () => v.union([v.number(), v.string()]),
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
