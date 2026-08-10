import { RateLimited } from '@hopak/common';
import type { Before } from './middleware';
import type { RequestContext } from './types';

export interface RateLimitOptions {
  /** Window length in milliseconds. Default 60 000 (one minute). */
  windowMs?: number;
  /** Requests allowed per key per window. Default 100. */
  max?: number;
  /** Bucket key per request. Default: client IP (`'anonymous'` when unknown). */
  keyFor?: (ctx: RequestContext) => string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window in-process rate limiter. Over-limit requests get 429 with
 * a `Retry-After` header. State lives in this process — behind a load
 * balancer each instance counts separately; put the limit at the edge
 * when you need a global budget.
 *
 * Use globally (`hopak().before(rateLimit())`) or per route
 * (`crud.create(post, { before: [rateLimit({ max: 10 })] })`).
 */
export function rateLimit(options: RateLimitOptions = {}): Before {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 100;
  const keyFor = options.keyFor ?? ((ctx) => ctx.ip ?? 'anonymous');
  const buckets = new Map<string, Bucket>();

  return (ctx) => {
    const now = Date.now();
    if (buckets.size > 10_000) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
    }

    const key = keyFor(ctx);
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfterS = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      ctx.setHeader('Retry-After', String(retryAfterS));
      throw new RateLimited(`Rate limit exceeded. Retry in ${retryAfterS}s.`);
    }
  };
}
