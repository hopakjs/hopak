/**
 * Patch `main.ts` to register framework-level middleware against the
 * fluent `hopak()` builder. The template ships as:
 *
 *   import { hopak } from '@hopak/core';
 *   await hopak().listen();
 *
 * `use log` turns that into:
 *
 *   import { hopak, requestId, requestLog } from '@hopak/core';
 *   await hopak().before(requestId()).after(requestLog()).listen();
 *
 * The patcher is conservative: if it can't find the expected shape
 * (user has already customised main.ts) it returns a `cant-patch`
 * result and the CLI prints a snippet for the user to paste.
 */

export type PatchStatus = 'patched' | 'already' | 'cant-patch';

export interface PatchResult {
  status: PatchStatus;
  /** Full rewritten file when `status === 'patched'`. */
  updated?: string;
  /** Snippet to show the user when we can't patch automatically. */
  snippet?: string;
}

export interface MiddlewareInjection {
  /** Symbols to add to the `from '@hopak/core'` import (de-duped). */
  imports: readonly string[];
  /** Chain steps to insert before `.listen(...)`, e.g. `[".before(requestId())", ".after(requestLog())"]`. */
  chain: readonly string[];
}

const HOPAK_IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*['"]@hopak\/core['"]\s*;?/;
// Chain step: `.name(` + balanced args + `)`. One level of nested parens is
// enough for `.before(requestId())`, `.after(requestLog({ ... }))`.
const CHAIN_STEP = /\.[a-zA-Z]+\s*\((?:[^()]|\([^()]*\))*\)/.source;
const HOPAK_CALL_RE = new RegExp(`hopak\\s*\\(\\s*\\)((?:\\s*${CHAIN_STEP})*)\\s*\\.listen\\s*\\(`);
const STEP_SIGNATURE_RE = /^\.([a-zA-Z]+)\s*\(\s*([a-zA-Z_$][\w$]*)/;

export function patchMainTs(source: string, inject: MiddlewareInjection): PatchResult {
  const importMatch = source.match(HOPAK_IMPORT_RE);
  const callMatch = source.match(HOPAK_CALL_RE);
  if (!importMatch || !callMatch) {
    return { status: 'cant-patch', snippet: snippetFor(inject) };
  }

  const currentImports = splitImportSymbols(importMatch[1] ?? '');
  const nextImports = mergeImports(currentImports, inject.imports);

  const existingChain = callMatch[1] ?? '';
  const missing = inject.chain.filter((step) => !stepAlreadyPresent(existingChain, step));
  if (nextImports.length === currentImports.length && missing.length === 0) {
    return { status: 'already' };
  }

  const newImport = `import { ${nextImports.join(', ')} } from '@hopak/core';`;
  const newChain = `hopak()${existingChain}${missing.join('')}.listen(`;

  const updated = source.replace(HOPAK_IMPORT_RE, newImport).replace(HOPAK_CALL_RE, newChain);
  return { status: 'patched', updated };
}

/**
 * Match on `(method, factoryName)` pair, not the literal step string, so
 * `.before(requestId({ header: 'X-Trace' }))` isn't re-injected when the
 * canonical step is `.before(requestId())`.
 */
function stepAlreadyPresent(existing: string, step: string): boolean {
  const sig = step.match(STEP_SIGNATURE_RE);
  if (!sig) return existing.includes(step);
  const [, method, factory] = sig;
  return new RegExp(`\\.${method}\\s*\\(\\s*${factory}\\s*\\(`).test(existing);
}

function splitImportSymbols(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function mergeImports(current: readonly string[], additions: readonly string[]): string[] {
  const seen = new Set(current);
  const merged = [...current];
  for (const sym of additions) {
    if (!seen.has(sym)) {
      merged.push(sym);
      seen.add(sym);
    }
  }
  return merged;
}

function snippetFor(inject: MiddlewareInjection): string {
  const importList = ['hopak', ...inject.imports].join(', ');
  return `import { ${importList} } from '@hopak/core';\n\nawait hopak()${inject.chain.join('')}.listen();`;
}
