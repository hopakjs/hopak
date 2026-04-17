<h1 align="center">Hopak.js</h1>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#models">Models</a> ·
  <a href="#auto-crud">Auto-CRUD</a> ·
  <a href="#routes">Routes</a> ·
  <a href="#request-context">Context</a> ·
  <a href="#validation">Validation</a> ·
  <a href="#errors">Errors</a> ·
  <a href="#database">Database</a> ·
  <a href="#static-files">Static</a> ·
  <a href="#cors">CORS</a> ·
  <a href="#https">HTTPS</a> ·
  <a href="#configuration">Config</a> ·
  <a href="#cli">CLI</a>
</p>

## Quick start

```bash
bun add -g @hopak/cli
hopak new my-app
cd my-app
bun install
hopak dev
```

Server on `http://localhost:3000`. Drop a model in `app/models/` and you get auto-CRUD, validation, JSON serialization, static files — zero config.

---

## Models

A model is one file. It defines the table, the validation, the TypeScript row type, and (optionally) the REST endpoints.

```ts
// app/models/post.ts
import { model, text, boolean, belongsTo } from '@hopak/core';

export default model(
  'post',
  {
    title: text().required().min(3).max(200),
    content: text().required(),
    published: boolean().default(false),
    author: belongsTo('user'),
  },
  { crud: true },
);
```

### Field types

| Type | Notes |
|------|-------|
| `text()` | Free-form string (use `.min/.max/.pattern` to constrain) |
| `email()` | String with email-format validation |
| `url()` | String with URL-format validation |
| `phone()` | String — no built-in regex; add `.pattern(...)` for strict formats |
| `number()`, `money()` | Numbers with min/max (money stored as real) |
| `boolean()` | Scalar |
| `date()`, `timestamp()` | Coerced from ISO strings; rejects invalid dates |
| `enumOf('a', 'b')` | TypeScript literal union, DB enum |
| `json<T>()` | Typed JSON column |
| `belongsTo('user')`, `hasOne('profile')`, `hasMany('post')` | Relations |
| `password()`, `secret()`, `token()` | Auto-excluded from JSON responses |
| `file()`, `image()` | Stored as JSON metadata `{ url, mimeType, size, name? }` |

### Modifiers

Chain on any field:

```ts
text().required().min(3).max(200).unique().index()
number().required().min(0).max(100).default(0)
text().pattern(/^[a-z]+$/)
date().default('now')
timestamp().onUpdate('now')
```

`.required()` / `.optional()` / `.unique()` / `.index()` / `.min(n)` / `.max(n)` / `.default(value)` / `.pattern(regex)`.

### Options

```ts
model('post', { /* fields */ }, {
  crud: true,         // generate REST endpoints (default: false)
  timestamps: true,   // add createdAt + updatedAt columns (default: true)
  softDelete: true,   // add deletedAt + auto-filter (Phase 2)
  owner: 'author',    // owner field for permission filtering (Phase 2)
  publicRead: true,   // anyone can read (Phase 2)
});
```

---

## Auto-CRUD

A model with `crud: true` exposes six endpoints under `/api/<plural>/`:

| Method | Path | Behavior |
|--------|------|----------|
| `GET` | `/api/posts` | Paginated list |
| `GET` | `/api/posts/:id` | Single row, 404 if missing |
| `POST` | `/api/posts` | Validate body, create, return 201 |
| `PUT` | `/api/posts/:id` | Full body validation |
| `PATCH` | `/api/posts/:id` | Partial body validation |
| `DELETE` | `/api/posts/:id` | 204 on success, 404 if missing |

```bash
curl -X POST http://localhost:3000/api/posts \
  -H 'content-type: application/json' \
  -d '{"title":"Hello Hopak","content":"It works!"}'
# → 201 {"id":1,"title":"Hello Hopak","content":"It works!", ...}

curl http://localhost:3000/api/posts?limit=10&offset=20
# → {"items":[...],"total":42,"limit":10,"offset":20}
```

`limit` defaults to 20, max 100. Validation errors return 400 with field-level details.

### Override an endpoint

Drop a file in `app/routes/` with the same path — the file route wins:

```ts
// app/routes/posts.ts — overrides POST /api/posts only
import { defineRoute } from '@hopak/core';

export const POST = defineRoute({
  handler: async (ctx) => {
    // your custom create logic
  },
});
```

The other five auto-CRUD endpoints stay intact.

---

## Routes

File-based routing. Each file in `app/routes/` becomes a URL.

| File | URL |
|------|-----|
| `app/routes/index.ts` | `/` |
| `app/routes/health.ts` | `/health` |
| `app/routes/posts/[id].ts` | `/posts/:id` |
| `app/routes/posts/[id]/publish.ts` | `/posts/:id/publish` |
| `app/routes/files/[...path].ts` | `/files/*` (catch-all) |

One HTTP method per export:

```ts
// app/routes/posts/[id].ts
import { defineRoute } from '@hopak/core';

export const GET = defineRoute({
  handler: async (ctx) => {
    return { id: ctx.params.id };
  },
});

export const POST = defineRoute({
  handler: async (ctx) => {
    const body = await ctx.body();
    return { received: body };
  },
});
```

A `default` export is treated as `GET`.

---

## Request context

Every handler receives `ctx`:

```ts
defineRoute({
  handler: async (ctx) => {
    ctx.method;             // 'GET' | 'POST' | ...
    ctx.path;               // '/posts/123'
    ctx.url;                // URL object
    ctx.params;             // { id: '123' }
    ctx.query;              // URLSearchParams
    ctx.headers;            // Request headers
    ctx.ip;                 // string | undefined

    const body = await ctx.body();   // parsed JSON
    const raw  = await ctx.text();   // raw body

    ctx.setStatus(201);
    ctx.setHeader('X-Custom', 'value');

    ctx.log.info('handler running', { id: ctx.params.id });

    const post = await ctx.db?.model('post').findOne(Number(ctx.params.id));

    return { ok: true };    // any value → JSON response
  },
});
```

