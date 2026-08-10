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
  File-based routing. Typed models. Scaffolded CRUD.
</p>

<p align="center">
  <strong>📖 Full documentation: <a href="https://hopak.dev/docs">hopak.dev/docs</a></strong>
</p>

---

```bash
bun add -g @hopak/cli
hopak new my-app
cd my-app && hopak dev
```

That gives you a running server with `GET/POST /api/posts` and `GET/PUT/PATCH/DELETE /api/posts/:id` already wired to a SQLite database.

## What you write

A model is one file. It defines the table, the validation, and the row type:

```ts
// app/models/post.ts
import { model, text, boolean, belongsTo } from '@hopak/core';

export default model('post', {
  title: text().required().min(3).max(200),
  content: text().required(),
  published: boolean().default(false),
  author: belongsTo('user'),
});
```

A route is one file, and its path is the URL:

```ts
// app/routes/api/posts.ts  →  /api/posts
import { crud } from '@hopak/core';
import post from '../../models/post';

export const GET = crud.list(post);
export const POST = crud.create(post);
```

Everything else — validation, `409` on unique conflicts, `404`/`405`, stripping `password` fields from JSON, N+1-free eager loading — is the framework's job.

## What's in the box

| | |
|---|---|
| **Routing** | file-based, `[id]` params, `[...catch-all]`, one export per HTTP verb |
| **Models** | 19 field types, relations, lifecycle hooks, inferred row types |
| **CRUD** | `crud.list/read/create/update/patch/remove`, typed per model |
| **Database** | SQLite / Postgres / MySQL behind one API; transactions; `db.sql` tagged template |
| **Migrations** | `hopak migrate init/new/up/down/status`, transactional where the dialect allows |
| **Middleware** | `before` / `after` / `wrap` — typed hooks, no `next()` to forget |
| **Auth** | JWT, credential signup/login, RBAC, GitHub + Google OAuth with PKCE |
| **Realtime** | WebSockets in route files, SSE helper |
| **OpenAPI** | `hopak openapi` generates a 3.1 spec from your models and routes |
| **Plugins** | register custom field types, middleware and boot hooks via `hopak().use()` |
| **Testing** | in-process test server + JSON client |

## Packages

| Package | npm | Purpose |
|---|---|---|
| [`@hopak/core`](./packages/core) | [![npm](https://img.shields.io/npm/v/@hopak/core.svg)](https://www.npmjs.com/package/@hopak/core) | Framework runtime |
| [`@hopak/cli`](./packages/cli) | [![npm](https://img.shields.io/npm/v/@hopak/cli.svg)](https://www.npmjs.com/package/@hopak/cli) | Operator tool |
| [`@hopak/auth`](./packages/auth) | [![npm](https://img.shields.io/npm/v/@hopak/auth.svg)](https://www.npmjs.com/package/@hopak/auth) | Auth + OAuth + RBAC |
| [`@hopak/testing`](./packages/testing) | [![npm](https://img.shields.io/npm/v/@hopak/testing.svg)](https://www.npmjs.com/package/@hopak/testing) | In-process test server |
| [`@hopak/common`](./packages/common) | [![npm](https://img.shields.io/npm/v/@hopak/common.svg)](https://www.npmjs.com/package/@hopak/common) | Shared primitives |

## Requirements

Bun ≥ 1.3. Packages ship as TypeScript source and run on Bun directly — there is no build step and no Node.js build output.

## Contributing

Pull requests welcome. For substantial changes, open an issue first. The repo is a Bun workspace — `bun install` at the root covers every package.

```bash
bun test                       # SQLite suites
POSTGRES_URL=... MYSQL_URL=... bun test   # plus the Postgres / MySQL suites
bun run typecheck
bunx @biomejs/biome check .
```

## License

[MIT](./LICENSE) — Volodymyr Press.
