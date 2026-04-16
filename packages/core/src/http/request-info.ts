import type { Server } from 'bun';
import { HTTP_METHODS, type HttpMethod } from './types';

type Engine = Server<unknown>;

export function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value);
}

export function clientIp(req: Request, engine: Engine): string | undefined {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim();
  return engine.requestIP(req)?.address;
}
