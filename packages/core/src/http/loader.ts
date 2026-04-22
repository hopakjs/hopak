import { relative, resolve, sep } from 'node:path';
import { type Logger, pathExists } from '@hopak/common';
import { Glob } from 'bun';
import { errorMessage } from '../internal/errors';
import type { Router } from './router';
import { HTTP_METHODS, type RouteDefinition } from './types';

export interface RouteLoaderOptions {
  routesDir: string;
  router: Router;
  log?: Logger;
}

export interface RouteLoadResult {
  routes: number;
  files: string[];
  errors: RouteLoadError[];
}

export interface RouteLoadError {
  file: string;
  message: string;
  cause?: unknown;
}

const SCRIPT_GLOB = '**/*.{ts,js,mjs,tsx}';
const SCRIPT_EXT_RE = /\.(ts|js|mjs|tsx)$/i;
const INDEX_BASENAME = 'index';
const HIDDEN_PREFIX = '.';

export function filePathToPattern(relativePath: string): string {
  const segments = relativePath
    .replace(SCRIPT_EXT_RE, '')
    .split(sep)
    .filter(
      (segment) =>
        segment.length > 0 && segment !== INDEX_BASENAME && !segment.startsWith(HIDDEN_PREFIX),
    );
  return `/${segments.join('/')}`;
}

function isRouteDefinition(value: unknown): value is RouteDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    'handler' in value &&
    typeof (value as { handler: unknown }).handler === 'function'
  );
}

async function loadOneFile(
  fullPath: string,
  pattern: string,
  router: Router,
  log: Logger | undefined,
): Promise<{ registered: number; errors: RouteLoadError[] }> {
  const errors: RouteLoadError[] = [];
  const mod = (await import(fullPath)) as Record<string, unknown>;
  let registered = 0;

  for (const method of HTTP_METHODS) {
    const exported = mod[method];
    if (exported === undefined) continue;
    if (!isRouteDefinition(exported)) {
      errors.push({ file: fullPath, message: `Export "${method}" is not a defineRoute() result` });
      continue;
    }
    router.add(method, pattern, exported, fullPath);
    registered += 1;
  }

  if (registered === 0 && isRouteDefinition(mod.default)) {
    router.add('GET', pattern, mod.default, fullPath);
    registered += 1;
  }

  if (registered === 0) {
    // A defineRoute() under a non-verb name is almost always a typo; silent
    // skip for anything else (shared utils sitting in app/routes/ are fine).
    const verbs = HTTP_METHODS as readonly string[];
    for (const [name, value] of Object.entries(mod)) {
      if (name === 'default' || verbs.includes(name)) continue;
      if (isRouteDefinition(value)) {
        log?.warn(
          `${fullPath}: export "${name}" is a defineRoute() — rename to GET/POST/PUT/PATCH/DELETE to register it.`,
        );
        break;
      }
    }
  }

  return { registered, errors };
}

export async function loadFileRoutes(options: RouteLoaderOptions): Promise<RouteLoadResult> {
  const result: RouteLoadResult = { routes: 0, files: [], errors: [] };
  const dir = resolve(options.routesDir);

  if (!(await pathExists(dir))) {
    options.log?.debug('Routes directory does not exist, skipping', { path: dir });
    return result;
  }

  const glob = new Glob(SCRIPT_GLOB);
  for await (const file of glob.scan({ cwd: dir })) {
    const fullPath = resolve(dir, file);
    result.files.push(fullPath);
    const pattern = filePathToPattern(relative(dir, fullPath));

    try {
      const outcome = await loadOneFile(fullPath, pattern, options.router, options.log);
      result.routes += outcome.registered;
      result.errors.push(...outcome.errors);
      if (outcome.registered > 0) {
        options.log?.debug('Loaded routes from file', {
          file: fullPath,
          pattern,
          count: outcome.registered,
        });
      }
    } catch (cause) {
      const message = errorMessage(cause);
      result.errors.push({ file: fullPath, message, cause });
      options.log?.error('Failed to load route file', { file: fullPath, error: message });
    }
  }

  return result;
}
