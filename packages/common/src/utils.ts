export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function pluralize(word: string): string {
  if (word.endsWith('y') && !/[aeiou]y$/.test(word)) {
    return `${word.slice(0, -1)}ies`;
  }
  if (/(s|x|z|ch|sh)$/.test(word)) {
    return `${word}es`;
  }
  return `${word}s`;
}

const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(input: string): number {
  const match = input.trim().match(/^(\d+)\s*(ms|s|m|h|d)$/i);
  if (!match) {
    throw new Error(`Invalid duration: ${input}. Expected formats: 100ms, 5s, 10m, 1h, 7d`);
  }
  // Groups are guaranteed by the pattern; `noUncheckedIndexedAccess` forces
  // the tuple cast, and the same holds for the unit lookup.
  const [, amount, unit] = match as unknown as [string, string, string];
  return Number(amount) * (DURATION_UNITS[unit.toLowerCase()] as number);
}

export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursively merges `source` into `target`, returning a new value of type `T`.
 * Only plain objects are merged; arrays and primitives in `source` replace the
 * corresponding value in `target`. `undefined` values in `source` are ignored.
 */
export function deepMerge<T>(target: T, source: DeepPartial<T> | undefined): T {
  if (!isPlainObject(target) || !isPlainObject(source)) return target;
  const result: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const existing = result[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = deepMerge(existing, value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}
