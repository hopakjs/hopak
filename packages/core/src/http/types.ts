import type { Logger } from '@hopak/common';
import type { Database } from '../db/client';
import type { After, Before, Wrap } from './middleware';

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

export type RouteHandler = (ctx: RequestContext) => unknown | Promise<unknown>;

export interface RouteDefinition {
  readonly handler: RouteHandler;
  readonly before?: readonly Before[];
  readonly after?: readonly After[];
  readonly wrap?: readonly Wrap[];
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
