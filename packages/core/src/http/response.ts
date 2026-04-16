import type { ResponseInit } from './request-context';

const JSON_TYPE = 'application/json';
const TEXT_TYPE = 'text/plain';

function ensureContentType(headers: Headers, value: string): void {
  if (!headers.has('Content-Type')) headers.set('Content-Type', value);
}

export function toResponse(value: unknown, init: ResponseInit): Response {
  if (value instanceof Response) return value;

  if (value === undefined || value === null) {
    return new Response(null, init);
  }

  if (typeof value === 'string') {
    ensureContentType(init.headers, TEXT_TYPE);
    return new Response(value, init);
  }

  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return new Response(value, init);
  }

  ensureContentType(init.headers, JSON_TYPE);
  return new Response(JSON.stringify(value), init);
}
