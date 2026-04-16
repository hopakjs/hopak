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

async function parseJsonBody(req: Request, log: Logger): Promise<unknown> {
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes(JSON_CONTENT_TYPE)) return null;
  try {
    return await req.json();
  } catch (cause) {
    log.warn('Failed to parse JSON request body', { cause: errorMessage(cause) });
    return null;
  }
}

export function buildContext(inputs: ContextInputs): ContextResult {
  const responseInit: ResponseInit = { status: DEFAULT_STATUS, headers: new Headers() };

  let bodyPromise: Promise<unknown> | undefined;
  let textPromise: Promise<string> | undefined;

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
      bodyPromise ??= parseJsonBody(inputs.req, inputs.log);
      return bodyPromise;
    },
    text() {
      textPromise ??= inputs.req.text();
      return textPromise;
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
