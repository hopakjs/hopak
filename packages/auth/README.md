<p align="center">
  <img alt="Hopak.js — Backend framework" src="https://raw.githubusercontent.com/hopakjs/hopak/main/.github/assets/npm_both.png" width="460">
</p>

# @hopak/auth

[![npm](https://img.shields.io/npm/v/@hopak/auth.svg)](https://www.npmjs.com/package/@hopak/auth)
[![license](https://img.shields.io/npm/l/@hopak/auth.svg)](https://github.com/hopakjs/hopak/blob/main/LICENSE)

Authentication for [Hopak.js](https://hopak.dev).

One package covers the common auth story for a Hopak project: JWT signing and verification, credential signup and login handlers with argon2id password hashing, GitHub and Google OAuth flows with stateless CSRF-safe state, and a role-based access control helper.

Like everything else in Hopak, this package is file-first. Running `hopak use auth` scaffolds the route files, middleware, and user model into your repository — the auth code lives in your source tree, not behind a configuration toggle.

## Install

The fast path is via the CLI:

```bash
hopak use auth
```

Or add the package manually:

```bash
bun add @hopak/auth
```

Peer: [`jose`](https://www.npmjs.com/package/jose) `^5.6.0 || ^6.0.0`. Requires Bun ≥ 1.3.

## Documentation

Full guides, API surface, and OAuth setup on the site:

**👉 [hopak.dev/docs/packages/auth](https://hopak.dev/docs/packages/auth)**

- JWT signing and verification (`jwtAuth`)
- Credential signup and login handlers
- OAuth for GitHub and Google
- Role-based access control (`requireRole`)
- Extending `AuthUser` with custom claims

## Author

**Volodymyr Press** · [vladimpress@gmail.com](mailto:vladimpress@gmail.com)

## License

MIT.
