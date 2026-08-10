import { ConfigError, Unauthorized } from '@hopak/common';
import type { RouteHandler } from '@hopak/core';
import { type OAuthCallbackParams, type ProviderProfile, oauthCallback } from './common';
import { challengeFor, generateVerifier, verifierCookie } from './pkce';
import { signState } from './state';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const EMAILS_URL = 'https://api.github.com/user/emails';

// GitHub OAuth apps accept but do not enforce PKCE, so it stays off by
// default here — flip it on if GitHub ships enforcement.
const GITHUB_PKCE_DEFAULT = false;

export interface GitHubStartOptions {
  /** Absolute URL GitHub should redirect back to after consent. */
  callbackUrl: string;
  /** OAuth scopes. Default `['user:email']`. */
  scope?: readonly string[];
  /** HMAC secret for the signed `state` param — reuse your JWT_SECRET. */
  stateSecret: string;
  /** Send a PKCE challenge and set the verifier cookie. Default `false`. */
  pkce?: boolean;
}

export function githubStart(options: GitHubStartOptions): RouteHandler {
  const pkce = options.pkce ?? GITHUB_PKCE_DEFAULT;
  const secure = options.callbackUrl.startsWith('https://');

  return async () => {
    const clientId = process.env.GITHUB_OAUTH_ID;
    if (!clientId) throw new ConfigError('GitHub OAuth is not configured on the server.');

    const state = await signState(options.stateSecret);
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', options.callbackUrl);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', (options.scope ?? ['user:email']).join(' '));

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

interface GitHubEmailEntry {
  email?: string;
  primary?: boolean;
  verified?: boolean;
}

async function resolveEmail(accessToken: string): Promise<string | undefined> {
  const res = await fetch(EMAILS_URL, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) return undefined;
  const entries = (await res.json()) as GitHubEmailEntry[];
  if (!Array.isArray(entries)) return undefined;
  const verified = entries.filter((e) => e.verified && typeof e.email === 'string');
  return (verified.find((e) => e.primary) ?? verified[0])?.email;
}

export function githubCallback(params: OAuthCallbackParams): RouteHandler {
  return oauthCallback(
    params,
    async (code, verifier) => {
      const clientId = process.env.GITHUB_OAUTH_ID;
      const clientSecret = process.env.GITHUB_OAUTH_SECRET;
      if (!clientId || !clientSecret) {
        throw new ConfigError('GitHub OAuth is not configured on the server.');
      }

      const tokRes = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: params.callbackUrl,
          ...(verifier ? { code_verifier: verifier } : {}),
        }),
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
        email?: string | null;
        name?: string;
        avatar_url?: string;
      };
      if (typeof gh.id !== 'number') throw new Unauthorized('github profile missing id');

      // Users with a private email get `email: null` from /user — the
      // verified address still comes through /user/emails.
      const resolvedEmail = gh.email ?? (await resolveEmail(tokJson.access_token));
      if (!resolvedEmail) {
        throw new Unauthorized(
          'github profile has no verified email. Verify an email on GitHub, or grant the user:email scope.',
        );
      }
      const profile: ProviderProfile = {
        providerId: gh.id,
        email: resolvedEmail,
        ...(gh.name ? { name: gh.name } : {}),
        ...(gh.avatar_url ? { avatar: gh.avatar_url } : {}),
      };
      return profile;
    },
    { pkce: GITHUB_PKCE_DEFAULT },
  );
}
