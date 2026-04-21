import { Unauthorized } from '@hopak/common';

/**
 * Stateless OAuth state. Instead of a cookie/session store, we sign
 * `{nonce, exp}` with HMAC-SHA256 using the same secret the rest of
 * auth already uses. 5-minute expiry on the nonce.
 *
 * Payload shape: `base64url(json).base64url(hmac)`. Not a full JWT —
 * we don't need the header or the jose dependency for this.
 */

const EXPIRY_MS = 5 * 60 * 1000;

interface StatePayload {
  n: string;
  e: number;
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(s, 'base64url'));
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signState(secret: string): Promise<string> {
  const payload: StatePayload = {
    n: b64url(crypto.getRandomValues(new Uint8Array(16))),
    e: Date.now() + EXPIRY_MS,
  };
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyState(secret: string, token: string): Promise<void> {
  const [body, sig] = token.split('.');
  if (!body || !sig) throw new Unauthorized('invalid state');

  // `crypto.subtle.verify` compares the MAC in constant time — resists
  // timing attacks that a plain `sig === expected` would invite.
  const key = await importKey(secret);
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    fromB64url(sig),
    new TextEncoder().encode(body),
  );
  if (!ok) throw new Unauthorized('invalid state');

  let payload: StatePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as StatePayload;
  } catch {
    throw new Unauthorized('invalid state');
  }
  if (payload.e < Date.now()) throw new Unauthorized('expired state');
}
