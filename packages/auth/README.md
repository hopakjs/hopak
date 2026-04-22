<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/hopakjs/hopak/main/.github/assets/npm_white.png">
    <img alt="Hopak.js — Backend framework" src="https://raw.githubusercontent.com/hopakjs/hopak/main/.github/assets/npm_black.png" width="520">
  </picture>
</p>

# @hopak/auth

[![npm](https://img.shields.io/npm/v/@hopak/auth.svg)](https://www.npmjs.com/package/@hopak/auth)
[![license](https://img.shields.io/npm/l/@hopak/auth.svg)](https://github.com/hopakjs/hopak/blob/main/LICENSE)

Authentication for [Hopak.js](https://github.com/hopakjs/hopak) — JWT, credential signup/login, OAuth (GitHub + Google), and role-based access control. One package, one mental model.

## Contents

- [Install](#install)
- [Five-minute auth](#five-minute-auth)
- [`jwtAuth` — sign + verify](#jwtauth--sign--verify)
- [Credential endpoints](#credential-endpoints)
- [`requireRole` — RBAC](#requirerole--rbac)
- [OAuth (GitHub, Google)](#oauth-github-google)
- [Extending `AuthUser`](#extending-authuser)
- [Low-level primitives](#low-level-primitives)
- [Related packages](#related-packages)

---

## Install

The fast path — scaffold everything with one CLI command:

```bash
hopak use auth
# → installs @hopak/auth + jose
# → creates app/middleware/auth.ts
# → creates app/routes/api/auth/{signup,login,me}.ts
# → creates app/models/user.ts (only if missing)
# → adds JWT_SECRET to .env.example
```

Then materialise the `users` table:

- **No migrations yet:** `hopak sync && hopak dev`
- **Migrations in use:** `hopak migrate new add_users`, fill in the
  `CREATE TABLE users(...)` in `up()`, then `hopak migrate up`. The
  model was already created above — it just needs a DB table to live in.

The manual path:

```bash
bun add @hopak/auth jose
```

Peer deps: `@hopak/core`, `@hopak/common`, `jose ^5.6.0 || ^6.0.0`.
Works on Bun ≥ 1.3.

## Five-minute auth

```ts
// app/middleware/auth.ts — one source of truth for this app's auth
import { jwtAuth } from '@hopak/auth';

const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET is not set.');

export const { requireAuth, signToken } = jwtAuth({ secret });
```

```ts
// app/routes/api/auth/signup.ts
import { defineRoute } from '@hopak/core';
import { credentialsSignup } from '@hopak/auth';
import user from '../../../models/user';
import { signToken } from '../../../middleware/auth';

export const POST = defineRoute({
  handler: credentialsSignup({ model: user, sign: signToken }),
});
```

```ts
// Any protected route
import { crud } from '@hopak/core';
import post from '../../models/post';
import { requireAuth } from '../../middleware/auth';

export const POST = crud.create(post, { before: [requireAuth()] });
```

That's the whole loop: hash on signup, verify on login, gate with `requireAuth()`.

## `jwtAuth` — sign + verify

```ts
const auth = jwtAuth({
  secret: process.env.JWT_SECRET!, // 32+ bytes
  expiresIn: '7d',                 // default '7d', accepts jose durations
  algorithm: 'HS256',              // default HS256; switch when ready to manage keys
  claims: ['id', 'role'],          // fields copied into the JWT + back onto ctx.user
});
```

Returns `{ requireAuth, signToken }`.

- **`requireAuth()`** → a `Before` middleware. Reads `Authorization: Bearer <token>`, verifies with `jose`, sets `ctx.user`. Throws `Unauthorized` (401) on missing/invalid tokens.
- **`signToken(user)`** → async, returns a signed JWT. Any field listed in `claims` is copied from `user` into the payload (`id` goes into `sub`).

Installing this package augments `RequestContext` so every handler
gets typed access to `ctx.user?: AuthUser` — populated after
`requireAuth()` ran earlier in the chain, `undefined` otherwise.

## Credential endpoints

`credentialsSignup` and `credentialsLogin` are route **handlers** — drop them into `defineRoute({ handler: ... })`.

```ts
credentialsSignup({ model: user, sign: signToken });
// POST → validates body against the model, hashes `password`,
//        inserts, strips sensitive fields, returns { user, token }.

credentialsLogin({ model: user, sign: signToken });
// POST → looks up the row by `email` (override with `identifier`),
//        verifies the password, returns { token }.
```

Both use `Bun.password.hash` / `verify` — argon2id by default.

Override the password field or lookup column when your schema differs:

```ts
credentialsLogin({ model: user, sign: signToken, identifier: 'username', passwordField: 'hashed' });
```

## `requireRole` — RBAC

```ts
import { requireRole } from '@hopak/auth';
import { requireAuth } from '../../middleware/auth';

export const DELETE = crud.remove(post, {
  before: [requireAuth(), requireRole('admin')],
});
```

- Runs AFTER `requireAuth()`. Reads `ctx.user.role`.
- Multiple roles are OR-of: `requireRole('admin', 'editor')`.
- No `ctx.user` → 401. Role mismatch → 403.

Empty list throws at build time:

```ts
requireRole(); // Error: requireRole(): pass at least one role name.
```

## OAuth (GitHub, Google)

Sub-paths expose provider-specific `*Start` / `*Callback` route handlers. State is verified statelessly with HMAC over your existing `JWT_SECRET` — no cookie store, no session table.

```ts
// app/routes/api/auth/github/start.ts
import { defineRoute } from '@hopak/core';
import { githubStart } from '@hopak/auth/oauth/github';

export const GET = defineRoute({
  handler: githubStart({
    callbackUrl: 'http://localhost:3000/api/auth/github/callback',
    stateSecret: process.env.JWT_SECRET!,
  }),
});
```

```ts
// app/routes/api/auth/github/callback.ts
import { defineRoute } from '@hopak/core';
import { githubCallback } from '@hopak/auth/oauth/github';
import user from '../../../../models/user';
import { signToken } from '../../../../middleware/auth';

export const GET = defineRoute({
  handler: githubCallback({
    model: user,
    sign: signToken,
    stateSecret: process.env.JWT_SECRET!,
  }),
});
```

Env vars: `GITHUB_OAUTH_ID`, `GITHUB_OAUTH_SECRET` (or `GOOGLE_*`). The callback links users by email (`linkBy: 'email'` by default), creates a new row if no match, and returns `{ token }`.

Override the new-user shape when your model has extra required fields:

```ts
githubCallback({
  model: user,
  sign: signToken,
  stateSecret: process.env.JWT_SECRET!,
  createUser: (profile) => ({
    email: profile.email,
    name: profile.name ?? 'New User',
    plan: 'free',
  }),
  onFirstLogin: async (row, profile) => {
    await sendWelcomeEmail(row.email, profile.name);
  },
});
```

Google is identical — import from `@hopak/auth/oauth/google`.

If the required env vars (`GITHUB_OAUTH_ID` / `GITHUB_OAUTH_SECRET`,
`GOOGLE_OAUTH_ID` / `GOOGLE_OAUTH_SECRET`) aren't set, the start /
callback handlers throw `ConfigError` (500 with a generic client
message) — the specific env-var name stays server-side in the logs.

## Extending `AuthUser`

Carry more claims by augmenting the `AuthUser` interface:

```ts
// app/types/auth.ts
declare module '@hopak/auth' {
  interface AuthUser {
    tenantId: number;
  }
}
```

Then tell `jwtAuth` to pass the field through:

```ts
jwtAuth({ secret, claims: ['id', 'role', 'tenantId'] });
```

`ctx.user.tenantId` is now typed inside every authenticated handler.

## Low-level primitives

The built-in providers (`githubCallback`, `googleCallback`) are thin
wrappers. When you need a provider we don't ship, build on the same
primitives exported from `@hopak/auth`:

### `oauthCallback(params, exchangeAndFetch)`

The shared callback flow — verifies `state`, calls your
`exchangeAndFetch(code)` to turn the provider code into a
`ProviderProfile`, finds-or-creates the local user, signs a token.

```ts
import { defineRoute } from '@hopak/core';
import { oauthCallback, type ProviderProfile } from '@hopak/auth';
import user from '../../../models/user';
import { signToken } from '../../../middleware/auth';

export const GET = defineRoute({
  handler: oauthCallback(
    { model: user, sign: signToken, stateSecret: process.env.JWT_SECRET! },
    async (code): Promise<ProviderProfile> => {
      const { id, email, name } = await exchangeWithMyProvider(code);
      return { providerId: id, email, name };
    },
  ),
});
```

`params` accepts the same `linkBy` / `createUser` / `onFirstLogin`
options as the GitHub/Google callbacks.

### `signState(secret)` / `verifyState(secret, token)`

HMAC-SHA256-signed stateless state. Every OAuth start handler should
call `signState(process.env.JWT_SECRET!)` and pass the result as the
`state` URL param; the callback handler verifies it. 5-minute expiry
baked into the signed payload — nothing stored server-side.

Use these directly only if you're writing a custom start handler;
`githubStart` / `googleStart` already call them for you.

## Related packages

- **[@hopak/core](https://www.npmjs.com/package/@hopak/core)** — middleware types, request pipeline, `Before`/`After`/`Wrap` hooks.
- **[@hopak/common](https://www.npmjs.com/package/@hopak/common)** — `Unauthorized`, `Forbidden`, and the other error classes thrown here.
- **[@hopak/cli](https://www.npmjs.com/package/@hopak/cli)** — `hopak use auth` scaffolds this package into a fresh project in one command.
