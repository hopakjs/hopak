/**
 * Shape a signed token carries and `requireAuth()` populates on
 * `ctx.user`. Extend via module augmentation when you need to carry
 * more claims:
 *
 *   declare module '@hopak/auth' {
 *     interface AuthUser { tenantId: number }
 *   }
 */
export interface AuthUser {
  id: number;
  role?: string;
}
