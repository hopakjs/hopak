import type { RequestContext, RouteHandler } from './types';

export interface SseStream {
  /** Send one event. Objects are JSON-encoded; strings go through as-is. */
  send(data: unknown, options?: { event?: string; id?: string }): void;
  close(): void;
  /** Resolves when the client disconnects or `close()` is called. */
  readonly closed: Promise<void>;
}

function encodeEvent(data: unknown, options?: { event?: string; id?: string }): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  const lines: string[] = [];
  if (options?.event) lines.push(`event: ${options.event}`);
  if (options?.id) lines.push(`id: ${options.id}`);
  for (const line of payload.split('\n')) lines.push(`data: ${line}`);
  return `${lines.join('\n')}\n\n`;
}

/**
 * Server-Sent Events route handler:
 *
 *   export const GET = defineRoute({
 *     handler: sse(async (stream) => {
 *       stream.send({ tick: Date.now() });
 *       await stream.closed;
 *     }),
 *   });
 *
 * The producer runs as soon as the client connects. Sends after
 * disconnect are dropped silently; await `stream.closed` to stop work
 * when the client goes away.
 */
export function sse(
  producer: (stream: SseStream, ctx: RequestContext) => void | Promise<void>,
): RouteHandler<Response> {
  return (ctx) => {
    let notifyClosed: () => void;
    const closed = new Promise<void>((resolve) => {
      notifyClosed = resolve;
    });
    const encoder = new TextEncoder();
    let open = true;
    let stream: SseStream;

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        stream = {
          send(data, options) {
            if (!open) return;
            controller.enqueue(encoder.encode(encodeEvent(data, options)));
          },
          close() {
            if (!open) return;
            open = false;
            controller.close();
            notifyClosed();
          },
          closed,
        };

        Promise.resolve(producer(stream, ctx)).catch((cause) => {
          ctx.log.error('SSE producer threw', {
            error: cause instanceof Error ? cause.message : String(cause),
          });
          stream.close();
        });
      },
      cancel() {
        open = false;
        notifyClosed();
      },
    });

    return new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  };
}
