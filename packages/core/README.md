<h1 align="center">Hopak.js</h1>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#recipes">Recipes</a> ·
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

## Recipes

Common backend tasks, step by step. Every recipe shows **where the file goes**, the **code**, **how to run it**, and **what you should see**. Start from a freshly scaffolded project (`hopak new my-app` → `cd my-app` → `bun install`).

### 1. Create a REST resource

**Goal:** expose `GET/POST /api/posts` and `GET/PUT/PATCH/DELETE /api/posts/:id` from a single file.

**1.** Create the model file:

```ts
// app/models/post.ts
import { model, text, boolean } from '@hopak/core';

export default model(
  'post',
  {
    title: text().required().min(3),
    content: text().required(),
    published: boolean().default(false),
  },
  { crud: true },  // ← enables auto-CRUD; without this the model has no endpoints
);
```

**2.** Start the server:

```bash
hopak dev
```

**3.** Try it from another terminal:

```bash
curl -X POST http://localhost:3000/api/posts \
  -H 'content-type: application/json' \
  -d '{"title":"Hello","content":"World"}'
```

Expected response (`201 Created`):

```json
{ "id": 1, "title": "Hello", "content": "World", "published": false,
  "createdAt": "...", "updatedAt": "..." }
```

**4.** List them:

```bash
curl http://localhost:3000/api/posts
# → { "items": [...], "total": 1, "limit": 20, "offset": 0 }
```

That's it. One file, six endpoints, pagination included.

### 2. Validate input

**Goal:** reject malformed requests with clear, per-field error messages.

Validation is generated **from the model** — you don't write a separate schema.

**1.** Add constraints:

```ts
// app/models/user.ts
import { model, text, email, enumOf, number } from '@hopak/core';

export default model(
  'user',
  {
    name: text().required().min(2).max(100),
    email: email().required().unique(),
    age: number().optional().min(18).max(120),
    role: enumOf('admin', 'user', 'guest').default('user'),
  },
  { crud: true },
);
```

**2.** Send a bad request:

```bash
curl -X POST http://localhost:3000/api/users \
  -H 'content-type: application/json' \
  -d '{"name":"X","email":"not-an-email","age":5,"role":"superman"}'
```

Response (`400 Bad Request`):

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Invalid body",
  "details": {
    "name":  ["Too small: expected string to have >=2 characters"],
    "email": ["Invalid email address"],
    "age":   ["Too small: expected number to be >=18"],
    "role":  ["Invalid option: expected one of \"admin\"|\"user\"|\"guest\""]
  }
}
```

Every failing field has an array of human-readable messages.

### 3. Hide sensitive fields

**Goal:** store passwords and API tokens in the database, but **never** return them in responses.

`password()`, `secret()`, and `token()` are automatically stripped from every JSON response — including list endpoints, single-row fetches, and `POST`/`PATCH`/`PUT` replies.

```ts
// app/models/user.ts
import { model, text, email, password, token } from '@hopak/core';

export default model(
  'user',
  {
    name: text().required(),
    email: email().required().unique(),
    password: password().required().min(8),
    apiKey: token().optional(),
  },
  { crud: true },
);
```

**Verify:**

```bash
curl -X POST http://localhost:3000/api/users \
  -H 'content-type: application/json' \
  -d '{"name":"Alice","email":"a@b.com","password":"secret12","apiKey":"tok_abc"}'
```

Response — notice `password` and `apiKey` are **missing**, even though they were stored:

```json
{ "id": 1, "name": "Alice", "email": "a@b.com",
  "createdAt": "...", "updatedAt": "..." }
```

Same when you `GET /api/users/1`.

### 4. Add a custom endpoint

**Goal:** create `POST /posts/:id/publish` that flips the `published` flag.

The URL is derived from the **file path** under `app/routes/`. Square brackets mark dynamic segments.

```ts
// app/routes/posts/[id]/publish.ts
import { defineRoute, NotFound } from '@hopak/core';

export const POST = defineRoute({
  handler: async (ctx) => {
    const id = Number(ctx.params.id);
    const post = await ctx.db?.model('post').findOrFail(id);
    const updated = await ctx.db?.model('post').update(id, { published: true });
    return { previous: post.published, updated };
  },
});
```

Test:

```bash
curl -X POST http://localhost:3000/posts/1/publish
# → { "previous": false, "updated": { "id": 1, "published": true, ... } }
```

Export multiple methods from one file:

```ts
export const GET = defineRoute({ handler: () => ({ /* ... */ }) });
export const POST = defineRoute({ handler: () => ({ /* ... */ }) });
```

### 5. Override one auto-CRUD endpoint

**Goal:** replace just the `POST /api/posts` handler with custom logic, keep the other five auto-CRUD endpoints as they are.

Create a file at the matching path. **File routes always win.**

```ts
// app/routes/api/posts.ts
import { defineRoute, ValidationError } from '@hopak/core';

