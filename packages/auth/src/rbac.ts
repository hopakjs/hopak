import { Forbidden, Unauthorized } from '@hopak/common';
import type { Before } from '@hopak/core';

/**
 * Gate a route on `ctx.user.role`. Expects an auth middleware
 * (e.g. `requireAuth()` from `jwtAuth(...)`) to have set `ctx.user`
 * earlier in the chain.
 *
 *   export const DELETE = crud.remove(post, {
 *     before: [requireAuth(), requireRole('admin')],
 *   });
 *
 * Pass multiple roles for "any of":
 *   requireRole('admin', 'editor')
 */
export function requireRole(...allowed: string[]): Before {
  if (allowed.length === 0) {
    throw new Error('requireRole(): pass at least one role name.');
  }
  return (ctx) => {
    if (!ctx.user) throw new Unauthorized('not authenticated');
    const role = ctx.user.role;
    if (!role || !allowed.includes(role)) {
      throw new Forbidden(`requires one of: ${allowed.join(', ')}`);
    }
  };
}
