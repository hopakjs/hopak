import type { Logger } from '@hopak/common';
import type { Database } from '../db/client';
import type { After, Before, Wrap } from './middleware';
import type { WsHandlers } from './websocket';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface RequestContext {
  readonly req: Request;
  readonly url: URL;
  readonly method: HttpMethod;
  readonly path: string;
  readonly params: Record<string, string>;
  readonly query: URLSearchParams;
  readonly headers: Headers;
  readonly ip: string | undefined;
  readonly log: Logger;
  readonly db: Database | undefined;
  /** Monotonic clock reading (ms) captured when the request entered the pipeline. */
  readonly startedAt: number;
  body(): Promise<unknown>;
  text(): Promise<string>;
  setHeader(name: string, value: string): void;
  setStatus(code: number): void;
}

export type RouteHandler<TResult = unknown> = (ctx: RequestContext) => TResult | Promise<TResult>;

/**
 * Attached by `crud.*` builders (and available to hand-written routes) so
 * the OpenAPI generator can emit typed request/response schemas instead
 * of generic objects.
 */
export interface RouteOpenApiMeta {
  readonly model?: string;
  readonly kind?: 'list' | 'read' | 'create' | 'update' | 'patch' | 'remove';
  readonly summary?: string;
}

export interface RouteDefinition<TResult = unknown> {
  readonly handler: RouteHandler<TResult>;
  readonly before?: readonly Before[];
  readonly after?: readonly After[];
  readonly wrap?: readonly Wrap[];
  readonly openapi?: RouteOpenApiMeta;
  /** WebSocket handlers — set by the loader when a route file exports `WS`. */
  readonly ws?: WsHandlers;
}

export type RouteSegment =
  | { kind: 'static'; value: string }
  | { kind: 'param'; name: string }
  | { kind: 'wildcard'; name: string };

export interface CompiledRoute {
  readonly method: HttpMethod;
  readonly pattern: string;
  readonly segments: readonly RouteSegment[];
  readonly definition: RouteDefinition;
  readonly source?: string;
}
