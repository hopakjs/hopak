<p align="center">
  <img alt="Hopak.js — Backend framework" src="https://raw.githubusercontent.com/hopakjs/hopak/main/.github/assets/npm_both.png" width="460">
</p>

# @hopak/core

[![npm](https://img.shields.io/npm/v/@hopak/core.svg)](https://www.npmjs.com/package/@hopak/core)
[![license](https://img.shields.io/npm/l/@hopak/core.svg)](https://github.com/hopakjs/hopak/blob/main/LICENSE)

The runtime of [Hopak.js](https://hopak.dev) — the Bun backend framework.

This package is what your application imports. It owns the HTTP server, file-based router, typed database client, model system, validation pipeline, CRUD helpers, and error hierarchy. Everything else in the Hopak ecosystem (`cli`, `auth`, `testing`) sits on top of it.

Hopak is deliberately file-first: endpoints, models, and migrations live as regular TypeScript on disk. The runtime executes what you write — no decorator reflection, no DI container, no code synthesized from flags.

## Install

```bash
bun add @hopak/core
```

Requires Bun ≥ 1.3. For a new project, start with the [`@hopak/cli`](https://www.npmjs.com/package/@hopak/cli) — it scaffolds the project layout and installs the core for you.

## Documentation

Full guides, API reference, and recipes live on the site:

**👉 [hopak.dev/docs](https://hopak.dev/docs)**

- [Quick start](https://hopak.dev/docs/quickstart) — from empty folder to a running REST endpoint
- [Models](https://hopak.dev/docs/models), [Routes](https://hopak.dev/docs/routes), [CRUD](https://hopak.dev/docs/crud) — the primitives
- [Database](https://hopak.dev/docs/database), [Migrations](https://hopak.dev/docs/migrations) — SQLite · Postgres · MySQL
- [Validation](https://hopak.dev/docs/validation), [Errors](https://hopak.dev/docs/errors), [Middleware](https://hopak.dev/docs/middleware)
- [Recipes](https://hopak.dev/docs/recipes) — 25 worked examples

## Author

**Volodymyr Press** · [vladimpress@gmail.com](mailto:vladimpress@gmail.com)

## License

MIT. See [LICENSE](https://github.com/hopakjs/hopak/blob/main/LICENSE).
