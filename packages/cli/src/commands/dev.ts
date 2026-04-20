import { type FSWatcher, watch } from 'node:fs';
import { resolve } from 'node:path';
import { type Logger, pathExists } from '@hopak/common';

export interface DevCommandOptions {
  cwd?: string;
  log: Logger;
  entry?: string;
}

const DEFAULT_ENTRY = 'main.ts';
const APP_DIR = 'app';
const COLD_RESTART_DEBOUNCE_MS = 150;

/**
 * Only TypeScript / JavaScript sources under `app/` affect routing or
 * models. Editor artifacts (`.swp`, `.tmp`), test snapshots, and
 * type-caches can fire `rename` events on save — restarting for those
 * would thrash the dev loop.
 */
const WATCHED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

function isSourceFile(filename: string | null | Buffer | undefined): boolean {
  if (!filename) return false;
  const name = typeof filename === 'string' ? filename : filename.toString('utf8');
  if (name.startsWith('.') || name.includes('/.')) return false;
  return WATCHED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * `bun --hot` patches existing modules in place — fast for edits, but it
 * doesn't re-run the top-level scanner, so newly created model or route
 * files are never picked up. We watch `app/` separately and cold-restart
 * the child process when a file is added or deleted; edits still hot-reload
 * through bun as before.
 */
export async function runDev(options: DevCommandOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const entry = options.entry ?? DEFAULT_ENTRY;
  const fullEntry = resolve(cwd, entry);

  if (!(await pathExists(fullEntry))) {
    options.log.error(`Entry file not found: ${entry}`);
    options.log.info('Create a main.ts that imports and starts hopak(), or pass --entry');
    return 1;
  }

  const spawn = (): Bun.Subprocess =>
    Bun.spawn(['bun', '--hot', 'run', fullEntry], {
      cwd,
      stdout: 'inherit',
      stderr: 'inherit',
      stdin: 'inherit',
    });

  let proc = spawn();
  const appDir = resolve(cwd, APP_DIR);
  const watcher = await watchForStructuralChanges(appDir, options.log, () => {
    options.log.info('New/removed file under app/ — restarting…');
    proc.kill();
    proc = spawn();
  });

  const shutdown = (): void => {
    watcher?.close();
    proc.kill();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return proc.exited;
}

async function watchForStructuralChanges(
  appDir: string,
  log: Logger,
  onChange: () => void,
): Promise<FSWatcher | undefined> {
  if (!(await pathExists(appDir))) return undefined;

  let debounce: ReturnType<typeof setTimeout> | null = null;
  try {
    return watch(appDir, { recursive: true }, (eventType, filename) => {
      // `rename` fires on file creation and deletion on both macOS and
      // Linux (via inotify IN_CREATE / IN_DELETE). `change` is just an
      // edit — we ignore it because `bun --hot` already handles it.
      if (eventType !== 'rename') return;
      if (!isSourceFile(filename)) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(onChange, COLD_RESTART_DEBOUNCE_MS);
    });
  } catch (err) {
    log.warn(
      `File watcher unavailable — new files under app/ won't be picked up until manual restart: ${(err as Error).message}`,
    );
    return undefined;
  }
}
