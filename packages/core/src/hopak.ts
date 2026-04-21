import { HopakError } from '@hopak/common';
import { type CreateAppOptions, type HopakApp, createApp } from './app/create';
import { buildBanner } from './banner';
import type { After, Before, Wrap } from './http/middleware';
import type { ListeningServer } from './http/server';

/**
 * Fluent entry point for starting a Hopak app. Chainable
 * `.before()` / `.after()` / `.wrap()` accumulate global middleware
 * in declaration order — the exact order they run on each request.
 *
 * Register everything before `listen()`; the middleware set is frozen
 * after the server starts so we don't silently change behavior
 * mid-flight.
 */
export interface HopakInstance {
  before(...fns: Before[]): HopakInstance;
  after(...fns: After[]): HopakInstance;
  wrap(...fns: Wrap[]): HopakInstance;
  listen(port?: number): Promise<ListeningServer>;
  stop(): Promise<void>;
  app(): Promise<HopakApp>;
}

export function hopak(options: CreateAppOptions = {}): HopakInstance {
  const before: Before[] = [];
  const after: After[] = [];
  const wrap: Wrap[] = [];
  let appPromise: Promise<HopakApp> | undefined;
  let started = false;

  const refuseAfterStart = (hook: 'before' | 'after' | 'wrap') => {
    if (started) {
      throw new Error(
        `hopak().${hook}(): cannot register middleware after listen() — add it before starting the server.`,
      );
    }
  };

  const ensure = (): Promise<HopakApp> => {
    if (!appPromise) {
      appPromise = createApp({
        ...options,
        middleware: { before, after, wrap },
      });
    }
    return appPromise;
  };

  const instance: HopakInstance = {
    before(...fns) {
      refuseAfterStart('before');
      before.push(...fns);
      return instance;
    },
    after(...fns) {
      refuseAfterStart('after');
      after.push(...fns);
      return instance;
    },
    wrap(...fns) {
      refuseAfterStart('wrap');
      wrap.push(...fns);
      return instance;
    },
    async listen(port) {
      try {
        const app = await ensure();
        const server = await app.listen(port);
        started = true;
        process.stdout.write(
          buildBanner({ url: server.url, dialect: app.config.database.dialect }),
        );
        return server;
      } catch (cause) {
        if (cause instanceof HopakError) {
          // Don't dump a driver stack. Print a clean Hopak error line and
          // exit non-zero — bun's default unhandled-error printer would
          // show the raw stack otherwise.
          process.stderr.write(`\n  Hopak.js could not start.\n  ${cause.message}\n\n`);
          process.exit(1);
        }
        throw cause;
      }
    },
    async stop() {
      const app = await ensure();
      await app.stop();
    },
    app: ensure,
  };

  return instance;
}
