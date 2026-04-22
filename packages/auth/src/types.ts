/** Extend via `declare module '@hopak/auth' { interface AuthUser {...} }` to carry more claims. */
export interface AuthUser {
  id: number;
  role?: string;
}
