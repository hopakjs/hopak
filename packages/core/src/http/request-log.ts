import type { After, Before } from './middleware';
import type { RequestContext } from './types';

declare module './types' {
  interface RequestContext {
    /** Set by `requestId()` — also echoed back in the response header. */
    requestId?: string;
  }
}

export interface RequestIdOptions {
  /** Response header name. Default `X-Request-Id`. */
  header?: string;
  /** Override ID generation (e.g. a custom ULID). Default: `crypto.randomUUID()`. */
  generate?: () => string;
}

/**
 * Tag every request with a unique ID. Sets `ctx.requestId` and echoes
 * the value back in `X-Request-Id` (or whatever header you pick), so
 * clients can correlate their calls with your logs.
 */
export function requestId(options: RequestIdOptions = {}): Before {
  const header = options.header ?? 'X-Request-Id';
  const gen = options.generate ?? (() => crypto.randomUUID());
  return (ctx) => {
    ctx.requestId = gen();
    ctx.setHeader(header, ctx.requestId);
  };
}

export type RequestLogFormat = 'simple' | 'json';

export interface RequestLogOptions {
  /** `'simple'` → `GET /path 200 3ms` (default). `'json'` → structured log object. */
  format?: RequestLogFormat;
  /** Extra fields to attach — merged into the log line. */
  extra?: (ctx: RequestContext) => Record<string, unknown>;
}

/**
 * Emit one line per request with method / path / status / duration.
 * Reads `ctx.requestId` if `requestId()` is installed upstream.
 */
export function requestLog(options: RequestLogOptions = {}): After {
  const format = options.format ?? 'simple';
  const extra = options.extra;

  return (ctx, { response, error }) => {
    const status = response?.status ?? 500;
    const durationMs = Date.now() - ctx.startedAt;
    const rid = ctx.requestId;
    const extraFields = extra?.(ctx);

    if (format === 'json') {
      ctx.log.info('request', {
        method: ctx.method,
        path: ctx.path,
        status,
        durationMs,
        ...(rid ? { requestId: rid } : {}),
        ...(error ? { error: errorSummary(error) } : {}),
        ...extraFields,
      });
      return;
    }

    const tag = rid ? ` [${rid}]` : '';
    const tail = error ? ` ! ${errorSummary(error)}` : '';
    ctx.log.info(`${ctx.method} ${ctx.path} ${status} ${durationMs}ms${tag}${tail}`, extraFields);
  };
}

function errorSummary(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'non-Error thrown';
}
