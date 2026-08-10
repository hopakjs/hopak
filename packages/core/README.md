<p align="center">
  <img alt="Hopak.js — Backend framework" src="https://raw.githubusercontent.com/hopakjs/hopak/main/.github/assets/npm_both.png" width="460">
</p>

# @hopak/core

[![npm](https://img.shields.io/npm/v/@hopak/core.svg)](https://www.npmjs.com/package/@hopak/core)
[![license](https://img.shields.io/npm/l/@hopak/core.svg)](https://github.com/hopakjs/hopak/blob/main/LICENSE)

The runtime of [Hopak.js](https://hopak.dev) — a file-first backend framework for Bun.

```bash
bun add @hopak/core
```

**📖 Docs: [hopak.dev/docs](https://hopak.dev/docs)**

For new projects, start with [`@hopak/cli`](https://www.npmjs.com/package/@hopak/cli) — it scaffolds everything.

## What it does

- **File-based routing** — `app/routes/posts/[id].ts` serves `/posts/:id`; one export per HTTP verb, `[...catch-all]` supported.
- **Models** — one file declares the table, the validation rules, and the TypeScript row type. 19 field types, `belongsTo` / `hasOne` / `hasMany` relations, lifecycle hooks.
- **CRUD** — `crud.list / read / create / update / patch / remove` build route definitions from a model, typed to that model's row.
- **Database** — SQLite, Postgres and MySQL behind one client. Filters, projections, aggregates, cursor pagination, row locks, transactions, and N+1-free `include`.
- **Raw SQL** — `` db.sql`SELECT …` `` parameterises interpolations into driver-native placeholders; `db.builder()` drops to Drizzle when you need it.
- **Migrations** — versioned `up` / `down` files, transactional on SQLite and Postgres.
- **Middleware** — `before` / `after` / `wrap` typed hooks. No `next()` to forget. Runs for every request, including static files and 404s.
- **Realtime** — `export const WS = defineWebSocket({…})` in a route file; `sse()` for server-sent events.
- **Plugins** — `hopak().use(plugin)` registers custom field types, middleware, and boot hooks.
- **OpenAPI** — `buildOpenApiSpec()` turns models + router into an OpenAPI 3.1 document.

## Minimal app

```ts
// main.ts
import { hopak } from '@hopak/core';

await hopak().listen();
```

```ts
// app/models/post.ts
import { model, text, boolean } from '@hopak/core';

export default model('post', {
  title: text().required().min(3),
  content: text().required(),
  published: boolean().default(false),
});
```

```ts
// app/routes/api/posts.ts
import { crud } from '@hopak/core';
import post from '../../models/post';

export const GET = crud.list(post);
export const POST = crud.create(post);
```

## Requirements

Bun ≥ 1.3. Ships as TypeScript source — no build step, no Node.js build output.

## Author

**Volodymyr Press** · [vladimpress@gmail.com](mailto:vladimpress@gmail.com)

## License

MIT.
