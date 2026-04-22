import type { DbDialect } from '@hopak/common';
import { pluralize } from '@hopak/common';
import { buildCreateTableSql as buildMysqlCreateTableSql } from '../db/mysql/sync';
import { ops as mysqlOps } from '../db/mysql/sync';
import { buildCreateTableSql as buildPostgresCreateTableSql } from '../db/postgres/sync';
import { ops as postgresOps } from '../db/postgres/sync';
import { buildIndexStatements } from '../db/sql/ddl-emitter';
import { orderByFkDependencies } from '../db/sql/ddl-emitter';
import { buildCreateTableSql as buildSqliteCreateTableSql } from '../db/sqlite/sync';
import { ops as sqliteOps } from '../db/sqlite/sync';
import type { ModelDefinition } from '../model/define';
import { renderMigrationTemplate } from './template';

/**
 * Render the initial migration body for a set of models. Produces the
 * same `CREATE TABLE` + `CREATE INDEX` statements that `db.sync()` would
 * have run, but inside a migration file that can be committed, reviewed,
 * and rolled back.
 *
 * Emits SQL for all three dialects — a branch on `ctx.dialect` picks the
 * right one at runtime. Users editing the file by hand can strip the
 * branches they don't need.
 */
export function renderInitMigration(models: readonly ModelDefinition[]): string {
  if (models.length === 0) {
    return renderMigrationTemplate({
      description: 'Initial schema',
      upBody: '  // No models found to materialise.',
      downBody: '  // No-op: there is nothing to drop.',
    });
  }

  const ordered = orderByFkDependencies(models);
  const sqliteUp = joinStatements(ordered, 'sqlite');
  const postgresUp = joinStatements(ordered, 'postgres');
  const mysqlUp = joinStatements(ordered, 'mysql');

  // down() drops tables in reverse order so FK targets live long enough.
  const drops = [...ordered]
    .reverse()
    .map((m) => pluralize(m.name))
    .map((t) => `  await ctx.execute(\`DROP TABLE IF EXISTS ${quoteForAll(t)}\`);`)
    .join('\n');

  const upBody = [
    `  if (ctx.dialect === 'sqlite') {`,
    indentStatements(sqliteUp, 4),
    `  } else if (ctx.dialect === 'postgres') {`,
    indentStatements(postgresUp, 4),
    '  } else {',
    indentStatements(mysqlUp, 4),
    '  }',
  ].join('\n');

  return renderMigrationTemplate({
    description: 'Initial schema',
    upBody,
    downBody: drops,
  });
}

function joinStatements(models: readonly ModelDefinition[], dialect: DbDialect): string[] {
  const stmts: string[] = [];
  for (const model of models) {
    stmts.push(buildCreate(model, dialect));
    for (const idx of buildIndexesFor(model, dialect)) stmts.push(idx);
  }
  return stmts;
}

function buildCreate(model: ModelDefinition, dialect: DbDialect): string {
  if (dialect === 'sqlite') return buildSqliteCreateTableSql(model);
  if (dialect === 'postgres') return buildPostgresCreateTableSql(model);
  return buildMysqlCreateTableSql(model);
}

function buildIndexesFor(model: ModelDefinition, dialect: DbDialect): readonly string[] {
  const ops = dialect === 'sqlite' ? sqliteOps : dialect === 'postgres' ? postgresOps : mysqlOps;
  return buildIndexStatements(model, ops);
}

function indentStatements(stmts: readonly string[], spaces: number): string {
  const pad = ' '.repeat(spaces);
  return stmts.map((s) => `${pad}await ctx.execute(\`${s.replace(/`/g, '\\`')}\`);`).join('\n');
}

/** For `DROP TABLE IF EXISTS X` — any dialect accepts unquoted unless the name has special chars. */
function quoteForAll(name: string): string {
  // Conservative: wrap in double-quotes. MySQL accepts `"x"` when `ANSI_QUOTES`
  // is on but that's not default — so drop quoting here and rely on the fact
  // that pluralized model names are safe identifiers.
  return name;
}
