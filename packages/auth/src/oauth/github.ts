import { Unauthorized } from '@hopak/common';
import type { RouteHandler } from '@hopak/core';
import { type OAuthCallbackParams, type ProviderProfile, oauthCallback } from './common';
import { signState } from './state';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';

export interface GitHubStartOptions {
  /** Absolute URL GitHub should redirect back to after consent. */
  callbackUrl: string;
  /** OAuth scopes. Default `['user:email']`. */
  scope?: readonly string[];
  /** HMAC secret for the signed `state` param — reuse your JWT_SECRET. */
  stateSecret: string;
}

export function githubStart(options: GitHubStartOptions): RouteHandler {
  return async () => {
    const clientId = process.env.GITHUB_OAUTH_ID;
    if (!clientId) throw new Unauthorized('GITHUB_OAUTH_ID not set');

    const state = await signState(options.stateSecret);
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', options.callbackUrl);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', (options.scope ?? ['user:email']).join(' '));

    return new Response(null, { status: 302, headers: { location: url.toString() } });
  };
}

export function githubCallback(params: OAuthCallbackParams): RouteHandler {
  return oauthCallback(params, async (code) => {
    const clientId = process.env.GITHUB_OAUTH_ID;
    const clientSecret = process.env.GITHUB_OAUTH_SECRET;
    if (!clientId || !clientSecret) {
      throw new Unauthorized('GITHUB_OAUTH_ID / GITHUB_OAUTH_SECRET not set');
    }

    const tokRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const tokJson = (await tokRes.json()) as { access_token?: string; error?: string };
    if (!tokJson.access_token) throw new Unauthorized('github token exchange failed');

    const userRes = await fetch(USER_URL, {
      headers: {
        authorization: `Bearer ${tokJson.access_token}`,
        accept: 'application/vnd.github+json',
      },
    });
    const gh = (await userRes.json()) as {
      id?: number;
      email?: string;
      name?: string;
      avatar_url?: string;
    };
    if (typeof gh.id !== 'number' || !gh.email) {
      throw new Unauthorized('github profile missing id/email');
    }
    const profile: ProviderProfile = {
      providerId: gh.id,
      email: gh.email,
      ...(gh.name ? { name: gh.name } : {}),
      ...(gh.avatar_url ? { avatar: gh.avatar_url } : {}),
    };
    return profile;
  });
}
