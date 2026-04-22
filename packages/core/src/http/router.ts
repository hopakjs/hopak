import type { CompiledRoute, HttpMethod, RouteDefinition, RouteSegment } from './types';

export interface RouteMatch {
  route: CompiledRoute;
  params: Record<string, string>;
}

const SLASH_TRIM_RE = /^\/+|\/+$/g;
const WILDCARD_RE = /^\[\.\.\.([a-zA-Z_][a-zA-Z0-9_]*)\]$/;
const PARAM_BRACKET_RE = /^\[([a-zA-Z_][a-zA-Z0-9_]*)\]$/;
const PARAM_COLON_PREFIX = ':';

const SEGMENT_WEIGHT = {
  static: 3,
  param: 2,
  wildcard: 1,
} as const;
const SCORE_BASE = 10;

function splitPath(path: string): string[] {
  const trimmed = path.replace(SLASH_TRIM_RE, '');
  return trimmed === '' ? [] : trimmed.split('/');
}

function parseSegment(raw: string): RouteSegment {
  const wildcard = raw.match(WILDCARD_RE);
  if (wildcard?.[1]) return { kind: 'wildcard', name: wildcard[1] };

  const bracket = raw.match(PARAM_BRACKET_RE);
  if (bracket?.[1]) return { kind: 'param', name: bracket[1] };

  if (raw.startsWith(PARAM_COLON_PREFIX)) {
    return { kind: 'param', name: raw.slice(1) };
  }

  return { kind: 'static', value: raw };
}

export function parsePattern(pattern: string): RouteSegment[] {
  return splitPath(pattern).map(parseSegment);
}

function specificity(segments: readonly RouteSegment[]): number {
  let score = 0;
  for (const seg of segments) {
    score = score * SCORE_BASE + SEGMENT_WEIGHT[seg.kind];
  }
  return score;
}

function compareRoutes(a: CompiledRoute, b: CompiledRoute): number {
  const lengthDiff = b.segments.length - a.segments.length;
  if (lengthDiff !== 0) return lengthDiff;
  return specificity(b.segments) - specificity(a.segments);
}

function matchSegments(
  pattern: readonly RouteSegment[],
  request: readonly string[],
): Record<string, string> | null {
  const params: Record<string, string> = {};
  let patternIdx = 0;
  let requestIdx = 0;

  while (patternIdx < pattern.length) {
    const seg = pattern[patternIdx];
    if (!seg) return null;

    if (seg.kind === 'wildcard') {
      params[seg.name] = request.slice(requestIdx).join('/');
      return params;
    }

    const reqSeg = request[requestIdx];
    if (reqSeg === undefined) return null;

    if (seg.kind === 'static') {
      if (seg.value !== reqSeg) return null;
    } else {
      params[seg.name] = decodeURIComponent(reqSeg);
    }

    patternIdx += 1;
    requestIdx += 1;
  }

  return requestIdx === request.length ? params : null;
}

export class Router {
  // Flat list kept for list()/size()/sorting; per-verb buckets are the
  // hot-path lookup — each match() scans only routes for its method,
  // which on typical apps shrinks the pool by ~7× (one per HTTP verb).
  private readonly routes: CompiledRoute[] = [];
  private readonly byMethod: Map<HttpMethod, CompiledRoute[]> = new Map();

  add(method: HttpMethod, pattern: string, definition: RouteDefinition, source?: string): void {
    const compiled: CompiledRoute = {
      method,
      pattern,
      segments: parsePattern(pattern),
      definition,
      ...(source !== undefined ? { source } : {}),
    };
    this.routes.push(compiled);
    this.routes.sort(compareRoutes);

    let bucket = this.byMethod.get(method);
    if (!bucket) {
      bucket = [];
      this.byMethod.set(method, bucket);
    }
    bucket.push(compiled);
    bucket.sort(compareRoutes);
  }

  match(method: HttpMethod, path: string): RouteMatch | null {
    const bucket = this.byMethod.get(method);
    if (!bucket) return null;
    const requestSegments = splitPath(path);
    for (const route of bucket) {
      const params = matchSegments(route.segments, requestSegments);
      if (params !== null) return { route, params };
    }
    return null;
  }

  /**
   * Methods with at least one handler for the given path. Used by the
   * pipeline to surface `405 Method Not Allowed` (with an `Allow:` header)
   * instead of `404` when the URL pattern exists under a different verb.
   */
  allowedMethods(path: string): readonly HttpMethod[] {
    const requestSegments = splitPath(path);
    const methods: HttpMethod[] = [];
    for (const [method, bucket] of this.byMethod) {
      for (const route of bucket) {
        if (matchSegments(route.segments, requestSegments) !== null) {
          methods.push(method);
          break;
        }
      }
    }
    return methods;
  }

  has(method: HttpMethod, pattern: string): boolean {
    const bucket = this.byMethod.get(method);
    return bucket ? bucket.some((r) => r.pattern === pattern) : false;
  }

  list(): readonly CompiledRoute[] {
    return [...this.routes];
  }

  size(): number {
    return this.routes.length;
  }
}
