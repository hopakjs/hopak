<p align="center">
  <img alt="Hopak.js — Backend framework" src="https://raw.githubusercontent.com/hopakjs/hopak/main/.github/assets/npm_both.png" width="460">
</p>

# @hopak/auth

[![npm](https://img.shields.io/npm/v/@hopak/auth.svg)](https://www.npmjs.com/package/@hopak/auth)
[![license](https://img.shields.io/npm/l/@hopak/auth.svg)](https://github.com/hopakjs/hopak/blob/main/LICENSE)

Authentication for [Hopak.js](https://hopak.dev) — JWT, credential signup/login, role-based access control, and OAuth (GitHub + Google).

```bash
hopak use auth      # scaffolds the model, routes and middleware
# or
bun add @hopak/auth jose
```

**📖 Docs: [hopak.dev/docs/packages/auth](https://hopak.dev/docs/packages/auth)**

## The pieces

```ts
// app/middleware/auth.ts — call once, export the pair
import { jwtAuth } from '@hopak/auth';

export const { requireAuth, signToken } = jwtAuth({
  secret: process.env.JWT_SECRET!,
  claims: ['id', 'role'],
});
```

```ts
// app/routes/api/auth/login.ts
import { credentialsLogin } from '@hopak/auth';
import { defineRoute } from '@hopak/core';
import user from '../../../models/user';
import { signToken } from '../../../middleware/auth';

export const POST = defineRoute({
  handler: credentialsLogin({ model: user, sign: signToken }),
});
```

```ts
// app/routes/api/admin.ts — gate a route
import { requireRole } from '@hopak/auth';
import { defineRoute } from '@hopak/core';
import { requireAuth } from '../../middleware/auth';

export const GET = defineRoute({
  before: [requireAuth(), requireRole('admin')],
  handler: () => ({ ok: true }),
});
```

`requireAuth()` populates `ctx.user`; the type is added to `RequestContext` by module augmentation, so `ctx.user?.role` is typed wherever this package is imported.

## Security posture

- **Algorithms are pinned on verify** — a token signed with a different algorithm is rejected, closing algorithm-confusion attacks.
- **Login is uniform** — unknown user and wrong password return the same message *and* cost the same hash verification, so response timing doesn't leak whether an account exists.
- **OAuth `state`** is an HMAC over `{nonce, exp}` with a 5-minute TTL, compared in constant time. No session store needed.
- **PKCE** — the code verifier is bound to the browser through an HttpOnly cookie. On by default for Google, opt-in for GitHub (`pkce: true`).
- **GitHub private emails** resolve through `/user/emails` when the profile hides the address.
- **`hashPassword`** is idempotent — safe to call in a model `beforeCreate` hook even though `credentialsSignup` also hashes, so the two never produce a double hash.

## Requirements

Bun ≥ 1.3, `@hopak/core`, and `jose` (peer dependencies).

## Author

**Volodymyr Press** · [vladimpress@gmail.com](mailto:vladimpress@gmail.com)

## License

MIT.
