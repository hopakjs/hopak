/**
 * PKCE (RFC 7636) helpers. The code verifier is bound to the user's
 * browser via an HttpOnly cookie — that is what protects against
 * authorization-code injection; carrying the verifier in `state` would
 * travel through the same redirect as the code and protect nothing.
 */

const COOKIE_NAME = 'hopak_pkce';
const COOKIE_MAX_AGE_S = 300;

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function generateVerifier(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export function verifierCookie(verifier: string, secure: boolean): string {
  const base = `${COOKIE_NAME}=${verifier}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_S}`;
  return secure ? `${base}; Secure` : base;
}

export function clearVerifierCookie(secure: boolean): string {
  const base = `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  return secure ? `${base}; Secure` : base;
}

export function readVerifierCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === COOKIE_NAME) {
      const value = pair.slice(eq + 1).trim();
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}
