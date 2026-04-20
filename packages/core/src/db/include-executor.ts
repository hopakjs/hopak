/**
 * Resolves `findMany({ include })` by enriching the primary rows in place.
 *
 * **N+1 guarantee.** This module issues at most one query per top-level
 * include entry, regardless of how many primary rows were fetched.
 *
 *   - `belongsTo` — collects unique FK values, issues a single
 *     `WHERE id IN (...)` on the target, indexes the result, attaches.
 *   - `hasMany`  — collects primary IDs, issues a single
 *     `WHERE <fk> IN (...)` on the target, groups by FK, attaches as array.
 *   - `hasOne`   — same batch as `hasMany`, attaches the first match.
 *
 * Empty input short-circuits before the query. `null` / `undefined` FK
 * values are skipped so they don't inflate the `IN` list.
 *
 * The dialect is irrelevant: the executor only talks to the sibling
 * `ModelClient` through its public `findMany` — all SQL generation (filters,
 * ordering, limits) reuses the existing per-dialect machinery.
 */
import type { ModelDefinition } from '../model/define';
import type {
  FindManyOptions,
  IncludeClause,
  IncludeRelationOptions,
  ModelClient,
  WhereClause,
} from './client';

export type ResolveClient = (modelName: string) => ModelClient;

type MutableRow = Record<string, unknown>;

export async function executeInclude(
  primaryModel: ModelDefinition,
  primaryRows: MutableRow[],
  include: IncludeClause,
  allModels: readonly ModelDefinition[],
  resolveClient: ResolveClient,
): Promise<void> {
  if (primaryRows.length === 0) return;

  for (const [relationName, rawOpts] of Object.entries(include)) {
    if (rawOpts == null) continue;
    const field = primaryModel.fields[relationName];
    if (!field) {
      throw new Error(`Cannot include "${relationName}" on "${primaryModel.name}": no such field.`);
    }
    if (field.type !== 'belongsTo' && field.type !== 'hasMany' && field.type !== 'hasOne') {
      throw new Error(
        `Cannot include "${relationName}" on "${primaryModel.name}": field is not a relation (type: ${field.type}).`,
      );
    }
    const targetName = field.relationTarget;
    if (!targetName) {
      throw new Error(
        `Relation field "${relationName}" on "${primaryModel.name}" has no relationTarget.`,
      );
    }
    const targetModel = allModels.find((m) => m.name === targetName);
    if (!targetModel) {
      throw new Error(
        `Cannot include "${relationName}": target model "${targetName}" is not registered.`,
      );
    }

    const nested: IncludeRelationOptions = rawOpts === true ? {} : rawOpts;
    const targetClient = resolveClient(targetName);
    const excluded = sensitiveFieldsOf(targetModel);

    if (field.type === 'belongsTo') {
      await loadBelongsTo(relationName, primaryRows, targetClient, nested, excluded);
    } else {
      const fkField = findInverseBelongsTo(targetModel, primaryModel.name, relationName);
      if (field.type === 'hasMany') {
        await loadHasMany(relationName, fkField, primaryRows, targetClient, nested, excluded);
      } else {
        await loadHasOne(relationName, fkField, primaryRows, targetClient, nested, excluded);
      }
    }
  }
}

function sensitiveFieldsOf(model: ModelDefinition): ReadonlySet<string> {
  const set = new Set<string>();
  for (const [name, field] of Object.entries(model.fields)) {
    if (field.excludeFromJson) set.add(name);
  }
  return set;
}

function stripSensitiveInPlace(rows: MutableRow[], excluded: ReadonlySet<string>): void {
  if (excluded.size === 0) return;
  for (const row of rows) {
    for (const key of excluded) {
      if (key in row) delete row[key];
    }
  }
}

async function loadBelongsTo(
  relationName: string,
  primaryRows: MutableRow[],
  targetClient: ModelClient,
  nested: IncludeRelationOptions,
  excluded: ReadonlySet<string>,
): Promise<void> {
  const fkValues = new Set<unknown>();
  for (const row of primaryRows) {
    const v = row[relationName];
    if (v !== null && v !== undefined) fkValues.add(v);
  }

  if (fkValues.size === 0) {
    for (const row of primaryRows) row[relationName] = null;
    return;
  }

  const where = mergeWhere({ id: { in: Array.from(fkValues) } }, nested.where);
  const options: FindManyOptions = { ...nested, where };
  const parents = (await targetClient.findMany(options)) as MutableRow[];
  stripSensitiveInPlace(parents, excluded);

  const index = new Map<unknown, MutableRow>();
  for (const parent of parents) index.set(parent.id, parent);

  for (const row of primaryRows) {
    const fk = row[relationName];
    row[relationName] = fk !== null && fk !== undefined ? (index.get(fk) ?? null) : null;
  }
}

