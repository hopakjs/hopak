import type { ModelDefinition } from '../model/define';

function excludedFields(model: ModelDefinition): ReadonlySet<string> {
  const set = new Set<string>();
  for (const [name, field] of Object.entries(model.fields)) {
    if (field.excludeFromJson) set.add(name);
  }
  return set;
}

function omit<T extends Record<string, unknown>>(
  value: T,
  excluded: ReadonlySet<string>,
): Record<string, unknown> {
  if (excluded.size === 0) return value;
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (!excluded.has(key)) result[key] = val;
  }
  return result;
}

export function serializeForResponse<T extends Record<string, unknown>>(
  value: T,
  model: ModelDefinition,
): Record<string, unknown> {
  return omit(value, excludedFields(model));
}

export function serializeListForResponse<T extends Record<string, unknown>>(
  rows: readonly T[],
  model: ModelDefinition,
): Record<string, unknown>[] {
  const excluded = excludedFields(model);
  return rows.map((row) => omit(row, excluded));
}
