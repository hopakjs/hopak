<p align="center">
  <img alt="Hopak.js — Backend framework" src="https://raw.githubusercontent.com/hopakjs/hopak/main/.github/assets/npm_both.png" width="460">
</p>

# @hopak/testing

[![npm](https://img.shields.io/npm/v/@hopak/testing.svg)](https://www.npmjs.com/package/@hopak/testing)
[![license](https://img.shields.io/npm/l/@hopak/testing.svg)](https://github.com/hopakjs/hopak/blob/main/LICENSE)

Integration-test utilities for [Hopak.js](https://hopak.dev).

Instead of mocking HTTP, this package spins a real Hopak server in-process on a random port, wires a typed JSON client against it, and tears everything down after each test. Tests exercise the same pipeline the production server does — request context, middleware, database, validation, error serialization — so what passes here passes in production.

Works with `bun test` out of the box.

## Install

```bash
bun add -D @hopak/testing
```

Requires Bun ≥ 1.3 and [`@hopak/core`](https://www.npmjs.com/package/@hopak/core) as a peer.

## Documentation

Full API and test patterns on the site:

**👉 [hopak.dev/docs/packages/testing](https://hopak.dev/docs/packages/testing)**

- `createTestServer()` — spin up an in-process server with your models and routes
- `JsonClient` — typed `get` / `post` / `put` / `patch` / `delete`
- Recipes for end-to-end testing against SQLite, Postgres, and MySQL

## Author

**Volodymyr Press** · [vladimpress@gmail.com](mailto:vladimpress@gmail.com)

## License

MIT.
