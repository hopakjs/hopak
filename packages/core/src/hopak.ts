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
      const app = await ensure();
      const server = await app.listen(port);
      process.stdout.write(buildBanner({ url: server.url, dialect: app.config.database.dialect }));
      return server;
    },
    async stop() {
      const app = await ensure();
      await app.stop();
    },
    app: ensure,
  };
}
