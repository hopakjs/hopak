import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { isFile } from '@hopak/common';
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
  const root = resolve(options.publicDir);

  return {
    async serve(url) {
      const target = resolveTarget(root, url.pathname);
      if (!isPathSafe(root, target)) return null;
      if (!(await isFile(target))) return null;

      const file = bunFile(target);
      const stats = await stat(target);

      return new Response(file, {
        headers: {
          'Content-Type': file.type || FALLBACK_MIME,
          'Content-Length': String(stats.size),
          'Cache-Control': STATIC_CACHE_CONTROL,
          ETag: buildEtag(stats.size, stats.mtimeMs),
          'Last-Modified': new Date(stats.mtimeMs).toUTCString(),
        },
      });
    },
  };
}