export const POST = defineRoute({
  handler: async (ctx) => {
    const body = (await ctx.body()) as { title?: string };
    if (!body.title?.startsWith('[DRAFT]')) {
      throw new ValidationError('Title must start with [DRAFT]');
    }
    const created = await ctx.db?.model('post').create({
      title: body.title,
      content: 'auto-generated draft',
    });
    return created;
  },
});
```

Now `POST /api/posts` runs your code, but `GET /api/posts`, `GET /api/posts/:id`, `PUT/PATCH/DELETE /api/posts/:id` still come from auto-CRUD.

### 6. Throw a typed error

**Goal:** stop processing and return a proper HTTP status with a JSON body.

Import a subclass of `HopakError` and throw it anywhere — the framework serialises it for you.

```ts
// app/routes/posts/[id]/claim.ts
import { defineRoute, NotFound, Forbidden } from '@hopak/core';

export const POST = defineRoute({
  handler: async (ctx) => {
    const id = Number(ctx.params.id);
    const post = await ctx.db?.model('post').findOne(id);
    if (!post) throw new NotFound(`Post ${id} not found`);
    if (post.published) throw new Forbidden('Published posts cannot be claimed');
    // ... rest of the logic
    return { ok: true };
  },
});
```

`NotFound` produces:

```
HTTP/1.1 404 Not Found
Content-Type: application/json

{ "error": "NOT_FOUND", "message": "Post 42 not found" }
```

Available out of the box: `ValidationError` (400), `Unauthorized` (401), `Forbidden` (403), `NotFound` (404), `Conflict` (409), `RateLimited` (429), `InternalError` (500).

### 7. Define a custom error

**Goal:** introduce a domain-specific error like `PaymentFailed (402)`.

```ts
// app/lib/errors.ts
import { HopakError } from '@hopak/core';

export class PaymentFailed extends HopakError {
  override readonly status = 402;
  override readonly code = 'PAYMENT_FAILED';
}

export class QuotaExceeded extends HopakError {
  override readonly status = 429;
  override readonly code = 'QUOTA_EXCEEDED';
}
```

Use it from any handler:

```ts
import { PaymentFailed } from '../lib/errors';

throw new PaymentFailed('Insufficient funds', { available: 5, required: 20 });
```

Response:

```
HTTP/1.1 402 Payment Required
Content-Type: application/json

{ "error": "PAYMENT_FAILED", "message": "Insufficient funds",
  "details": { "available": 5, "required": 20 } }
```

### 8. Query the database inside a handler

**Goal:** read/write rows from a custom route using the same typed client auto-CRUD uses.

`ctx.db.model('<name>')` returns a client with full CRUD, filters, ordering, and pagination.

```ts
// app/routes/posts-by-author/[userId].ts
import { defineRoute } from '@hopak/core';

export const GET = defineRoute({
  handler: async (ctx) => {
    const userId = Number(ctx.params.userId);
    const posts = await ctx.db?.model('post').findMany({
      where: { author: userId, published: true },
      orderBy: [{ field: 'id', direction: 'desc' }],
      limit: 20,
    });
    const total = await ctx.db?.model('post').count({ where: { author: userId } });
    return { posts, total };
  },
});
```

Full client surface:

```ts
client.findMany({ where?, orderBy?, limit?, offset? });
client.findOne(id);           // TRow | null
client.findOrFail(id);        // throws NotFound
client.count({ where? });
client.create(data);
client.update(id, data);      // throws NotFound if the row is gone
client.delete(id);            // returns boolean
```

If you need raw SQL: `ctx.db?.raw()` returns the underlying Drizzle instance.

### 9. Relations between models

**Goal:** one author has many posts; each post belongs to one author.

Use `belongsTo('user')` on the child side and `hasMany('post')` on the parent. `hasOne` / `hasMany` are **virtual** — they produce no database column, just a hint for tooling.

```ts
// app/models/user.ts
import { model, text, email, hasMany } from '@hopak/core';

export default model(
  'user',
  {
    name: text().required(),
    email: email().required().unique(),
    posts: hasMany('post'),   // virtual — no column
  },
  { crud: true },
);
```

```ts
// app/models/post.ts
import { model, text, belongsTo } from '@hopak/core';

