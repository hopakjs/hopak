import { ConfigError, Unauthorized } from '@hopak/common';
import type { RouteHandler } from '@hopak/core';
import { type OAuthCallbackParams, type ProviderProfile, oauthCallback } from './common';
import { challengeFor, generateVerifier, verifierCookie } from './pkce';
import { signState } from './state';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USER_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

const GOOGLE_PKCE_DEFAULT = true;

export interface GoogleStartOptions {
  callbackUrl: string;
  scope?: readonly string[];
  stateSecret: string;
  /** Send a PKCE challenge and set the verifier cookie. Default `true`. */
  pkce?: boolean;
}

export function googleStart(options: GoogleStartOptions): RouteHandler {
  const pkce = options.pkce ?? GOOGLE_PKCE_DEFAULT;
  const secure = options.callbackUrl.startsWith('https://');

  return async () => {
    const clientId = process.env.GOOGLE_OAUTH_ID;
    if (!clientId) throw new ConfigError('Google OAuth is not configured on the server.');

    const state = await signState(options.stateSecret);
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', options.callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    url.searchParams.set('scope', (options.scope ?? ['openid', 'email', 'profile']).join(' '));

    const headers = new Headers({ location: url.toString() });
    if (pkce) {
      const verifier = generateVerifier();
      url.searchParams.set('code_challenge', await challengeFor(verifier));
      url.searchParams.set('code_challenge_method', 'S256');
      headers.set('location', url.toString());
      headers.set('Set-Cookie', verifierCookie(verifier, secure));
    }

    return new Response(null, { status: 302, headers });
  };
}

export function googleCallback(params: OAuthCallbackParams): RouteHandler {
  return oauthCallback(
    params,
    async (code, verifier) => {
      const clientId = process.env.GOOGLE_OAUTH_ID;
      const clientSecret = process.env.GOOGLE_OAUTH_SECRET;
      if (!clientId || !clientSecret) {
        throw new ConfigError('Google OAuth is not configured on the server.');
      }

      const body = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: params.callbackUrl,
        grant_type: 'authorization_code',
        ...(verifier ? { code_verifier: verifier } : {}),
      });

      const tokRes = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      const tokJson = (await tokRes.json()) as { access_token?: string };
      if (!tokJson.access_token) throw new Unauthorized('google token exchange failed');

      const userRes = await fetch(USER_URL, {
        headers: { authorization: `Bearer ${tokJson.access_token}` },
      });
      const g = (await userRes.json()) as {
        sub?: string;
        email?: string;
        name?: string;
        picture?: string;
      };
      if (!g.sub || !g.email) throw new Unauthorized('google profile missing sub/email');

      const profile: ProviderProfile = {
        providerId: g.sub,
        email: g.email,
        ...(g.name ? { name: g.name } : {}),
        ...(g.picture ? { avatar: g.picture } : {}),
      };
      return profile;
    },
    { pkce: GOOGLE_PKCE_DEFAULT },
  );
}
