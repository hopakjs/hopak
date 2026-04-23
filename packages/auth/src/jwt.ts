import { Unauthorized, ValidationError } from '@hopak/common';
import {
  type Before,
  type ModelDefinition,
  type RouteHandler,
  buildModelSchema,
  serializeForResponse,
  validate,
} from '@hopak/core';
import { SignJWT, jwtVerify } from 'jose';
import type { AuthUser } from './types';

declare module '@hopak/core' {
  interface RequestContext {
    /** Populated by `requireAuth()` on success. */
    user?: AuthUser;
  }
}

export interface JwtAuthOptions {
  /** HS256 shared secret. 32+ random bytes recommended. */
  secret: string;
  /** JWT `exp` claim. Accepts jose duration (e.g. `'7d'`, `'1h'`). Default `'7d'`. */
  expiresIn?: string;
  /** Signing algorithm. Default `HS256`. Switch when you're ready to manage keys. */
  algorithm?: 'HS256' | 'HS384' | 'HS512';
  /** Model fields to copy into the JWT and back onto `ctx.user`. Default `['id', 'role']`. */
  claims?: readonly string[];
}

export interface JwtAuth {
  requireAuth: () => Before;
  signToken: (user: Record<string, unknown>) => Promise<string>;
}

/**
 * Build the pair of auth primitives for a project. Call once in
 * `app/middleware/auth.ts`, export `{ requireAuth, signToken }`.
 */
export function jwtAuth(options: JwtAuthOptions): JwtAuth {
  const secret = new TextEncoder().encode(options.secret);
  const alg = options.algorithm ?? 'HS256';
  const expiresIn = options.expiresIn ?? '7d';
  const claims = options.claims ?? ['id', 'role'];

  async function signToken(user: Record<string, unknown>): Promise<string> {
    const payload: Record<string, unknown> = {};
    for (const key of claims) {
      if (key === 'id') continue;
      if (user[key] !== undefined && user[key] !== null) payload[key] = user[key];
    }
    const builder = new SignJWT(payload)
      .setProtectedHeader({ alg })
      .setIssuedAt()
      .setExpirationTime(expiresIn);
    if (user.id !== undefined) builder.setSubject(String(user.id));
    return builder.sign(secret);
  }

  function requireAuth(): Before {
    return async (ctx) => {
      const bearer = ctx.headers.get('authorization')?.replace(/^Bearer /i, '');
      if (!bearer) throw new Unauthorized('missing token');
      let payload: Record<string, unknown>;
      try {
        // Pin algorithms so a forged token can't trick jose into verifying
        // with something we didn't configure (e.g. `alg: "none"` or a
        // family swap). jose rejects unlisted algs outright.
        ({ payload } = (await jwtVerify(bearer, secret, { algorithms: [alg] })) as {
          payload: Record<string, unknown>;
        });
      } catch (cause) {
        ctx.log.debug('jwt verify failed', {
          reason: cause instanceof Error ? cause.message : String(cause),
        });
        throw new Unauthorized('invalid token');
      }
      const user = { id: Number(payload.sub) } as AuthUser & Record<string, unknown>;
      for (const key of claims) {
        if (key === 'id') continue;
        if (payload[key] !== undefined) user[key] = payload[key];
      }
      ctx.user = user;
    };
  }

  return { requireAuth, signToken };
}

/**
 * POST handler: validate body against the model, hash the password
 * field, insert the row, strip sensitive fields, sign a token.
 * Returns `{ user, token }`.
 */
export function credentialsSignup(params: {
  model: ModelDefinition;
  sign: (user: Record<string, unknown>) => Promise<string>;
  /** Field to hash before insert. Default `'password'`. */
  passwordField?: string;
}): RouteHandler {
  const schema = buildModelSchema(params.model, { omitId: true });
  const pwField = params.passwordField ?? 'password';

  return async (ctx) => {
    if (!ctx.db)
      throw new Error(
        'credentialsSignup needs a database — configure `database` in hopak.config.ts.',
      );
    const result = validate<Record<string, unknown>>(schema, await ctx.body());
    if (!result.ok) throw new ValidationError('Invalid signup', result.errors);

    const data = { ...result.data };
    if (typeof data[pwField] === 'string') {
      data[pwField] = await Bun.password.hash(String(data[pwField]));
    }
    const row = await ctx.db.model(params.model.name).create(data);
    return {
      user: serializeForResponse(row, params.model),
      token: await params.sign(row as Record<string, unknown>),
    };
  };
}

/**
 * Factory for a POST login handler that:
 *   - reads `{ [identifier]: string, password: string }` from the body
 *   - looks up the row by that field (default `email`)
 *   - verifies the password with Bun.password.verify
 *   - returns `{ token }` — the token claims come from `sign`
 */
export function credentialsLogin(params: {
  model: ModelDefinition;
  sign: (user: Record<string, unknown>) => Promise<string>;
  /** The unique field users identify themselves by. Default `'email'`. */
  identifier?: string;
  /** Hashed password field on the model. Default `'password'`. */
  passwordField?: string;
}): RouteHandler {
  const identifier = params.identifier ?? 'email';
  const pwField = params.passwordField ?? 'password';

  return async (ctx) => {
    if (!ctx.db)
      throw new Error(
        'credentialsLogin needs a database — configure `database` in hopak.config.ts.',
      );
    const body = (await ctx.body()) as Record<string, unknown> | null;
    const identifierValue = body?.[identifier];
    const password = body?.[pwField];
    if (typeof identifierValue !== 'string' || typeof password !== 'string') {
      throw new Unauthorized('bad credentials');
    }

    const rows = await ctx.db.model(params.model.name).findMany({
      where: { [identifier]: identifierValue } as Record<string, unknown>,
      limit: 1,
    });
    const user = rows[0];
    if (!user) throw new Unauthorized('bad credentials');

    const hashed = user[pwField];
    if (typeof hashed !== 'string' || !(await Bun.password.verify(password, hashed))) {
      throw new Unauthorized('bad credentials');
    }

    return { token: await params.sign(user as Record<string, unknown>) };
  };
}
