import type { ModelDefinition } from '../model/define';

// Exclusion set per model is static — compute once, cache by model identity.
const EXCLUSION_CACHE = new WeakMap<ModelDefinition, ReadonlySet<string>>();

function excludedFields(model: ModelDefinition): ReadonlySet<string> {
  const cached = EXCLUSION_CACHE.get(model);
  if (cached) return cached;
  const set = new Set<string>();
  for (const name in model.fields) {
    if (model.fields[name]?.excludeFromJson) set.add(name);
  }
  EXCLUSION_CACHE.set(model, set);
  return set;
}

function omit<T extends Record<string, unknown>>(
  value: T,
  excluded: ReadonlySet<string>,
): Record<string, unknown> {
  if (excluded.size === 0) return value;
  const result: Record<string, unknown> = {};
  for (const key in value) {
    if (!excluded.has(key)) result[key] = value[key];
  }
  return result;
}

/**
 * Strip fields marked `excludeFromJson` (password / secret / token).
 * The return type keeps `T` for inference through CRUD handlers — the
 * stripped keys are absent at runtime even though the type retains them.
 */
export function serializeForResponse<T extends Record<string, unknown>>(
  value: T,
  model: ModelDefinition,
): T {
  return omit(value, excludedFields(model)) as T;
}

export function serializeListForResponse<T extends Record<string, unknown>>(
  rows: readonly T[],
  model: ModelDefinition,
): T[] {
  const excluded = excludedFields(model);
  if (excluded.size === 0) return rows as T[];
  return rows.map((row) => omit(row, excluded) as T);
}
