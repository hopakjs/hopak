import type { Logger } from '@hopak/common';
import type { Database } from '../db/client';
import { errorMessage } from '../internal/errors';
import type { HttpMethod, RequestContext } from './types';

export interface ResponseInit {
  status: number;
  headers: Headers;
}

export interface ContextInputs {
  req: Request;
  url: URL;
  method: HttpMethod;
  params: Record<string, string>;
  log: Logger;
  ip: string | undefined;
  db: Database | undefined;
}

export interface ContextResult {
  ctx: RequestContext;
  responseInit: ResponseInit;
}

const JSON_CONTENT_TYPE = 'application/json';
const DEFAULT_STATUS = 200;

export function buildContext(inputs: ContextInputs): ContextResult {
  const responseInit: ResponseInit = { status: DEFAULT_STATUS, headers: new Headers() };

  // The request body stream can be consumed only once. We read it to a string
  // lazily on first access (via ctx.text() or ctx.body()) and cache it, so
  // subsequent calls — including ctx.body() after ctx.text() and vice versa —
  // operate on the cached copy instead of touching the exhausted stream.
  let rawPromise: Promise<string> | undefined;
  let bodyPromise: Promise<unknown> | undefined;

  const readRaw = (): Promise<string> => {
    rawPromise ??= inputs.req.text();
    return rawPromise;
  };

  const parseJsonBody = async (): Promise<unknown> => {
    const contentType = inputs.req.headers.get('content-type') ?? '';
    if (!contentType.includes(JSON_CONTENT_TYPE)) return null;
    const raw = await readRaw();
    if (raw.length === 0) return null;
    try {
      return JSON.parse(raw);
    } catch (cause) {
      inputs.log.warn('Failed to parse JSON request body', { cause: errorMessage(cause) });
      return null;
    }
  };

  const ctx: RequestContext = {
    req: inputs.req,
    url: inputs.url,
    method: inputs.method,
    path: inputs.url.pathname,
    params: inputs.params,
    query: inputs.url.searchParams,
    headers: inputs.req.headers,
    ip: inputs.ip,
    log: inputs.log,
    db: inputs.db,
    body() {
      bodyPromise ??= parseJsonBody();
      return bodyPromise;
    },
    text() {
      return readRaw();
    },
    setHeader(name, value) {
      responseInit.headers.set(name, value);
    },
    setStatus(code) {
      responseInit.status = code;
    },
  };

  return { ctx, responseInit };
}
