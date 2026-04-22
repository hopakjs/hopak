import { Unauthorized } from '@hopak/common';
import type { ModelDefinition, RouteHandler } from '@hopak/core';
import { verifyState } from './state';

/**
 * Shape an OAuth provider maps its response into. Same for every
 * provider — keeps the callback flow identical across GitHub/Google/etc.
 */
export interface ProviderProfile {
  providerId: string | number;
  email: string;
  name?: string;
  avatar?: string;
}

export interface OAuthCallbackParams {
  model: ModelDefinition;
  sign: (user: Record<string, unknown>) => Promise<string>;
  /**
   * Field on the model used to match the provider profile. Default
   * `'email'` — provider's email maps to the local user's email.
   * `'providerId'` keys on the provider's stable user id instead.
   */
  linkBy?: 'email' | 'providerId';
  /**
   * Build the row to insert when the profile has no matching local
   * user. Receives the provider profile, returns a plain object that
   * satisfies your model's validation.
   *
   * Default: `{ email, name? }` plus a random placeholder `password` if
   * the model has one. Override when your model needs extra required
   * fields or your password rules reject the placeholder.
   */
  createUser?: (profile: ProviderProfile) => Record<string, unknown>;
  /**
   * Called after a brand-new row is created. Good place to send a
   * welcome email or assign a default role.
   */
  onFirstLogin?: (row: Record<string, unknown>, profile: ProviderProfile) => Promise<void> | void;
  /** Secret used to verify the `state` param — typically `process.env.JWT_SECRET`. */
  stateSecret: string;
}

/**
 * Build a callback handler shared by every provider. The caller (github /
 * google module) does the provider-specific code→profile exchange, then
 * hands the profile here.
 */
export function oauthCallback(
  params: OAuthCallbackParams,
  exchangeAndFetch: (code: string) => Promise<ProviderProfile>,
): RouteHandler {
  const linkBy = params.linkBy ?? 'email';

  return async (ctx) => {
    if (!ctx.db)
      throw new Error('oauthCallback needs a database — configure `database` in hopak.config.ts.');
    const code = ctx.query.get('code');
    const state = ctx.query.get('state');
    if (!code || !state) throw new Unauthorized('missing code or state');
    await verifyState(params.stateSecret, state);

    const profile = await exchangeAndFetch(code);
    const key = linkBy === 'providerId' ? profile.providerId : profile.email;

    const users = ctx.db.model(params.model.name);
    const existing = (
      await users.findMany({ where: { [linkBy]: key } as Record<string, unknown>, limit: 1 })
    )[0];

    if (existing) {
      return { token: await params.sign(existing as Record<string, unknown>) };
    }

    const row = params.createUser?.(profile) ?? defaultUserRow(profile, params.model);
    const created = await users.create(row);
    await params.onFirstLogin?.(created as Record<string, unknown>, profile);
    return { token: await params.sign(created as Record<string, unknown>) };
  };
}

/**
 * Fallback `createUser` — handles the common `{ email, name, password }`
 * shape. If your model has additional required fields, pass an explicit
 * `createUser` in OAuthCallbackParams.
 */
function defaultUserRow(profile: ProviderProfile, model: ModelDefinition): Record<string, unknown> {
  const row: Record<string, unknown> = { email: profile.email };
  if ('name' in model.fields && profile.name) row.name = profile.name;
  if ('password' in model.fields) row.password = `oauth:${crypto.randomUUID()}`;
  return row;
}
