import { realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { file as bunFile } from 'bun';

export interface StaticOptions {
  publicDir: string;
}

export interface StaticHandler {
  serve(url: URL): Promise<Response | null>;
}

const INDEX_FILE = '/index.html';
const FALLBACK_MIME = 'application/octet-stream';
const STATIC_CACHE_CONTROL = 'public, max-age=300';

function isPathSafe(root: string, target: string): boolean {
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  return target === root || target.startsWith(rootWithSep);
}

function resolveTarget(root: string, urlPath: string): string {
  const decoded = decodeURIComponent(urlPath);
  const requested = decoded === '/' ? INDEX_FILE : decoded;
  return resolve(root, `.${requested}`);
}

function buildEtag(size: number, mtimeMs: number): string {
  return `W/"${size.toString(16)}-${mtimeMs.toString(16)}"`;
}

export function createStaticHandler(options: StaticOptions): StaticHandler {
  const resolved = resolve(options.publicDir);
  // Eagerly realpath the root so symlink comparisons later line up —
  // e.g. on macOS `/var/...` actually lives under `/private/var/...`,
  // which would trip `isPathSafe` after `realpath(target)`.
  let rootPromise: Promise<string> | null = null;
  const canonicalRoot = async (): Promise<string> => {
    if (!rootPromise) {
      rootPromise = realpath(resolved).catch(() => resolved);
    }
    return rootPromise;
  };

  return {
    async serve(url) {
      const root = await canonicalRoot();
      const target = resolveTarget(root, url.pathname);
      if (!isPathSafe(root, target)) return null;

      const file = bunFile(target);
      if (!(await file.exists())) return null;

      // Resolve symlinks on the request path too. A symlink inside
      // `root` pointing outside would otherwise leak arbitrary files.
      let realTarget: string;
      try {
        realTarget = await realpath(target);
      } catch {
        return null;
      }
      if (!isPathSafe(root, realTarget)) return null;

      const size = file.size;
      const mtimeMs = file.lastModified;

      return new Response(file, {
        headers: {
          'Content-Type': file.type || FALLBACK_MIME,
          'Content-Length': String(size),
          'Cache-Control': STATIC_CACHE_CONTROL,
          ETag: buildEtag(size, mtimeMs),
          'Last-Modified': new Date(mtimeMs).toUTCString(),
        },
      });
    },
  };
}
