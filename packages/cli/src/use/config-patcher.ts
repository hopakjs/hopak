/**
 * Patches `hopak.config.ts` to add or replace the `database:` block.
 *
 * The parser is not a full TypeScript AST — it uses brace-counting to locate
 * the `database:` entry inside the `defineConfig({...})` literal, which is
 * robust enough for the config shape produced by `hopak new`. If the config
 * was hand-edited into an unusual form that can't be safely recognized, a
 * `cant-patch` result is returned with a snippet for the user to paste
 * manually.
 *
 * Replacement policy for an existing `database:` block:
 *   - Same dialect already in place → `already` (no-op).
 *   - Different dialect AND the existing block looks like a bare default
 *     from `hopak new` (e.g. `{ dialect: 'sqlite', file: '.hopak/data.db' }`)
 *     → `replaced`: it's safe to swap because the user didn't add tuning.
 *   - Different dialect AND the block carries extra keys or a customized
 *     value (a non-default sqlite path, extra URL params, an `ssl` object)
 *     → `conflict`: print snippet, don't touch the file.
 */

export type Dialect = 'sqlite' | 'postgres' | 'mysql';

export type PatchResult =
  | { status: 'already'; dialect: Dialect }
  | { status: 'conflict'; current: Dialect; snippet: string }
  | { status: 'inserted'; updated: string }
  | { status: 'replaced'; updated: string; previous: Dialect }
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
 * Returns true if the block is a "bare default" — the exact shape `hopak new`
 * ships or the exact shape `hopak use <dialect>` writes, with no extra keys
 * or customized values. Such blocks are safe to replace automatically.
 */
export function isBareDefaultBlock(blockText: string, current: Dialect): boolean {
  // Everything between the first `{` and the last `}`.
  const openBrace = blockText.indexOf('{');
  const closeBrace = blockText.lastIndexOf('}');
  if (openBrace < 0 || closeBrace <= openBrace) return false;
  const inner = blockText.slice(openBrace + 1, closeBrace);

  // Collect property keys present. Only simple `key:` entries at depth 0.
  const keys = collectTopLevelKeys(inner);
  if (keys === null) return false;

  if (current === 'sqlite') {
    // Either `{ dialect: 'sqlite' }` or the template default
    // `{ dialect: 'sqlite', file: '.hopak/data.db' }`.
    if (keys.length === 1 && keys[0] === 'dialect') return true;
    if (keys.length === 2 && keys.includes('dialect') && keys.includes('file')) {
      const fileMatch = /file\s*:\s*['"]([^'"]+)['"]/.exec(inner);
      return fileMatch?.[1] === '.hopak/data.db';
    }
    return false;
  }

  // postgres / mysql: the default shape `{ dialect, url: process.env.DATABASE_URL }`.
  if (keys.length === 1 && keys[0] === 'dialect') return true;
  if (keys.length === 2 && keys.includes('dialect') && keys.includes('url')) {
    return /url\s*:\s*process\.env\.DATABASE_URL\b/.test(inner);
  }
  return false;
}

/**
 * Return the list of top-level property keys in the interior of an object
 * literal, or `null` if the interior couldn't be scanned confidently (e.g.
 * contains something the simple walker doesn't understand).
 */
function collectTopLevelKeys(inner: string): string[] | null {
  const keys: string[] = [];
  let depth = 0;
  let i = 0;
  // Iterate character by character, collecting identifiers that appear at
  // depth 0 immediately before a `:`.
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '{' || ch === '[' || ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      // Skip strings (including escaped chars).
      const quote = ch;
      i++;
      while (i < inner.length && inner[i] !== quote) {
        if (inner[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (depth === 0 && /[A-Za-z_$]/.test(ch as string)) {
      const start = i;
      while (i < inner.length && /[A-Za-z0-9_$]/.test(inner[i] as string)) i++;
      // Skip whitespace to see whether this identifier is followed by `:`.
      let j = i;
      while (j < inner.length && /\s/.test(inner[j] as string)) j++;
      if (inner[j] === ':') {
        keys.push(inner.slice(start, i));
      }
      continue;
    }
    i++;
  }
  return keys;
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

/**
 * Replace an existing `database: { ... }` block in place. The trailing comma
 * (if any) after the closing brace is preserved so the surrounding object
 * literal stays valid.
 */
function replaceBlock(
  source: string,
  block: { start: number; end: number },
  dialect: Dialect,
): string {
  return `${source.slice(0, block.start)}${buildDatabaseBlock(dialect)}${source.slice(block.end)}`;
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
    // Different dialect: replace only when the existing block looks like a
    // bare default — so accidental switch on a fresh project works, but
    // user-tuned blocks (custom file paths, extra URL params) are protected.
    if (isBareDefaultBlock(blockText, current)) {
      return {
        status: 'replaced',
        updated: replaceBlock(source, block, dialect),
        previous: current,
      };
    }
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
