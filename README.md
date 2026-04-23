<p align="center">
  <img alt="Hopak.js — Backend framework for Bun" src=".github/assets/git_banner.png" width="100%">
</p>

<p align="center">
  <a href="https://hopak.dev"><img alt="hopak.dev" src="https://img.shields.io/badge/site-hopak.dev-0d6efd?labelColor=0d1117"></a>
  <a href="https://www.npmjs.com/package/@hopak/core"><img alt="npm" src="https://img.shields.io/npm/v/@hopak/core.svg?labelColor=0d1117"></a>
  <a href="https://github.com/hopakjs/hopak/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/npm/l/@hopak/core.svg?labelColor=0d1117"></a>
  <a href="https://bun.sh"><img alt="bun" src="https://img.shields.io/badge/runtime-Bun%20%E2%89%A5%201.3-f472b6?labelColor=0d1117"></a>
</p>

<p align="center">
  <strong>A backend framework for <a href="https://bun.sh">Bun</a>.</strong><br>
  File-based routing. Typed models. Scaffolded CRUD.<br>
  Every endpoint lives as real TypeScript on disk — no runtime decorators, no DI container, no hidden state.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#packages">Packages</a> ·
  <a href="https://hopak.dev/docs">Documentation</a> ·
  <a href="https://hopak.dev/docs/recipes">Recipes</a> ·
  <a href="https://hopak.dev/docs/changelog">Changelog</a>
</p>

---

## Why Hopak

Most backend frameworks either hide too much behind runtime magic or make you glue three libraries together just to serve a REST endpoint. Hopak does neither.

A model is a file. A route is a file. CRUD is six files the CLI writes for you. What you see in `app/` is exactly what the server runs — there is no decorator scanner, no DI container, no code synthesized from flags. You can open any generated file and rewrite it the way you want.

The same model drives the database schema, the TypeScript row type, and the validator. One declaration, three outputs, shared across every handler that touches the resource.

## Quick start

```bash
bun add -g @hopak/cli
hopak new my-app          # SQLite by default — zero install, works offline
cd my-app
hopak dev                 # http://localhost:3000
```

Scaffold your first resource:

```bash
hopak generate model post
hopak generate crud post
# → app/models/post.ts
# → app/routes/api/posts.ts           (list + create)
# → app/routes/api/posts/[id].ts      (read + update + patch + delete)
```

Six REST endpoints are now live. Full guide: **[hopak.dev/docs/quickstart](https://hopak.dev/docs/quickstart)**.

## What you get

- **File-based routing** — `app/routes/posts/[id].ts` serves `/posts/:id`
- **Typed models** — fields, constraints, relations; one declaration feeds schema, types, and validation
- **Scaffolded CRUD** — six endpoints generated as source code you own
- **Three SQL dialects** — SQLite, Postgres, MySQL behind one API (Drizzle under the hood)
- **Migrations** — plain TypeScript `up()` / `down()`, explicit and reversible
- **Validation & errors** — derived from the model (Valibot), typed error hierarchy, clean JSON responses
- **First-party auth** — JWT, credentials, OAuth (GitHub, Google), RBAC — scaffolded as files

## Packages

| Package | Purpose |
|---|---|
| [`@hopak/core`](./packages/core) | Framework runtime — server, router, models, database, validation, CRUD |
| [`@hopak/cli`](./packages/cli) | Operator tool — scaffolds projects, runs dev server, manages migrations |
| [`@hopak/auth`](./packages/auth) | JWT, credentials, OAuth, role-based access control |
| [`@hopak/testing`](./packages/testing) | In-process test server and typed JSON client |
| [`@hopak/common`](./packages/common) | Shared errors, logger, HTTP statuses, config types |

## Documentation

Everything — reference, recipes, guides, migrations between versions — lives at **[hopak.dev/docs](https://hopak.dev/docs)**.

- [Installation](https://hopak.dev/docs/installation) · [Quick start](https://hopak.dev/docs/quickstart) · [Project layout](https://hopak.dev/docs/project-layout)
- [Models](https://hopak.dev/docs/models) · [Routes](https://hopak.dev/docs/routes) · [CRUD](https://hopak.dev/docs/crud) · [Validation](https://hopak.dev/docs/validation) · [Errors](https://hopak.dev/docs/errors)
- [Database](https://hopak.dev/docs/database) · [Migrations](https://hopak.dev/docs/migrations)
- [CLI reference](https://hopak.dev/docs/cli) · [Recipes](https://hopak.dev/docs/recipes) · [Changelog](https://hopak.dev/docs/changelog)
- [Upgrading between versions](https://hopak.dev/docs/upgrading)

## Requirements

- [Bun](https://bun.sh) ≥ 1.3
- TypeScript 5.5+

## Community

- **Issues & feature requests:** [github.com/hopakjs/hopak/issues](https://github.com/hopakjs/hopak/issues)
- **npm:** [npmjs.com/~hopakjs](https://www.npmjs.com/~hopakjs)

## Contributing

Pull requests are welcome. If you are planning something substantial, open an issue first so we can discuss the direction. The repo is a Bun workspace — `bun install` at the root covers every package.

## License

[MIT](./LICENSE) — Volodymyr Press and contributors.
