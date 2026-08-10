import { realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { file as bunFile } from 'bun';

export interface StaticOptions {
  publicDir: string;
}

export interface StaticHandler {
  serve(url: URL, req?: Request): Promise<Response | null>;
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

// If-None-Match wins over If-Modified-Since per RFC 9110 §13.1.3.
function isNotModified(req: Request, etag: string, mtimeMs: number): boolean {
  const ifNoneMatch = req.headers.get('if-none-match');
  if (ifNoneMatch) {
    return ifNoneMatch
      .split(',')
      .map((candidate) => candidate.trim())
      .some((candidate) => candidate === etag || candidate === '*');
  }
  const ifModifiedSince = req.headers.get('if-modified-since');
  if (!ifModifiedSince) return false;
  const since = Date.parse(ifModifiedSince);
  if (Number.isNaN(since)) return false;
  return Math.floor(mtimeMs / 1000) * 1000 <= since;
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
    async serve(url, req) {
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
      const etag = buildEtag(size, mtimeMs);
      const lastModified = new Date(mtimeMs).toUTCString();

      if (req && isNotModified(req, etag, mtimeMs)) {
        return new Response(null, {
          status: 304,
          headers: {
            'Cache-Control': STATIC_CACHE_CONTROL,
            ETag: etag,
            'Last-Modified': lastModified,
          },
        });
      }

      return new Response(file, {
        headers: {
          'Content-Type': file.type || FALLBACK_MIME,
          'Content-Length': String(size),
          'Cache-Control': STATIC_CACHE_CONTROL,
          ETag: etag,
          'Last-Modified': lastModified,
        },
      });
    },
  };
}
