/**
 * Patches `hopak.config.ts` to add or replace the `database:` block.
 *
 * The parser is not a full TypeScript AST — it uses brace-counting to locate
 * the `database:` entry inside the `defineConfig({...})` literal, which is
 * robust enough for the config shape produced by `hopak new`. If the config
 * was hand-edited into an unusual form that can't be safely recognized, a
 * `cant-patch` result is returned with a snippet for the user to paste
 * manually.
 */

export type Dialect = 'sqlite' | 'postgres' | 'mysql';

export type PatchResult =
  | { status: 'already'; dialect: Dialect }
  | { status: 'conflict'; current: Dialect; snippet: string }
  | { status: 'inserted'; updated: string }
  | { status: 'replaced'; updated: string }
  | { status: 'cant-patch'; snippet: string };

export function buildDatabaseBlock(dialect: Dialect): string {
  if (dialect === 'sqlite') {
    return `database: { dialect: 'sqlite', file: '.hopak/data.db' }`;
  }
  return `database: { dialect: '${dialect}', url: process.env.DATABASE_URL }`;
}

/**
 * Find the `database:` key in an object literal and return the span covering
 * the whole `database: { ... }` entry (key through closing brace).
 * Brace-counts the value object so nested braces are handled correctly.
 */
export function findDatabaseBlock(source: string): { start: number; end: number } | null {
  const keyMatch = /(^|[\s,{])database\s*:\s*\{/.exec(source);
  if (!keyMatch || keyMatch[1] === undefined) return null;

  const keyStart = keyMatch.index + keyMatch[1].length;
  const openBrace = source.indexOf('{', keyMatch.index);
  if (openBrace < 0) return null;

  let depth = 1;
  let i = openBrace + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  if (depth !== 0) return null;
  return { start: keyStart, end: i };
}

/**
 * Read the `dialect: '<name>'` value inside a database block slice. Returns
 * `null` if the slice doesn't contain one, which is the signal that the
 * config was massaged in an unrecognizable way.
 */
export function currentDialectOf(blockText: string): Dialect | null {
  const match = /dialect\s*:\s*['"]([^'"]+)['"]/.exec(blockText);
  if (!match) return null;
  const v = match[1];
  if (v === 'sqlite' || v === 'postgres' || v === 'mysql') return v;
  return null;
}

/**
 * "No database block exists" case: find the closing `});` of the
 * `defineConfig` call and slot the new line just before it, preserving the
 * indentation of the closing line.
 */
function insertBlockBeforeClose(source: string, dialect: Dialect): string | null {
  const lastClose = source.lastIndexOf('});');
  if (lastClose < 0) return null;

  const lineStart = source.lastIndexOf('\n', lastClose) + 1;
  const closingLineIndent = source.slice(lineStart, lastClose).match(/^[ \t]*/)?.[0] ?? '';
  const entryIndent = `${closingLineIndent}  `;

  const newLine = `${entryIndent}${buildDatabaseBlock(dialect)},\n`;
  return source.slice(0, lineStart) + newLine + source.slice(lineStart);
}

export function patchConfig(source: string, dialect: Dialect): PatchResult {
  const block = findDatabaseBlock(source);

  if (block) {
    const blockText = source.slice(block.start, block.end);
    const current = currentDialectOf(blockText);
    if (!current) {
      return { status: 'cant-patch', snippet: buildDatabaseBlock(dialect) };
    }
    if (current === dialect) {
      return { status: 'already', dialect };
    }
    // Same key, different value. Automatic overwrite is refused — the old
    // block might carry tuning the user wrote (custom sqlite path, extra
    // URL params). The user copies the snippet manually.
    return { status: 'conflict', current, snippet: buildDatabaseBlock(dialect) };
  }

  const updated = insertBlockBeforeClose(source, dialect);
  if (updated === null) {
    return { status: 'cant-patch', snippet: buildDatabaseBlock(dialect) };
  }
  return { status: 'inserted', updated };
}

/**
 * Quick check: does the config already configure the given dialect? Used by
 * `hopak use` to detect no-op invocations before running the installer.
 */
export function detectDialect(source: string): Dialect | null {
  const block = findDatabaseBlock(source);
  if (!block) return null;
  return currentDialectOf(source.slice(block.start, block.end));
}
