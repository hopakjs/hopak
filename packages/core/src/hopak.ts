import { HopakError } from '@hopak/common';
import { type CreateAppOptions, type HopakApp, createApp } from './app/create';
import { buildBanner } from './banner';
import type { ListeningServer } from './http/server';

export interface HopakInstance {
  listen(port?: number): Promise<ListeningServer>;
  stop(): Promise<void>;
  app(): Promise<HopakApp>;
}

export function hopak(options: CreateAppOptions = {}): HopakInstance {
  let appPromise: Promise<HopakApp> | undefined;

  const ensure = (): Promise<HopakApp> => {
    if (!appPromise) appPromise = createApp(options);
    return appPromise;
  };

  return {
    async listen(port) {
      try {
        const app = await ensure();
        const server = await app.listen(port);
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
}