Return values are serialized:
- `Response` instance → returned as-is
- `string` → `text/plain`
- `Uint8Array` / `ArrayBuffer` → binary
- `null` / `undefined` → empty body
- anything else → `JSON.stringify`

---

## Validation

Validation is generated from the model — no separate schema to maintain. Every auto-CRUD `POST`/`PUT`/`PATCH` enforces it.

Failures return `400`:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Invalid body",
  "details": {
    "title": ["Too small: expected string to have >=3 characters"],
    "content": ["Invalid input: expected string, received undefined"]
  }
}
```

For custom routes, build a schema from a model on demand:

```ts
import { buildModelSchema, validate } from '@hopak/core';
import postModel from '../models/post';

const schema = buildModelSchema(postModel, { omitId: true, partial: true });
const result = validate(schema, await ctx.body());
if (!result.ok) {
  // result.errors: Record<field, string[]>
}
```

---

## Errors

Throw any `HopakError` subclass — it serializes to the right status with a clean JSON body:

```ts
import { NotFound, Forbidden, Unauthorized, Conflict } from '@hopak/core';

throw new NotFound('Post not found');
throw new Forbidden('You are not the author');
throw new Unauthorized('Login required');
throw new Conflict('Email already in use');
```

| Class | Status |
|-------|--------|
| `ValidationError` | 400 |
| `Unauthorized` | 401 |
| `Forbidden` | 403 |
| `NotFound` | 404 |
| `Conflict` | 409 |
| `RateLimited` | 429 |
| `InternalError`, `ConfigError` | 500 |

Custom errors extend `HopakError`:

```ts
import { HopakError } from '@hopak/core';

class PaymentFailed extends HopakError {
  override readonly status = 402;
  override readonly code = 'PAYMENT_FAILED';
}
```

Unknown errors (anything not `HopakError`) become `500` with a safe message; the original is logged.

---

## Database

SQLite by default. Drizzle under the hood, but you don't write Drizzle — you write models.

The schema is created on `hopak migrate` (and on every `hopak dev` boot for new tables).

### Querying inside a handler

```ts
defineRoute({
  handler: async (ctx) => {
    const post = await ctx.db?.model('post').findOne(1);
    return post;
  },
});
```

`ctx.db` is `undefined` when the server starts without models. In a normal app it's always set.

Each `db.model(name)` returns a CRUD client:

```ts
client.findMany({ where: { published: true }, limit: 10, orderBy: [{ field: 'id', direction: 'desc' }] });
client.findOne(id);
client.findOrFail(id);                  // throws NotFound
client.count({ where: { ... } });
client.create({ title: 'x' });
client.update(id, { title: 'y' });
client.delete(id);
```

For raw Drizzle access:

```ts
const drizzle = ctx.db?.raw();
```

---

## Static files

Anything in `public/` is served at the root, with `Cache-Control`, `ETag`, and `Last-Modified` set automatically. `/` falls back to `index.html`. Path traversal is rejected.

```
public/
├── index.html       → GET /
├── favicon.ico      → GET /favicon.ico
└── assets/logo.svg  → GET /assets/logo.svg
```

---

## CORS

Off by default. Enable per-origin:

```ts
// hopak.config.ts
import { defineConfig } from '@hopak/core';

export default defineConfig({
  cors: {
    origins: ['https://myapp.com', 'http://localhost:5173'],
    credentials: true,
  },
});
```

Or wildcard:

```ts
cors: { origins: '*' }
```

`OPTIONS` preflight is handled automatically.

---

## HTTPS

Local HTTPS works with one flag — Hopak generates a self-signed certificate on first run and caches it under `.hopak/certs/`. Requires `openssl` on the machine.

```ts
import { ensureDevCert, startServer } from '@hopak/core';

const tls = await ensureDevCert({ certDir: '.hopak/certs' });
await startServer({ port: 3443, tls });
```

In production: provide your own `tls.key` and `tls.cert` paths.

---

## Configuration

`hopak.config.ts` is optional. Everything has sensible defaults.

```ts
import { defineConfig } from '@hopak/core';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  database: {
    dialect: 'sqlite',
    file: '.hopak/data.db',
  },
  paths: {
    models: 'app/models',
    routes: 'app/routes',
    public: 'public',
  },
  cors: {
    origins: ['http://localhost:5173'],
  },
});
```

All paths can be relative — they resolve from the project root.

---

## Project layout

```
my-app/
├── app/
│   ├── models/        # one file per resource
│   └── routes/        # file-based routing
├── public/            # static files
├── hopak.config.ts    # optional
└── main.ts            # entry point
```

---

## CLI

| Command | What it does |
|---------|--------------|
| `hopak new <name>` | Scaffold a new project |
| `hopak dev` | Run with hot reload |
| `hopak generate model <name>` | Add a model file |
| `hopak generate route <path>` | Add a route file |
| `hopak migrate` | Sync schema to the database |
| `hopak check` | Audit project state (config, models, routes) |
| `hopak --version` | Show version |
| `hopak --help` | Show help |

---

## Stack

- **Runtime:** Bun
- **Validation:** Zod
- **ORM:** Drizzle (SQLite shipping; Postgres next)
- **Lint/Format:** Biome

---

## License

MIT.

Made with ❤️ in Ukraine 🇺🇦