async function loadHasMany(
  relationName: string,
  fkField: string,
  primaryRows: MutableRow[],
  targetClient: ModelClient,
  nested: IncludeRelationOptions,
  excluded: ReadonlySet<string>,
): Promise<void> {
  const primaryIds = collectIds(primaryRows);
  if (primaryIds.length === 0) {
    for (const row of primaryRows) row[relationName] = [];
    return;
  }

  const where = mergeWhere({ [fkField]: { in: primaryIds } }, nested.where);
  const options: FindManyOptions = { ...nested, where };
  const children = (await targetClient.findMany(options)) as MutableRow[];
  stripSensitiveInPlace(children, excluded);

  const groups = new Map<unknown, MutableRow[]>();
  for (const child of children) {
    const key = child[fkField];
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(child);
  }

  for (const row of primaryRows) {
    row[relationName] = groups.get(row.id) ?? [];
  }
}

async function loadHasOne(
  relationName: string,
  fkField: string,
  primaryRows: MutableRow[],
  targetClient: ModelClient,
  nested: IncludeRelationOptions,
  excluded: ReadonlySet<string>,
): Promise<void> {
  const primaryIds = collectIds(primaryRows);
  if (primaryIds.length === 0) {
    for (const row of primaryRows) row[relationName] = null;
    return;
  }

  const where = mergeWhere({ [fkField]: { in: primaryIds } }, nested.where);
  const options: FindManyOptions = { ...nested, where };
  const children = (await targetClient.findMany(options)) as MutableRow[];
  stripSensitiveInPlace(children, excluded);

  const index = new Map<unknown, MutableRow>();
  for (const child of children) {
    // First-match wins — if the target has multiple children per parent
    // despite `hasOne`, the first one the query returned is kept. Ordering
    // is controlled by the caller via `include.orderBy`.
    const key = child[fkField];
    if (!index.has(key)) index.set(key, child);
  }

  for (const row of primaryRows) {
    row[relationName] = index.get(row.id) ?? null;
  }
}

function collectIds(rows: MutableRow[]): unknown[] {
  const seen = new Set<unknown>();
  for (const row of rows) {
    const id = row.id;
    if (id !== null && id !== undefined) seen.add(id);
  }
  return Array.from(seen);
}

/**
 * Combine the system-imposed filter with the caller's nested `where`.
 * Top-level spread would let the caller accidentally override the FK filter
 * (e.g. by writing their own `id` constraint on a `belongsTo` include), so
 * both are always nested under `AND` — the filter translator interprets
 * that as a conjunction of both clauses.
 */
function mergeWhere(system: WhereClause, user: WhereClause | undefined): WhereClause {
  if (!user) return system;
  return { AND: [system, user] };
}

/**
 * For `hasMany` / `hasOne`, locate the single `belongsTo(<parentName>)`
 * field on the target model. Throws with a friendly message when zero or
 * multiple candidates exist — that disambiguation isn't supported in 0.1.0.
 */
function findInverseBelongsTo(
  target: ModelDefinition,
  parentName: string,
  relationName: string,
): string {
  const matches: string[] = [];
  for (const [name, fieldDef] of Object.entries(target.fields)) {
    if (fieldDef.type === 'belongsTo' && fieldDef.relationTarget === parentName) {
      matches.push(name);
    }
  }
  if (matches.length === 0) {
    throw new Error(
      `Cannot include "${relationName}": "${target.name}" has no belongsTo("${parentName}"). ` +
        `Add a belongsTo field pointing to "${parentName}" on "${target.name}".`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Cannot include "${relationName}": "${target.name}" has multiple belongsTo("${parentName}") ` +
        `(${matches.join(', ')}). Explicit disambiguation is not yet supported in 0.1.0.`,
    );
  }
  return matches[0] as string;
}
