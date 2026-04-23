/**
 * Compile a tagged-template SQL expression into a parameterised statement.
 * Interpolations become driver-specific placeholders — `?` for SQLite and
 * MySQL, `$N` for Postgres. Values are never inlined into the SQL text, so
 * injection via `${...}` is fundamentally impossible.
 *
 * Pure function, no driver dependency, no Drizzle dependency.
 */

export interface CompiledSql {
  readonly text: string;
  readonly bindings: readonly unknown[];
}

export type PlaceholderStyle = 'question' | 'numbered';

export function compileTag(
  strings: TemplateStringsArray,
  values: readonly unknown[],
  style: PlaceholderStyle,
): CompiledSql {
  let text = strings[0] ?? '';
  for (let i = 0; i < values.length; i += 1) {
    text += style === 'numbered' ? `$${i + 1}` : '?';
    text += strings[i + 1] ?? '';
  }
  return { text, bindings: values };
}