export default model(
  'post',
  {
    title: text().required(),
    author: belongsTo('user'),   // creates `author_id` foreign key
  },
  { crud: true },
);
```

Create rows:

```bash
curl -X POST http://localhost:3000/api/users \
  -H 'content-type: application/json' -d '{"name":"Alice","email":"a@b.com"}'
# → { "id": 1, ... }

curl -X POST http://localhost:3000/api/posts \
  -H 'content-type: application/json' -d '{"title":"Hi","author":1}'
# → { "id": 1, "title": "Hi", "author": 1, ... }
```

### 10. Enable HTTPS for local dev

**Goal:** test your frontend against `https://localhost:3443` without configuring OpenSSL by hand.

**1.** Enable it in config:

```ts
// hopak.config.ts
import { defineConfig } from '@hopak/core';

export default defineConfig({
  server: { https: { enabled: true, port: 3443 } },
});
```

**2.** Restart:

```bash
hopak dev
```

First boot generates a self-signed certificate under `.hopak/certs/` (the directory is `.gitignore`d automatically). Subsequent boots reuse it.

**3.** Verify:

```bash
curl -k https://localhost:3443/           # -k accepts the self-signed cert
```

For **production**, point to real certificate files:

```ts
server: {
  https: { enabled: true, cert: '/etc/ssl/myapp.crt', key: '/etc/ssl/myapp.key' },
}
```

### 11. Allow CORS from your frontend

**Goal:** let a Vite/Next frontend at `http://localhost:5173` call your API with cookies.

```ts
// hopak.config.ts
import { defineConfig } from '@hopak/core';

export default defineConfig({
  cors: {
    origins: ['http://localhost:5173', 'https://myapp.com'],
    credentials: true,
  },
});
```

Preflight (`OPTIONS`) is handled automatically. Requests from origins not in the list get no CORS headers — browsers reject them.

Public API? Use `'*'`:

```ts
cors: { origins: '*' }
```

### 12. Serve static files

**Goal:** serve `favicon.ico`, images, a built SPA, etc.

Drop files in `public/`. They're served at the root:

```
public/
├── index.html        → GET /              (served if no file route matches)
├── favicon.ico       → GET /favicon.ico
└── assets/
    ├── logo.svg      → GET /assets/logo.svg
    └── app.js        → GET /assets/app.js
```

Hopak sets `ETag`, `Cache-Control: public, max-age=300`, and `Last-Modified` headers. Path-traversal attempts (`/../../etc/passwd`) return `404`. No setup required.

A file-based route always wins over a static file at the same path — useful if you want `/` to be a JSON endpoint even when `public/index.html` exists.

### 13. Move your source somewhere else

**Goal:** use `src/domain/` and `src/api/` instead of `app/models/` and `app/routes/`.

```ts
// hopak.config.ts
import { defineConfig } from '@hopak/core';

export default defineConfig({
  paths: {
    models: 'src/domain',
    routes: 'src/api',
    public: 'static',
  },
});
```

After this, `hopak generate model post` writes to `src/domain/post.ts`, and `hopak dev` / `hopak check` look in the new directories. All paths resolve relative to the project root.

### 14. Scaffold files from the CLI

**Goal:** don't write boilerplate by hand — let `hopak generate` create the file with a starter template.

```bash
hopak generate model comment
# Creates app/models/comment.ts
```

Contents of the generated file:

```ts
import { model, text } from '@hopak/core';

export default model(
  'comment',
  {
    name: text().required(),
  },
  { crud: true },
);
```

Replace the fields with your real schema and save — hot-reload picks it up.

```bash
hopak generate route posts/[id]/publish
# Creates app/routes/posts/[id]/publish.ts
```

```ts
import { defineRoute } from '@hopak/core';

export const GET = defineRoute({
  handler: (ctx) => ({ ok: true, path: ctx.path }),
});
```

Rename `GET` to `POST` (or add more methods) for the actual handler. Short form: `hopak g model comment` works too.

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

Enable in config — Hopak generates a self-signed certificate on first run and caches it under `.hopak/certs/`. Requires `openssl` on the machine.

```ts
// hopak.config.ts
import { defineConfig } from '@hopak/core';

export default defineConfig({
  server: {
    https: { enabled: true, port: 3443 },
  },
});
```

```ts
// main.ts — no changes needed
import { hopak } from '@hopak/core';
await hopak().listen();
```

In production: supply your own cert and key paths:

```ts
server: {
  https: { enabled: true, cert: '/etc/ssl/cert.pem', key: '/etc/ssl/key.pem' },
}
```

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

## Author

**Volodymyr Press** · [vladimpress@gmail.com](mailto:vladimpress@gmail.com) · [github.com/hopakjs](https://github.com/hopakjs)

Made with ❤️ in Ukraine 🇺🇦
