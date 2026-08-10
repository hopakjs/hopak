import type { Logger } from '@hopak/common';
import { HopakError, buildOpenApiSpec, createApp } from '@hopak/core';

export interface OpenApiOptions {
  readonly log: Logger;
  readonly out?: string;
  readonly rootDir?: string;
}

/**
 * `hopak openapi [--out <file>]` — boot the app far enough to know
 * models and routes, emit an OpenAPI 3.1 document, and shut down.
 * Prints to stdout by default so it pipes into generators:
 *
 *   hopak openapi | bunx openapi-typescript /dev/stdin -o api.d.ts
 */
export async function runOpenapi(options: OpenApiOptions): Promise<number> {
  const { log } = options;
  try {
    const app = await createApp({
      rootDir: options.rootDir ?? process.cwd(),
      log,
    });
    const spec = buildOpenApiSpec({
      models: app.registry.all(),
      router: app.router,
      info: { title: 'Hopak API' },
    });
    await app.stop();

    const json = `${JSON.stringify(spec, null, 2)}\n`;
    if (options.out) {
      await Bun.write(options.out, json);
      log.info(`OpenAPI spec written to ${options.out}`);
    } else {
      process.stdout.write(json);
    }
    return 0;
  } catch (cause) {
    if (cause instanceof HopakError) {
      log.error(cause.message);
      return 1;
    }
    throw cause;
  }
}
