import { type SQLiteColumnBuilderBase, integer, real, text } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import type { FieldDefinition, FieldType } from './base';

type SqliteColumnFactory = (name: string) => SQLiteColumnBuilderBase;
type SqliteSqlClass = 'TEXT' | 'INTEGER' | 'REAL';
type ZodFactory = (field: FieldDefinition) => z.ZodType | null;

export interface FieldAdapter {
  /** Underlying SQL storage class for raw DDL emission. */
  readonly sqliteClass: SqliteSqlClass | null;
  /** Drizzle column builder factory. */
  readonly drizzleColumn: SqliteColumnFactory | null;
  /** Zod base schema (modifiers like min/max applied separately). */
  readonly zod: ZodFactory;
  /** When true, the field is virtual — it produces no column in storage. */
  readonly virtual?: boolean;
  /** Override for the column name (e.g. belongsTo appends `_id`). */
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

const stringText: FieldAdapter = {
  sqliteClass: 'TEXT',
  drizzleColumn: (name) => text(name),
  zod: stringZod,
};

const numberInt: FieldAdapter = {
  sqliteClass: 'INTEGER',
  drizzleColumn: (name) => integer(name),
  zod: numberZod,
};

const numberReal: FieldAdapter = {
  sqliteClass: 'REAL',
  drizzleColumn: (name) => real(name),
  zod: numberZod,
};

const booleanInt: FieldAdapter = {
  sqliteClass: 'INTEGER',
  drizzleColumn: (name) => integer(name, { mode: 'boolean' }),
  zod: () => z.boolean(),
};

const dateInt: FieldAdapter = {
  sqliteClass: 'INTEGER',
  drizzleColumn: (name) => integer(name, { mode: 'timestamp' }),
  zod: () => z.coerce.date(),
};

const jsonText: FieldAdapter = {
  sqliteClass: 'TEXT',
  drizzleColumn: (name) => text(name, { mode: 'json' }),
  zod: () => z.unknown(),
};

const fileJson: FieldAdapter = {
  sqliteClass: 'TEXT',
  drizzleColumn: (name) => text(name, { mode: 'json' }),
  zod: fileZod,
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
  boolean: booleanInt,
  date: dateInt,
  timestamp: dateInt,
  json: jsonText,
  file: fileJson,
  image: fileJson,
  belongsTo: {
    sqliteClass: 'INTEGER',
    drizzleColumn: (name) => integer(name),
    zod: () => z.union([z.number(), z.string()]),
    columnName: (fieldName) => `${fieldName}_id`,
  },
  hasMany: { sqliteClass: null, drizzleColumn: null, zod: () => null, virtual: true },
  hasOne: { sqliteClass: null, drizzleColumn: null, zod: () => null, virtual: true },
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
