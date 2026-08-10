import type { ServerWebSocket } from 'bun';

/**
 * Per-connection data attached at upgrade time: route params, parsed
 * query, and the handlers from the matched route file. The server-level
 * websocket callbacks dispatch through `handlers`, so one Bun listener
 * serves every WS route.
 */
export interface WsAttachment {
  readonly params: Record<string, string>;
  readonly query: URLSearchParams;
  readonly handlers: WsHandlers;
}

export type HopakWebSocket = ServerWebSocket<WsAttachment>;

/**
 * Route-file WebSocket handlers:
 *
 *   export const WS = defineWebSocket({
 *     open(ws) { ws.subscribe('room'); },
 *     message(ws, message) { ws.publish('room', message); },
 *   });
 *
 * A `GET` request with an `Upgrade: websocket` header on the route's
 * path is upgraded; a plain request gets `426 Upgrade Required` unless
 * the file also exports a regular `GET` route.
 */
export interface WsHandlers {
  open?(ws: HopakWebSocket): void | Promise<void>;
  message?(ws: HopakWebSocket, message: string | Uint8Array): void | Promise<void>;
  close?(ws: HopakWebSocket, code: number, reason: string): void | Promise<void>;
  drain?(ws: HopakWebSocket): void | Promise<void>;
}

/** Identity helper that gives route files typed WS handlers. */
export function defineWebSocket(handlers: WsHandlers): WsHandlers {
  return handlers;
}

export function isWsHandlers(value: unknown): value is WsHandlers {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const keys = ['open', 'message', 'close', 'drain'];
  return (
    keys.some((key) => typeof candidate[key] === 'function') &&
    Object.keys(candidate).every(
      (key) => keys.includes(key) && typeof candidate[key] === 'function',
    )
  );
}
