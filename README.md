<h1 align="center">Hopak.js</h1>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#recipes">Recipes</a> ·
  <a href="#models">Models</a> ·
  <a href="#crud">CRUD</a> ·
  <a href="#routes">Routes</a> ·
  <a href="#request-context">Context</a> ·
  <a href="#validation">Validation</a> ·
  <a href="#errors">Errors</a> ·
  <a href="#database">Database</a> ·
  <a href="#static-files">Static</a> ·
  <a href="#cors">CORS</a> ·
  <a href="#https">HTTPS</a> ·
  <a href="#configuration">Config</a> ·
  <a href="#cli">CLI</a> ·
  <a href="#upgrading-from-01x">Upgrading</a>
</p>

## Upgrading from 0.1.x

`@hopak/core@0.2.0` is a **breaking** release. The change in spirit:
nothing materializes at runtime from a declaration any more — CRUD
endpoints and dev certs are scaffolded by the CLI, the runtime just
executes whatever is in your files.

**What to do if you're on 0.1.x:**

1. Upgrade the CLI: `bun add -g @hopak/cli@latest`.
2. Upgrade the framework: `bun add @hopak/core@latest @hopak/testing@latest` in your project.
3. For every model that had `{ crud: true }`, run once:
   ```bash
   hopak generate crud <model-name>
   ```
   That writes `app/routes/api/<plural>.ts` and
   `app/routes/api/<plural>/[id].ts` with the same six verbs the
   runtime used to inject. Remove `{ crud: true }` from the model
   file (it's just a type error now, no behavioral effect):
   ```ts
   // before
   export default model('post', { ... }, { crud: true });
   // after
   export default model('post', { ... });
   ```
4. If you had `server.https.enabled: true`, run `hopak generate cert`
   once. Boot no longer calls openssl behind your back — if the cert
   files aren't there, `hopak dev` fails fast with a pointer to this
   command.
5. If you used `@hopak/testing`'s `createTestServer({ withCrud: true })`,
   switch to wiring routes via the new `crud.*` helpers (or pass
   `rootDir` to test the project end-to-end). See `@hopak/testing`'s
   README.

**Also removed** (they existed on the type but were never wired to
anything — deleting is mechanical):

- `ModelOptions.owner`
- `ModelOptions.publicRead`
- `ModelOptions.auth`
- `ModelOptions.softDelete`

Nothing else in the public surface changed — models, relations,
query ergonomics, validation, serialization, errors, HTTPS / CORS
config, `hopak use`, `hopak sync`, `hopak check` all behave exactly
as before.

## Quick start

```bash
bun add -g @hopak/cli
hopak new my-app           # SQLite by default (zero-install)
cd my-app
hopak dev
```

Want Postgres or MySQL from the start? Pick the dialect at creation
time — the driver gets installed, `hopak.config.ts` is pre-set, and
`.env.example` already has `DATABASE_URL`:

```bash
hopak new my-app --db postgres
hopak new my-app --db mysql
hopak new my-app --db sqlite   # explicit opt-in (default)
```

Already inside a project? Switch dialects:

```bash
hopak use postgres         # installs `postgres` driver, patches config, updates .env.example
hopak use mysql            # installs `mysql2`, etc.
hopak use sqlite           # back to default
```

Server on `http://localhost:3000`. Scaffold a model + its REST files
with two commands (`hopak generate model/crud`) and you get
validation, JSON serialization, static files — zero runtime magic,
every route is in source.

---

## Recipes

Common backend tasks, step by step. Every recipe shows **where the
file goes**, the **code**, **how to run it**, and **what you should
see**. Start from a freshly scaffolded project:

```bash
hopak new my-app          # SQLite by default (zero-install, works offline)
cd my-app
```

`hopak new` runs `bun install` for you — no separate step. Want a
different dialect from the start? Pass `--db`:

```bash
hopak new my-app --db postgres      # or --db mysql / --db sqlite
```

Picking the dialect up front writes the right `database:` block into
`hopak.config.ts`, adds the driver to `package.json`, and seeds
`.env.example` with a `DATABASE_URL` placeholder. See
[Recipe 17](#17-pick-or-switch-the-database) for the full flow of
both `hopak new --db` and `hopak use`.

Every recipe below assumes the default SQLite unless explicitly
noted — the runtime behavior is identical on every dialect, so code
examples are copy-paste portable.

### 1. Create a REST resource

**Goal:** expose `GET/POST /api/posts` and `GET/PUT/PATCH/DELETE /api/posts/:id`.

**1.** Generate the model + CRUD route files:

```bash
hopak generate model post
hopak generate crud post
```

The first command writes `app/models/post.ts`. The second writes two
route files — `app/routes/api/posts.ts` (list + create) and
`app/routes/api/posts/[id].ts` (read + replace + patch + delete). Open
either file; the entire REST surface is there as plain code you can
read and edit — nothing is synthesized at runtime.

**2.** Add your fields to the model:

```ts
// app/models/post.ts
import { model, text, boolean } from '@hopak/core';

export default model('post', {
  title: text().required().min(3),
  content: text().required(),
  published: boolean().default(false),
});
```

**3.** Start the server:

```bash
hopak dev
```

On first boot Hopak creates the SQLite file at `.hopak/data.db` and runs `CREATE TABLE IF NOT EXISTS` for every model. Safe to repeat — `hopak sync` does the same thing explicitly if you prefer to separate schema sync from server start (handy for CI or a fresh Postgres / MySQL database).

**4.** Try it from another terminal:

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

**5.** List them:

```bash
curl http://localhost:3000/api/posts
# → { "items": [...], "total": 1, "limit": 20, "offset": 0 }

curl 'http://localhost:3000/api/posts?limit=5&offset=10'
# pagination via query string; limit defaults to 20, max 100
```

**6.** Verify what's actually registered:

```bash
hopak check
# ✓ Models   1 loaded (post)
# ✓ Routes   6 file route(s)
```

Six endpoints from two generated files: list, read, create, replace, patch, delete — all paginated and validated. The plural segment (`/api/posts`) comes from `pluralize('post')` — irregular plurals are handled (`story → stories`, `box → boxes`). Don't want endpoints for a given model? Just don't run `hopak generate crud` for it — the model still becomes a table, you just don't expose HTTP routes.

### 2. Validate input

**Goal:** reject malformed requests with clear, per-field error messages.

Validation is generated **from the model** — you don't write a separate schema. `POST` and `PUT` validate the full object; `PATCH` validates a partial one automatically.

**1.** Add constraints:

```ts
// app/models/user.ts
import { model, text, email, enumOf, number } from '@hopak/core';

export default model('user', {
  name: text().required().min(2).max(100),
  email: email().required().unique(),
  age: number().optional().min(18).max(120),
  role: enumOf('admin', 'user', 'guest').default('user'),
});
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

Every failing field has an array of human-readable messages under `details`.

#### `.unique()` — where the check happens

`.unique()` is a **database-level** constraint — it's enforced by SQLite when the row is inserted. Hopak catches the `UNIQUE constraint failed` and surfaces it as `409 Conflict`, not `400`:

```json
{ "error": "CONFLICT", "message": "Unique constraint violated" }
```

So there are two response shapes to expect from a create call:

| Bad input | Response |
|---|---|
| Wrong shape / type / range | `400 VALIDATION_ERROR` with `details` |
| Shape valid, already exists | `409 CONFLICT` |

#### Validate in a custom route

When writing your own handler, validate with the same schema the CRUD helpers use:

```ts
// app/routes/api/signup.ts
import {
  buildModelSchema,
  defineRoute,
  serializeForResponse,
  validate,
  ValidationError,
} from '@hopak/core';
import user from '../../models/user';

const schema = buildModelSchema(user, { omitId: true });

export const POST = defineRoute({
  handler: async (ctx) => {
    const result = validate(schema, await ctx.body());
    if (!result.ok) {
      throw new ValidationError('Invalid signup', result.errors);
    }
    const row = await ctx.db!.model('user').create(result.data);
    // `serializeForResponse` strips `password` / `secret` / `token`
    // columns. The `crud.*` helpers do this automatically; a hand-
    // written handler has to call it explicitly or the hash leaks.
    return serializeForResponse(row, user);
  },
});
```

`buildModelSchema(model, { partial: true })` gives the `PATCH`-flavoured schema. `result.errors` is `Record<field, string[]>` — the same shape the CRUD helpers send back.

> **Sensitive fields in custom routes:** `password()`, `secret()`,
> and `token()` are stripped by the serializer, and `crud.list` /
> `crud.create` / etc. pass every row through it. A custom handler
> that returns a model row directly — `return ctx.db!.model('user')
> .findOne(id)` — skips that step, and the DB column (argon2 hash,
> API key, etc.) lands in the response. Always wrap the row in
> `serializeForResponse(row, model)` before returning.

#### Throw your own field errors

If a rule is domain-specific (not a field constraint), throw `ValidationError` with a `details` map — it renders identically:

```ts
if (body.password === body.email) {
  throw new ValidationError('Invalid body', {
    password: ['Password must differ from email'],
  });
}
```

### 3. Hide sensitive fields

**Goal:** store passwords and API tokens in the database, but **never** return them in responses.

Three field types are marked sensitive by Hopak and stripped from every JSON response:

| Field | Use for |
|---|---|
| `password()` | Login passwords (still stored as plain string — **hash them yourself** before insert) |
| `secret()` | Signing keys, OAuth client secrets, internal tokens |
| `token()` | API keys, bearer tokens, refresh tokens |

Exclusion happens in the serializer for **every** CRUD endpoint: list, single, create reply, update reply. It also applies to any value you return from a custom route that includes one of these columns (for example `return await ctx.db.model('user').findOne(1)`).

```ts
// app/models/user.ts
import { model, text, email, password, token } from '@hopak/core';

export default model('user', {
  name: text().required(),
  email: email().required().unique(),
  password: password().required().min(8),
  apiKey: token().optional(),
});
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

#### Reading the value on the server

The field is not removed from the database — only from JSON output. Server-side code still sees it:

```ts
const row = await ctx.db?.model('user').findOrFail(id);
// row.password is the string that was stored — use it for auth:
const ok = await Bun.password.verify(submitted, row.password);
```

Just don't `return row` directly after touching `row.password` — the serializer will drop the field anyway, but the habit to build is **never** include it in an API surface.

#### Writing the value

`POST` / `PATCH` bodies accept the field normally — validation still runs (`.min(8)` etc.). Hash before insert with `Bun.password.hash(plain)` (argon2id by default) in a custom route or a pre-insert hook.

> Hopak does not auto-hash. `password()` means *don't leak on read*, not *encrypt on write*.

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

#### File path → URL

| File | URL |
|---|---|
| `app/routes/health.ts` | `GET /health` (and any method exported) |
| `app/routes/index.ts` | `GET /` |
| `app/routes/api/posts.ts` | `/api/posts` |
| `app/routes/posts/[id].ts` | `/posts/:id` — `ctx.params.id` is a string |
| `app/routes/posts/[id]/publish.ts` | `/posts/:id/publish` |
| `app/routes/files/[...rest].ts` | `/files/*` catch-all — `ctx.params.rest` is the remaining path |

All path params arrive as **strings**. Convert yourself (`Number(ctx.params.id)`), or validate with the model schema.

#### Multiple methods in one file

Export one function per HTTP method:

```ts
// app/routes/posts/[id].ts
import { defineRoute } from '@hopak/core';

export const GET    = defineRoute({ handler: (ctx) => ({ id: ctx.params.id }) });
export const POST   = defineRoute({ handler: async (ctx) => ({ created: await ctx.body() }) });
export const DELETE = defineRoute({ handler: (ctx) => ({ deleted: ctx.params.id }) });
```

An un-exported method returns `405 Method Not Allowed` automatically. A `default` export is treated as `GET`.

#### Reading the request

Inside the handler, everything you need is on `ctx`:

```ts
ctx.params.id              // string — path param
ctx.query.get('tag')       // URLSearchParams — ?tag=foo
ctx.headers.get('authorization')
await ctx.body()           // parsed JSON (cached — safe to call twice)
await ctx.text()           // raw body (also cached)
ctx.ip                     // client IP or undefined
```

Return anything — plain object, string, `Response`, `null` — the framework serializes it. See [Request context](#request-context) for the full surface.

### 5. Customize one CRUD endpoint

**Goal:** replace just the `POST /api/posts` handler with custom logic, keep the other five endpoints as they are.

The CRUD files are plain source. Open `app/routes/api/posts.ts` and
replace the `POST` export with your own `defineRoute(...)`:

```ts
// app/routes/api/posts.ts
import { crud, defineRoute, ValidationError } from '@hopak/core';
import post from '../../models/post';

export const GET = crud.list(post);

export const POST = defineRoute({
  handler: async (ctx) => {
    const body = (await ctx.body()) as { title?: string };
    if (!body.title?.startsWith('[DRAFT]')) {
      throw new ValidationError('Title must start with [DRAFT]');
    }
    return ctx.db!.model('post').create({
      title: body.title,
      content: 'auto-generated draft',
    });
  },
});
```

`GET /api/posts` still comes from `crud.list`; the item-level file
(`posts/[id].ts`) is untouched.

#### Disable a single verb

Delete that verb's export. The router will answer `405 Method Not
Allowed` with an `Allow:` header listing the verbs that remain.

```ts
// app/routes/api/posts/[id].ts — DELETE removed
import { crud } from '@hopak/core';
import post from '../../../models/post';

export const GET = crud.read(post);
export const PUT = crud.update(post);
export const PATCH = crud.patch(post);
// no DELETE — clients see 405 with Allow: GET, PUT, PATCH
```

#### Skip CRUD entirely for this model

Don't run `hopak generate crud` for it, or delete the two generated
files. The model still becomes a table and can be queried via
`ctx.db!.model('post')` from any custom route you write.

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

#### Built-in subclasses

| Class | Status | `error` code |
|---|---|---|
| `ValidationError` | 400 | `VALIDATION_ERROR` |
| `Unauthorized` | 401 | `UNAUTHORIZED` |
| `Forbidden` | 403 | `FORBIDDEN` |
| `NotFound` | 404 | `NOT_FOUND` |
| `Conflict` | 409 | `CONFLICT` |
| `RateLimited` | 429 | `RATE_LIMITED` |
| `InternalError` | 500 | `INTERNAL_ERROR` |
| `ConfigError` | 500 | `CONFIG_ERROR` |

Every subclass accepts an optional second `details` argument that is rendered under `"details"`:

```ts
throw new Unauthorized('Invalid token', { reason: 'expired' });
// 401 { "error": "UNAUTHORIZED", "message": "Invalid token",
//        "details": { "reason": "expired" } }
```

#### Unknown errors

Anything that is **not** a `HopakError` (a raw `Error`, a rejected promise, a thrown string) becomes:

```
HTTP/1.1 500 Internal Server Error
{ "error": "INTERNAL_ERROR", "message": "Internal server error" }
```

The original error is logged with `ctx.log.error(...)` — nothing about the cause leaks to the client. Set `server.exposeStack: true` in dev to include the stack trace in the response body (handy when debugging; never enable in production).

### 7. Define a custom error

**Goal:** introduce a domain-specific error like `PaymentFailed (402)`.

Subclass `HopakError` and override `status` and `code`. Both fields are `readonly`, so declare them with `override readonly`:

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

#### Where to put them

Any path under the project works — the error classes are plain TypeScript, not picked up by a scanner. Common patterns:

- `app/lib/errors.ts` — one shared file
- `app/models/<domain>/errors.ts` — co-located with the feature that raises them

Just `import` and `throw`. There's no registration step.

#### `details` is free-form

The constructor accepts anything serialisable as the second argument. It's rendered verbatim under `"details"`, so choose a shape that's useful for the client:

```ts
throw new QuotaExceeded('Monthly quota exceeded', {
  limit: 1000,
  used: 1000,
  resetsAt: '2026-05-01T00:00:00Z',
});
```

### 8. Query the database inside a handler

**Goal:** read/write rows from a custom route using the same typed client CRUD uses.

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

#### Full client surface

```ts
client.findMany({ where?, orderBy?, limit?, offset? });
client.findOne(id);           // TRow | null
client.findOrFail(id);        // throws NotFound(`<model>:<id>`)
client.count({ where? });
client.create(data);          // returns the inserted row, id included
client.update(id, data);      // partial update — throws NotFound if the row is gone
client.delete(id);            // boolean — false if it didn't exist
```

All methods are fully typed from the model — `data` has to match the field shape, `row.title` is `string`, etc.

#### Filters — what `where` supports

Plain values mean equality (`where: { published: true }`). For comparisons,
substring matches, `IN`, `BETWEEN`, `OR`, `NOT` — see **Recipe 10**. A full
reference of every operator lives there.

#### Pagination defaults

```ts
client.findMany({})                  // no limit, no offset
client.findMany({ limit: 20 })       // LIMIT 20
client.findMany({ limit: 20, offset: 40 })
```

The typed client passes `limit` through as-is. **CRUD endpoints**
(reached via HTTP) enforce a cap of `100` on the `?limit=` query param
so public traffic can't ask for millions of rows; direct client calls
inside your handlers have no such cap.

#### Raw SQL / Drizzle access

Anything the typed client can't do, you do with `raw()`:

```ts
import { defineRoute } from '@hopak/core';
import { sql } from 'drizzle-orm';

export const GET = defineRoute({
  handler: async (ctx) => {
    const drizzle = ctx.db?.raw();
    const rows = await drizzle?.all<{ author: number; n: number }>(
      sql`SELECT author, COUNT(*) as n FROM post GROUP BY author ORDER BY n DESC LIMIT 10`,
    );
    return { topAuthors: rows };
  },
});
```

`raw()` returns the Drizzle instance — use `sql` tagged templates, `db.select().from(table)`, transactions, whatever Drizzle exposes. Good escape hatch for reports, aggregations, or migrations.

#### `ctx.db` is `undefined` when there are no models

If the project has zero models, Hopak doesn't open a database — `ctx.db` stays `undefined`. Handlers that require it can narrow with `ctx.requireDb?.()`, or check explicitly:

```ts
if (!ctx.db) throw new InternalError('Database not configured');
```

A normal app with at least one model in `app/models/` always has `ctx.db` set.

### 9. Relations between models

**Goal:** one author has many posts; each post belongs to one author.

Hopak has two kinds of relation fields:

| Field | Creates a column? | Meaning |
|---|---|---|
| `belongsTo('user')` | ✅ `user_id` (integer FK) | this row points to a parent |
| `hasOne('profile')` / `hasMany('post')` | ❌ virtual | hint for tooling, no schema impact |

```ts
// app/models/user.ts
import { model, text, email, hasMany } from '@hopak/core';

export default model('user', {
  name: text().required(),
  email: email().required().unique(),
  posts: hasMany('post'),   // virtual — no column
});
```

```ts
// app/models/post.ts
import { model, text, belongsTo } from '@hopak/core';

export default model('post', {
  title: text().required(),
  author: belongsTo('user'),   // creates `author_id` foreign key
});
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

#### The FK field in the API

The **API field** is what you named in the model (`author`). The **column name** is `<field>_id` under the hood, but you don't interact with it — Hopak maps both directions. Send `{ "author": 1 }` in JSON; filter with `{ where: { author: 1 } }` in the client; receive `"author": 1` in responses.

Foreign-key integrity is enforced by SQLite — inserting a post with `author: 999` where user 999 doesn't exist returns `409 CONFLICT`.

#### Eager-load relations

Hopak batches relation fetches into a single `WHERE id IN (...)` query —
no N+1 problem. See Recipe 11 for the full API:

```ts
await ctx.db.model('post').findMany({ include: { author: true } });
await ctx.db.model('user').findMany({ include: { posts: true, profile: true } });
```

#### Migrations

`hopak sync` (and `hopak dev`'s first boot) creates the column and the FK
constraint via `CREATE TABLE IF NOT EXISTS` — idempotent replay, no
`ALTER TABLE`. Changing a `belongsTo` target on an existing table doesn't
alter data; for prototyping, delete `.hopak/data.db` (or drop the table
on Postgres / MySQL) and sync again.

### 10. Filter with operators — `gte`, `like`, `in`, `between`, `OR`, `NOT`

**Goal:** build real-world `findMany` queries — ranges, substring matches,
OR branches, nullability checks — without writing SQL.

Every filter lives under `where`. A literal value means equality. An object
with one of the operator keys switches to the corresponding comparison:

```ts
await ctx.db.model('post').findMany({
  where: {
    published: true,                              // equality (unchanged)
    views: { gte: 100 },                          // >= 100
    title: { contains: 'hopak' },                 // substring, case-insensitive
    createdAt: { between: [start, end] },         // inclusive range
    author: { in: [1, 2, 3] },                    // IN (1, 2, 3)
    OR: [{ featured: true }, { score: { gt: 50 } }],
    NOT: { archived: true },
  },
  orderBy: [{ field: 'views', direction: 'desc' }],
  limit: 20,
});
```

#### Operator reference

| Operator | SQL | Notes |
|---|---|---|
| `eq`, `neq` | `=`, `!=` | Equality (explicit); `eq` is the default for literal values |
| `gt`, `gte`, `lt`, `lte` | `>`, `>=`, `<`, `<=` | Numeric / date comparisons |
| `in`, `notIn` | `IN (...)`, `NOT IN (...)` | Array of values |
| `between` | `BETWEEN x AND y` | Inclusive range — `[min, max]` |
| `contains` | `LIKE '%x%'` | Substring match, wildcards auto-escaped |
| `startsWith` | `LIKE 'x%'` | Prefix match |
| `endsWith` | `LIKE '%x'` | Suffix match |
| `like` | `LIKE 'x'` | Raw pattern — you control `%` and `_` yourself |
| `ilike` | `ILIKE 'x'` (PG) / `LIKE` (SQLite+MySQL, case-insensitive by default) | Case-insensitive substring/pattern |
| `isNull`, `isNotNull` | `IS NULL`, `IS NOT NULL` | Pass `true` as the value |

#### Combining clauses

| Key | Behavior |
|---|---|
| Top-level fields | Implicit `AND` across all keys |
| `AND: [...]` | Explicit AND — useful for combining pre-built clauses |
| `OR: [...]` | Any of the branches matches |
| `NOT: {...}` | Negate a sub-clause |

```ts
// Posts that are published AND (views >= 100 OR featured)
await posts.findMany({
  where: {
    published: true,
    OR: [{ views: { gte: 100 } }, { featured: true }],
  },
});
```

#### Gotcha: LIKE wildcards are escaped

When you pass a literal `%` or `_` into `contains` / `startsWith` / `endsWith`,
Hopak escapes them for you. `contains: '100%'` matches a literal "100%" in
the data, not "anything ending in 100 followed by anything". For raw LIKE
patterns where you control the wildcards yourself, use `like: '...'`.

### 11. Load related rows with `include` — N+1-free

**Goal:** fetch posts with their authors, or users with their posts — in a
single batched query per relation (not one query per primary row).

```ts
// app/models/user.ts
model('user', {
  name: text().required(),
  email: email().required().unique(),
  posts: hasMany('post'),
  profile: hasOne('profile'),
});

// app/models/post.ts
model('post', {
  title: text().required(),
  author: belongsTo('user'),
});

// app/models/profile.ts
model('profile', {
  bio: text().required(),
  owner: belongsTo('user'),
});
```

#### `belongsTo` — fetch the parent

```ts
const posts = await ctx.db.model('post').findMany({
  include: { author: true },
});
// [{ id: 1, title: 'Hello', author: { id: 7, name: 'Alice', ... } }, ...]
```

Under the hood: one `SELECT * FROM posts` + one `SELECT * FROM users WHERE
id IN (<unique author ids>)`. Hopak indexes the result and stitches it onto
each post. Two queries total, regardless of how many posts you fetched.

#### `hasMany` — fetch the children, filtered and ordered

```ts
const users = await ctx.db.model('user').findMany({
  include: {
    posts: {
      where: { published: true },
      orderBy: [{ field: 'createdAt', direction: 'desc' }],
    },
  },
});
// [{ id: 1, name: 'Alice', posts: [{...}, {...}] }, ...]
```

One query for users, one query for `SELECT * FROM posts WHERE author IN
(<user ids>) AND published = true ORDER BY created_at DESC`. Then grouped
by FK and attached. Parents with no matching children get `posts: []`.

#### `hasOne` — fetch single child (or null)

```ts
const users = await ctx.db.model('user').findMany({
  include: { profile: true },
});
// [{ id: 1, ..., profile: { bio: 'Hi' } }, { id: 2, ..., profile: null }]
```

#### Multiple includes in one call

```ts
await ctx.db.model('user').findMany({
  include: {
    posts: true,
    profile: true,
    comments: { orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 5 },
  },
});
```

Still N+1-free: one query for users, one per relation. Three queries total
for this example, no matter how many users came back.

### 12. Upsert and bulk writes

**Goal:** "insert-or-update in one call", plus `createMany` / `updateMany` /
`deleteMany` for bulk operations.

#### Upsert

```ts
const user = await ctx.db.model('user').upsert({
  where: { email: 'alice@example.com' },   // conflict target
  create: { name: 'Alice', password: 'hash' },
  update: { name: 'Alice Updated' },
});
```

- If no row matches `where` → inserts `{ ...where, ...create }`
- If a row matches → updates it with `update`, returns the fresh row

Under the hood: `ON CONFLICT (email) DO UPDATE` on SQLite + Postgres,
`ON DUPLICATE KEY UPDATE` on MySQL. The `where` keys must correspond to
a UNIQUE constraint or primary key, otherwise the conflict never triggers.

#### Batch operations

All three return `{ count: number }`:

```ts
const { count: created } = await posts.createMany([
  { title: 'a', content: 'x' },
  { title: 'b', content: 'y' },
  { title: 'c', content: 'z' },
]);
// created === 3

const { count: updated } = await posts.updateMany({
  where: { published: false },
  data: { published: true, reviewedAt: new Date() },
});

const { count: deleted } = await posts.deleteMany({
  where: { views: { lt: 5 }, createdAt: { lt: thirtyDaysAgo } },
});
```

#### Gotcha: `deleteMany({})` deletes everything

An empty `where` object matches all rows — deliberately, so `deleteMany({})`
is the explicit "truncate via the ORM" escape hatch. If you want to be sure
a filter is present at runtime, assert it yourself before calling.

### 13. Aggregate — sum, avg, count (with optional `groupBy`)

**Goal:** run statistics over the rows without writing SQL.

#### Single-row aggregate (across all matching rows)

```ts
const result = await ctx.db.model('post').aggregate({
  where: { published: true },
  sum: ['views', 'likes'],
  avg: ['rating'],
  min: ['createdAt'],
  max: ['createdAt'],
  count: '_all',             // total row count
});

// {
//   sum:   { views: 12400, likes: 356 },
//   avg:   { rating: 4.2 },
//   min:   { createdAt: 2024-03-01T... },
//   max:   { createdAt: 2026-04-20T... },
//   count: { _all: 142 },
// }
```

`count: ['field']` counts non-null values of that column (useful on
nullable fields). `count: '_all'` is `COUNT(*)` — every row.

#### Grouped aggregate — one result row per distinct group

```ts
const perAuthor = await posts.aggregate({
  where: { published: true },
  groupBy: ['author'],
  sum: ['views'],
  count: '_all',
});

// [
//   { author: 1, sum: { views: 5400 }, count: { _all: 42 } },
//   { author: 2, sum: { views: 1800 }, count: { _all: 15 } },
//   ...
// ]
```

`groupBy` flips the return type to an array of result rows. Each row
contains the group-by column values plus the aggregates. To sort or
paginate, pull the result down and do it in JS — or drop to `raw()` for
server-side `ORDER BY sum(views) DESC LIMIT 10`.

### 14. Cursor pagination (keyset)

**Goal:** paginate large tables efficiently — `LIMIT/OFFSET` scans skipped
rows, cursor pagination jumps straight to the next page in `O(log n)`.

```ts
// Page 1
const page1 = await posts.findMany({
  orderBy: [{ field: 'id', direction: 'asc' }],
  limit: 20,
});

// Page 2 — pass the last id from page 1 as the cursor
const page2 = await posts.findMany({
  cursor: { id: page1.at(-1)?.id },
  orderBy: [{ field: 'id', direction: 'asc' }],
  limit: 20,
});

// Page 3 — and so on
const page3 = await posts.findMany({
  cursor: { id: page2.at(-1)?.id },
  orderBy: [{ field: 'id', direction: 'asc' }],
  limit: 20,
});
```

The cursor column must be in `orderBy` — the direction there decides whether
the cursor means "strictly after" (`asc`) or "strictly before" (`desc`).

#### Typical API shape for infinite scroll

```ts
// app/routes/api/posts/feed.ts
export const GET = defineRoute({
  handler: async (ctx) => {
    const cursor = ctx.query.get('cursor');
    const posts = await ctx.db!.model('post').findMany({
      cursor: cursor ? { id: Number(cursor) } : undefined,
      orderBy: [{ field: 'id', direction: 'desc' }],
      limit: 20,
    });
    return {
      items: posts,
      nextCursor: posts.length === 20 ? posts.at(-1)?.id : null,
    };
  },
});
```

#### Gotchas

- **Single-column cursors only.** Multi-column keyset (e.g. `(createdAt, id)`
  for stable ordering when `createdAt` ties) needs tuple-comparison syntax
  that differs across dialects. For that case, sort by a stably-unique
  column (like `id`) or drop to `raw()` with a composite WHERE.
- Cursor values must be non-null. Passing `cursor: { id: null }` throws.
- The cursor key must appear in `orderBy`; otherwise the direction is
  ambiguous and Hopak throws with a pointer.

### 15. Transactions and row locks

**Goal:** atomic multi-write operations, plus safe concurrent updates via
`SELECT ... FOR UPDATE`.

#### Basic transaction — commit on resolve, rollback on throw

```ts
await ctx.db.transaction(async (tx) => {
  const user = await tx.model('user').create({ name: 'Alice', email: 'a@b.c' });
  await tx.model('profile').create({ bio: 'hi', owner: user.id });
});
// Both rows persisted atomically.
// If the second create fails, the first is rolled back.
```

The `tx` argument is a scoped `Database` — same API as `ctx.db`, but every
`tx.model(...)` call participates in the transaction. **Outside** queries
on `ctx.db` are *not* in the transaction.

#### Rollback propagates from any `throw`

```ts
await ctx.db.transaction(async (tx) => {
  await tx.model('account').update(fromId, { balance: fromBalance - 100 });
  await tx.model('account').update(toId, { balance: toBalance + 100 });

  if (!await checkFraud(tx, toId)) {
    throw new Forbidden('suspicious transfer');
  }
});
// If `checkFraud` throws, both updates are rolled back.
// The thrown error still reaches the caller.
```

Typed `HopakError` subclasses (`NotFound`, `Forbidden`, etc.) work the same
way — the framework error handler formats the response, the transaction
rolls back cleanly.

#### Pessimistic row locking — `SELECT ... FOR UPDATE`

For "read-then-modify" patterns under concurrency (counters, balances,
queues), reading with `lock: 'forUpdate'` takes an exclusive lock on the
row until the transaction commits or rolls back. A second concurrent
transaction doing the same read **waits** for the first.

```ts
await ctx.db.transaction(async (tx) => {
  const account = await tx.model('account').findOrFail(id, { lock: 'forUpdate' });
  await tx.model('account').update(id, { balance: account.balance + amount });
});
```

Without the lock, two concurrent increments race and one is lost. With it,
they serialize: second waits, reads the committed new value, adds on top.

| Dialect | Behavior |
|---|---|
| Postgres | Native `SELECT ... FOR UPDATE` |
| MySQL | Native `SELECT ... FOR UPDATE` |
| SQLite | Silent no-op — SQLite transactions are already single-writer (exclusive) |

`lock: 'forShare'` is the weaker variant — shared lock, multiple readers OK,
blocks writers. Used for "I'm reading this row and don't want it to change
while I decide what to do."

#### Caveats

- **No nested transactions.** Calling `tx.transaction(...)` inside a
  transaction throws. For partial rollback within a transaction, use
  SAVEPOINTs via `tx.raw()`.
- `lock` is supported on `findOne` / `findOrFail` / `findMany`. The lock
  applies only to the primary rows — an `include` issues a separate,
  unlocked query for relations.

### 16. Project specific columns — `select`, `distinct`

**Goal:** return only the columns the client needs (`select`) and
deduplicate rows (`distinct`).

#### `select` — column projection

```ts
const rows = await ctx.db.model('post').findMany({
  select: ['id', 'title'],
  where: { published: true },
});
// [{ id: 1, title: 'Hello' }, ...]   — no `content`, no `views`, nothing else
```

Typed as `Pick<TRow, 'id' | 'title'>[]`. Useful when:

- Rows carry heavy fields (`content: text()`, `json<T>()`, blob-like data)
  and you only need a list
- You want the wire format to match a specific client contract
- You're joining via `include` and don't want the base table's bulky
  columns

#### `select` + `include` plays nicely

```ts
const articles = await ctx.db.model('article').findMany({
  select: ['id', 'title'],
  include: { author: true },
});
// [{ id: 1, title: '...', author: { id: 7, name: 'Alice', email: '...' } }]
```

Even though you asked for only `id` and `title`, Hopak transparently pulls
the FK column it needs for the include, then replaces it with the nested
author object before returning.

#### `distinct: true` — deduplicate across all dialects

```ts
const titles = await posts.findMany({
  select: ['title'],
  distinct: true,
  orderBy: [{ field: 'title', direction: 'asc' }],
});
```

#### `distinct: ['col']` — Postgres `DISTINCT ON`

Postgres has `SELECT DISTINCT ON (col)` — "one row per distinct value of
`col`, with ORDER BY deciding which row wins." Useful for "each author's
most recent post" queries:

```ts
// Postgres only
await posts.findMany({
  distinct: ['author'],
  orderBy: [
    { field: 'author', direction: 'asc' },   // must come first
    { field: 'createdAt', direction: 'desc' },
  ],
});
```

On SQLite / MySQL this throws with a pointer — that SQL extension isn't
standard, and there's no clean portable rewrite. Use `raw()` or a
subquery if you need the same semantics cross-dialect.

### 17. Pick or switch the database

**Goal:** use Postgres or MySQL instead of the default SQLite.

There are two entry points depending on where you are.

#### 17a. At project creation — `hopak new --db postgres`

Pick the dialect up front; `hopak new` wires everything in one pass.

```bash
hopak new my-app --db postgres
cd my-app
```

What happens:

1. **`hopak.config.ts`** is written with
   `database: { dialect: 'postgres', url: process.env.DATABASE_URL }`.
2. **`package.json`** lists `postgres` (or `mysql2` for MySQL) as a
   dependency — `bun install` picks it up during the same
   `hopak new` run.
3. **`.env.example`** contains a placeholder:
   `DATABASE_URL=postgres://user:pass@localhost:5432/myapp`.
4. **`README.md`** in the project tells you the extra setup step
   ("copy `.env.example` → `.env`, run `hopak sync`").

Next:

```bash
cp .env.example .env             # fill in real credentials
hopak sync                        # CREATE TABLE IF NOT EXISTS for every model
hopak dev                         # boots on port 3000
```

#### 17b. In an existing project — `hopak use postgres`

Switch an already-scaffolded project from one dialect to another.

```bash
hopak use postgres
```

What this does:

1. **Installs the driver** — `bun add postgres` (or `bun add mysql2`).
   SQLite ships with Bun — nothing to install there.
2. **Rewrites the `database:` block** in `hopak.config.ts`. The
   patcher recognizes the bare default from `hopak new` and replaces
   it cleanly; a tuned block (custom sqlite file path, extra URL
   params, `ssl` config, etc.) is left alone and the command prints
   a snippet for you to paste manually so it never silently discards
   your tuning.
3. **Adds `DATABASE_URL`** to `.env.example` if not already present.

Next:

```bash
# 1. Start Postgres locally (or use a managed one like Neon / Supabase / RDS)
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=hopak postgres:16-alpine

# 2. Fill DATABASE_URL in .env:
#    DATABASE_URL=postgres://postgres:hopak@localhost:5432/postgres

# 3. Sync schema + run
hopak sync
hopak dev
```

The rest of the project code is **unchanged** — models, CRUD routes,
`ctx.db.model(...)` — all work identically on every dialect.

#### Dialect differences (summary)

| Thing | SQLite | Postgres | MySQL |
|---|---|---|---|
| Install | bundled with Bun | `hopak use postgres` | `hopak use mysql` |
| Driver package | `bun:sqlite` | `postgres` (postgres.js) | `mysql2` |
| `ilike` | LIKE (case-insensitive ASCII) | native `ILIKE` | LIKE (case-insensitive collation) |
| `distinct: ['col']` | ✗ (throws) | ✓ DISTINCT ON | ✗ (throws) |
| `lock: 'forUpdate'` | silent no-op (serial writes already) | native FOR UPDATE | native FOR UPDATE |
| Unique on TEXT | inline `UNIQUE` | inline `UNIQUE` | separate `UNIQUE KEY (col(191))` — handled internally |
| FK constraints emitted | skipped | yes | yes |

Everything listed as "throws" or "handled internally" is about **how the
feature is emitted**, not whether your code has to change — you still write
`.unique()` or `lock: 'forUpdate'` in the same place.

### 18. Enable HTTPS for local dev

**Goal:** test your frontend against `https://localhost:3443` using a
self-signed cert.

**1.** Generate the dev cert:

```bash
hopak generate cert
# → Generating self-signed dev certificate { path: ".hopak/certs" }
# → Dev certificate ready. Re-run `hopak dev` with HTTPS enabled.
```

This runs `openssl req -x509` once and writes two files plus a
`.gitignore` that keeps them out of version control:

```
.hopak/certs/
├── dev.key     # private key (gitignored)
├── dev.crt     # self-signed cert (gitignored)
└── .gitignore  # `*` — ignores everything except itself
```

**Requires `openssl` on the machine.** macOS ships it. On
Ubuntu/Debian: `apt install openssl`. On Alpine: `apk add openssl`.

**2.** Turn HTTPS on in the config:

```ts
// hopak.config.ts
import { defineConfig } from '@hopak/core';

export default defineConfig({
  server: { https: { enabled: true, port: 3443 } },
});
```

**3.** Restart the dev server:

```bash
hopak dev
```

Hopak reads the cert pair from `.hopak/certs/dev.{key,crt}` and
serves both HTTP (port 3000) and HTTPS (port 3443). If the files
aren't there it fails fast with a pointer to `hopak generate cert` —
nothing is synthesized behind your back at boot.

**4.** Verify:

```bash
curl -k https://localhost:3443/           # -k accepts the self-signed cert
```

Browser will show a warning the first time — that's expected for a self-signed cert. Delete `.hopak/certs/` and re-run `hopak generate cert` to re-issue.

#### Trust the cert (remove the browser warning)

If the warning is blocking your frontend (e.g. a cookie with `SameSite=None; Secure` won't set), trust the cert once:

**macOS:**

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain .hopak/certs/localhost.crt
```

**Linux (Debian/Ubuntu):**

```bash
sudo cp .hopak/certs/localhost.crt /usr/local/share/ca-certificates/hopak-localhost.crt
sudo update-ca-certificates
```

Restart the browser to pick up the new trust store.

#### Production certificates

Supply real cert and key paths. Both files need to be readable by the user running Hopak:

```ts
// hopak.config.ts
server: {
  https: {
    enabled: true,
    port: 443,
    cert: '/etc/ssl/myapp.crt',
    key: '/etc/ssl/myapp.key',
  },
}
```

**Port 443 requires root** on Linux/macOS. Two common patterns:

- **Reverse proxy** (recommended): let Nginx/Caddy/Cloudflare terminate TLS and proxy plain HTTP to Hopak on `:3000`. Keep `https.enabled: false` on the app side.
- **Capabilities / setcap**: `sudo setcap cap_net_bind_service=+ep $(which bun)` lets the non-root user bind to 443 directly.

File permissions matter — the key file should be `chmod 600` and owned by the app user, never world-readable.

#### HTTP and HTTPS at the same time

Not supported today. `https.enabled: true` replaces the HTTP listener; `https.port` is the only port. If you need both, run behind a reverse proxy that handles the `80 → 443` redirect (Caddy does this by default).

#### Ports — what gets used where

| Config | Dev |
|---|---|
| `server.port` | HTTP listener |
| `server.https.enabled: true` + `https.port` | HTTPS listener; HTTP listener is **not** started |
| No `https.port` set | Falls back to `server.port`; if that's `3000`, HTTPS binds to `3000` |

Set `https.port: 3443` explicitly during dev so your frontend can keep using `:3000` for plain HTTP while you test TLS.

### 19. Allow CORS from your frontend

**Goal:** let a Vite/Next frontend at `http://localhost:5173` call your API with cookies.

CORS is **off by default** — cross-origin browser requests get no CORS headers and fail. Enable per-origin:

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

Preflight (`OPTIONS`) is handled automatically by the CORS layer — your handlers never see it.

#### Public APIs

Wildcard — **no cookies**:

```ts
cors: { origins: '*' }
```

#### Gotcha: `*` + `credentials: true` is a browser rejection

The CORS spec forbids `Access-Control-Allow-Origin: *` together with `Access-Control-Allow-Credentials: true`. Browsers will refuse the response even if Hopak sends both — the fetch rejects with a generic "CORS error" in devtools.

If you need cookies, **list the exact origins**:

```ts
cors: {
  origins: ['http://localhost:5173', 'https://app.myapp.com'],
  credentials: true,
}
```

#### Origin string must match exactly

`'http://localhost:5173'` is **not** the same as:
- `'localhost:5173'` (missing scheme)
- `'http://localhost:5173/'` (trailing slash)
- `'http://127.0.0.1:5173'` (different host)

Browsers send the `Origin` header exactly as the page's origin. Copy-paste it from devtools' Network tab when in doubt.

#### Debugging checklist

When the browser is blocking a call, work through this:

1. **Open devtools → Network → the failing request → Headers.** Is the `Origin` request header present?
2. **Check the response.** Does it have `Access-Control-Allow-Origin`? If missing → server didn't recognise the origin (typo in `origins`). If present but wrong → exact-match issue (trailing slash, scheme mismatch).
3. **Is it a preflight?** Requests with `content-type: application/json` + credentials trigger a preflight `OPTIONS` first. Check that the `OPTIONS` returns `204` with the right headers. If it returns `404`, the route doesn't exist for `OPTIONS` — Hopak handles preflight only when `cors` is configured, so verify `hopak.config.ts` is actually loaded (`hopak check` prints it).
4. **Credentialed request?** The client must send `fetch(url, { credentials: 'include' })` AND the server must have `credentials: true` AND origins must be explicit (not `*`). All three, or cookies won't flow.
5. **Restart the server.** `hopak dev` picks up config changes on file save, but if you're not sure, Ctrl-C and rerun — config-load errors print to stdout.

#### Same-origin? No CORS needed

If your frontend and backend are served from the same origin (e.g. `https://myapp.com` for both), the browser doesn't send `Origin` and CORS doesn't apply. Leave the `cors` block out of the config.

### 20. Serve static files

**Goal:** serve `favicon.ico`, images, a built SPA, or any other file straight from disk.

#### Basic — drop files in `public/`

By default Hopak serves anything inside `public/` at the URL root. No code, no config.

```
public/
├── index.html        → GET /              (fallback when no route matches)
├── favicon.ico       → GET /favicon.ico
├── robots.txt        → GET /robots.txt
└── assets/
    ├── logo.svg      → GET /assets/logo.svg
    └── app.js        → GET /assets/app.js
```

```bash
curl -i http://localhost:3000/favicon.ico
```

```
HTTP/1.1 200 OK
Content-Type: image/x-icon
Content-Length: 4286
Cache-Control: public, max-age=300
ETag: W/"10be-19d9b9abe40.cc"
Last-Modified: Mon, 17 Apr 2026 10:00:00 GMT
```

The `Content-Type` is detected automatically from the file extension.

#### Use a different directory

Serve from `static/` or `web/dist/` (e.g. a Vite build output) — set `paths.public`:

```ts
// hopak.config.ts
import { defineConfig } from '@hopak/core';

export default defineConfig({
  paths: { public: 'web/dist' },  // relative to project root
});
```

Absolute paths work too:

```ts
paths: { public: '/var/www/myapp' }
```

Restart the server — the directory is resolved once on boot.

#### Disable static files entirely

If your API should return nothing for unknown URLs (no `public/` lookup), point `paths.public` at a directory that doesn't exist. A missing directory is a no-op — requests fall straight through to 404:

```ts
paths: { public: '.hopak/nothing' }
```

No error at boot — Hopak only hits the filesystem on actual GET requests.

#### Route precedence

For every incoming request, Hopak checks in this order:

1. **File-based routes** in `app/routes/` (any HTTP method)
2. **CRUD routes** generated by `model(...)`
3. **Static file** in `public/` (only `GET` and `HEAD`)
4. **404 Not Found** with a JSON body

So if you have `app/routes/index.ts` **and** `public/index.html`, visiting `/` runs the route handler — the HTML is ignored. This is useful: keep your API JSON at `/`, keep a marketing page at `/landing.html` by naming the static file differently.

#### SPA fallback (client-side routing)

A Vue/React/Svelte SPA needs `/any/unknown/path` to serve `index.html` so the client router can handle it. Add a catch-all route that reads and returns the SPA entry point:

```ts
// app/routes/[...rest].ts
import { defineRoute } from '@hopak/core';

const spa = await Bun.file('./public/index.html').text();

export const GET = defineRoute({
  handler: (ctx) => {
    // Only fall back for HTML navigation — let /api/* and static assets 404 normally
    if (ctx.path.startsWith('/api/')) return new Response('Not Found', { status: 404 });
    return new Response(spa, { headers: { 'Content-Type': 'text/html' } });
  },
});
```

With this, `/assets/app.js` still comes from `public/` (file route has lower specificity than static for existing files? — actually no: **this catch-all wins over static**, so the route runs for every URL). The `startsWith('/api/')` guard is the usual pattern to let API 404s pass through.

For a stricter split, serve the SPA from a different mount by putting the build into `public/app/` and using `app/routes/app/[...rest].ts` — only `/app/*` hits the fallback.

#### Cache headers

Defaults are conservative and currently **not configurable**:

| Header | Value |
|---|---|
| `Cache-Control` | `public, max-age=300` |
| `ETag` | weak ETag derived from `size + mtime` |
| `Last-Modified` | file `mtime` |

If you need long-lived caching for fingerprinted assets (e.g. `app.abc123.js`), serve them from a CDN in production, or write a small custom route that reads the file and sets your own headers:

```ts
// app/routes/assets/[...path].ts
import { defineRoute } from '@hopak/core';
import { file as bunFile } from 'bun';
import { resolve } from 'node:path';

export const GET = defineRoute({
  handler: async (ctx) => {
    const f = bunFile(resolve('./public/assets', ctx.params.rest));
    if (!(await f.exists())) return new Response(null, { status: 404 });
    return new Response(f, {
      headers: {
        'Content-Type': f.type,
        'Cache-Control': 'public, max-age=31536000, immutable',  // 1 year
      },
    });
  },
});
```

#### Security

- **Path traversal is blocked.** Requests to `/../../etc/passwd` return 404 — the resolved target must live inside the configured `public` directory.
- **Dotfiles are served.** `public/.env` would be readable as `/.env`. Don't put secrets in `public/`.
- **Only GET and HEAD hit the static layer.** POST/PUT/DELETE to a static path return 404 (no method-not-allowed leak).

#### When to skip static entirely

In production, static assets usually live on a CDN (Cloudflare, S3 + CloudFront, Vercel Edge). Configure your build to upload `web/dist/` to the CDN, point the client at `https://cdn.yourapp.com/`, and leave `public/` empty in the server image — Hopak's static layer costs nothing when the directory is empty.

### 21. Move your source somewhere else

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

After this:

- `hopak generate model post` writes to `src/domain/post.ts`
- `hopak generate route posts/[id]` writes to `src/api/posts/[id].ts`
- `hopak dev`, `hopak sync`, `hopak check` scan the new directories
- Static files are served from `static/` instead of `public/`

#### All configurable paths

```ts
paths: {
  models: 'src/domain',        // where hopak scans models
  routes: 'src/api',           // where hopak scans routes
  public: 'static',            // static-file root
  hopakDir: '.cache/hopak',    // runtime data (SQLite file, certs). Default: .hopak
}
```

All paths resolve relative to the project root (where `hopak.config.ts` lives). Absolute paths work too — useful when mounting a shared volume in Docker:

```ts
paths: { public: '/app/static' }
```

#### Migrating an existing project

1. Move files: `mv app/models src/domain`, `mv app/routes src/api`.
2. Add `paths` to `hopak.config.ts`.
3. Run `hopak check` — it prints what it scanned and confirms model/route counts match. If anything's wrong, the check exits with status `1` (great for CI).
4. Restart `hopak dev`.

No code changes needed inside the model/route files themselves — the paths in `hopak.config.ts` are the only source of truth.

#### Gotcha: the `.hopak/` runtime directory

`.hopak/` holds the SQLite file (`.hopak/data.db`) and the dev TLS certs (`.hopak/certs/`). Override with `paths.hopakDir` if you need a different location — e.g. `/var/lib/myapp` in a systemd deployment. The directory is created automatically on first write.

### 22. Scaffold files from the CLI

**Goal:** don't write boilerplate by hand. Every file Hopak uses to
serve your app is generated by a single command and then edited like
normal source — no runtime magic builds routes, certs, or CRUD
handlers behind your back.

Four kinds: `model`, `route`, `crud`, `cert`.

#### `generate model <name>` — one table

```bash
hopak generate model comment
# → Created file  app/models/comment.ts

hopak g model comment            # same thing, short form
```

The generated model is deliberately minimal; replace the fields
with your real schema:

```ts
// app/models/comment.ts
import { model, text } from '@hopak/core';

export default model('comment', {
  name: text().required(),
});
```

Generating the model alone gives you a DB table (after `hopak sync`)
and a typed client (`ctx.db.model('comment')`) — but no HTTP
endpoints. Run `hopak generate crud comment` next to expose REST, or
write your own route files.

#### `generate crud <name>` — REST for a model

```bash
hopak generate crud post
# → Created file  app/routes/api/posts.ts
# → Created file  app/routes/api/posts/[id].ts
```

Two files using the `crud` helpers from `@hopak/core`:

```ts
// app/routes/api/posts.ts
import { crud } from '@hopak/core';
import post from '../../models/post';

export const GET = crud.list(post);
export const POST = crud.create(post);
```

```ts
// app/routes/api/posts/[id].ts
import { crud } from '@hopak/core';
import post from '../../../models/post';

export const GET = crud.read(post);
export const PUT = crud.update(post);
export const PATCH = crud.patch(post);
export const DELETE = crud.remove(post);
```

After the scaffold:

```bash
hopak check
# → Models  1 loaded (post)
# → Routes  6 file route(s)

hopak dev
# POST, GET list, GET /:id, PUT, PATCH, DELETE — all live on /api/posts
```

Customize any verb by replacing the corresponding export with your
own `defineRoute(...)`; delete the export to remove the verb entirely
(the router answers `405 Method Not Allowed` with an `Allow:` header
listing what remains). See Recipe 5 for the full flow.

The model must exist before you run `generate crud`; the command
only writes the route files.

#### `generate route <path>` — one handler

```bash
hopak generate route search
# → Created file  app/routes/search.ts        (URL: /search)

hopak generate route posts/[id]/publish
# → Created file  app/routes/posts/[id]/publish.ts  (URL: /posts/:id/publish)

hopak generate route api/users/[id]
# → Created file  app/routes/api/users/[id].ts     (URL: /api/users/:id)

hopak generate route files/[...rest]
# → Created file  app/routes/files/[...rest].ts    (URL: /files/* catch-all)
```

Starter contents:

```ts
import { defineRoute } from '@hopak/core';

export const GET = defineRoute({
  handler: (ctx) => ({ ok: true, path: ctx.path }),
});
```

Rename `GET` to any other verb, or add multiple exports to the same
file for multiple methods.

#### `generate cert` — dev HTTPS key + cert

```bash
hopak generate cert
# → Generating self-signed dev certificate { path: ".hopak/certs" }
# → Dev certificate ready. Re-run `hopak dev` with HTTPS enabled.
```

Writes `.hopak/certs/dev.key` + `dev.crt` + a local `.gitignore` so
the material never lands in a commit. Enable HTTPS in config
(`server.https.enabled: true`) and restart `hopak dev`. If you turn
on HTTPS without running this first, `hopak dev` refuses to start
and points you back here — the runtime never fabricates crypto on
its own.

See Recipe 18 for the full HTTPS walkthrough.

#### Path normalization

`hopak generate route` is forgiving about how you spell the path:

| You type | File created |
|---|---|
| `search` | `app/routes/search.ts` |
| `/search` | `app/routes/search.ts` (leading `/` stripped) |
| `search.ts` | `app/routes/search.ts` (`.ts` stripped) |
| `posts/new.ts` | `app/routes/posts/new.ts` |

Parent directories are created automatically.

#### Custom project paths

If `hopak.config.ts` has `paths.models: 'src/domain'`, `hopak generate
model comment` writes to `src/domain/comment.ts` — the generator
respects the config (see Recipe 21).

#### Refusal policy — never overwrites

Running any `generate` twice against the same target path fails on
the second run:

```
Error: File already exists: app/models/comment.ts
```

Exit code `1` — safe to run from npm scripts or Makefiles. Delete
the file (or rename it) if you really want a fresh template.
`generate cert` is the exception: if both `dev.key` and `dev.crt`
are already present it exits `0` with `Dev certificate already
exists` (idempotent — safe in setup scripts).

### 23. Log every request (with a correlation id)

**Goal:** one line per request in your logs, plus a correlation id
you can match against client-side tickets. Both are in `@hopak/core`
and enable in one command:

```bash
hopak use request-log
# → Patched main.ts — requestId() + requestLog() now run on every request
```

`main.ts` becomes:

```ts
import { hopak, requestId, requestLog } from '@hopak/core';

await hopak().before(requestId()).after(requestLog()).listen();
```

On each request you get:

```
GET /api/posts 200 3ms [0f4b2c…]
POST /api/auth/login 401 8ms [b1c9ae…] ! bad credentials
```

The id also rides back as `X-Request-Id` on the response so a client
and server share the same tag.

Pick the format:

```ts
// Structured logs (one JSON object per line — great for aggregators):
.after(requestLog({ format: 'json' }))

// Extra fields per request:
.after(requestLog({ extra: (ctx) => ({ tenant: ctx.user?.tenantId }) }))
```

Put the `requestId()` before any middleware that throws — any handler
or middleware calling `ctx.log.info(...)` after it will carry the id
implicitly via the request log line. Use a custom generator to swap
UUIDs for ULIDs:

```ts
.before(requestId({ generate: () => someUlid() }))
```

### 24. Add JWT auth (signup, login, `me`, gated routes)

**Goal:** full credential-based auth with a working signup, login,
and `me` endpoint in one command — plus a `requireAuth()` you can
drop on any route.

```bash
hopak use auth
# → Created app/middleware/auth.ts
# → Created app/routes/api/auth/signup.ts
# → Created app/routes/api/auth/login.ts
# → Created app/routes/api/auth/me.ts
# → Created app/models/user.ts           (only if you don't already have one)
# → Added JWT_SECRET to .env.example
# → bun add @hopak/auth jose
```

Copy `.env.example` → `.env`, set `JWT_SECRET` (32+ random bytes —
`openssl rand -hex 32`), then `hopak sync && hopak dev`. The three
endpoints come up with zero extra code:

```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"name":"Ada","email":"a@b.com","password":"hunter2hunter"}'
# → { "user": {...}, "token": "eyJhbGci..." }

curl -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"a@b.com","password":"hunter2hunter"}'
# → { "token": "eyJhbGci..." }

curl http://localhost:3000/api/auth/me \
  -H 'authorization: Bearer eyJhbGci...'
# → { "id": 1, "role": null }
```

Gate any other route with `requireAuth()` from the generated
middleware file:

```ts
// app/routes/api/posts.ts
import { crud } from '@hopak/core';
import post from '../../models/post';
import { requireAuth } from '../../middleware/auth';

export const GET = crud.list(post);
export const POST = crud.create(post, { before: [requireAuth()] });
```

#### Role-based access

`@hopak/auth` ships `requireRole(...names)` — stack it after
`requireAuth()`:

```ts
import { requireRole } from '@hopak/auth';
import { requireAuth } from '../../middleware/auth';

export const DELETE = crud.remove(post, {
  before: [requireAuth(), requireRole('admin')],
});
// Non-admin → 403 Forbidden
// No token  → 401 Unauthorized
// admin     → handler runs
```

Multiple roles are OR-of: `requireRole('admin', 'editor')`. Add
custom claims by extending `AuthUser`:

```ts
// app/middleware/auth.ts
import 'app/types/auth';

// app/types/auth.ts
declare module '@hopak/auth' {
  interface AuthUser {
    tenantId: number;
  }
}
```

Then pass `claims: ['id', 'role', 'tenantId']` to `jwtAuth({...})`.

#### OAuth (GitHub, Google)

`@hopak/auth/oauth/github` and `/oauth/google` expose matching
`*Start` / `*Callback` route handlers that share the same
`signToken` you already have. State is verified statelessly with
HMAC — no cookie store:

```ts
// app/routes/api/auth/github/start.ts
import { defineRoute } from '@hopak/core';
import { githubStart } from '@hopak/auth/oauth/github';

export const GET = defineRoute({
  handler: githubStart({
    callbackUrl: 'http://localhost:3000/api/auth/github/callback',
    stateSecret: process.env.JWT_SECRET ?? '',
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
    stateSecret: process.env.JWT_SECRET ?? '',
  }),
});
```

Set `GITHUB_OAUTH_ID` and `GITHUB_OAUTH_SECRET` in `.env`. New users
are created with `{ email, name, password: 'oauth:<uuid>' }` by
default — override with the `createUser` option when your model has
other required fields. Google works the same way from
`@hopak/auth/oauth/google`.

### 25. Evolve the schema with migrations

**Goal:** change a model after day 1 without losing data — with
reviewable `up`/`down`, rollback, and audit trail.

`hopak sync` is for the dev bootstrap: it runs `CREATE TABLE IF NOT
EXISTS` on first boot and nothing else. The moment you need to add a
column, migrations take over.

```bash
hopak migrate init
# → Created app/migrations/20260422T153012345_init.ts (CREATE TABLE for each model)

hopak migrate new add_role_to_user
# → Created app/migrations/20260422T160100_add_role_to_user.ts (empty up/down skeleton)
```

Fill in the skeleton:

```ts
import type { MigrationContext } from '@hopak/core';

export const description = 'Add role column to user';

export async function up(ctx: MigrationContext): Promise<void> {
  await ctx.execute(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`);
}

export async function down(ctx: MigrationContext): Promise<void> {
  await ctx.execute(`ALTER TABLE users DROP COLUMN role`);
}
```

Apply, inspect, rollback:

```bash
hopak migrate up              # applies pending
hopak migrate up --dry-run    # preview without touching DB
hopak migrate status          # applied / pending / missing
hopak migrate down            # rollback last (or --steps N)
```

`ctx.db` inside `up`/`down` is the full Hopak client — data migrations
(backfill a new column, rewrite rows) live in the same file as their DDL.

Transactional contract:
- **SQLite / Postgres:** each migration runs inside `db.transaction()`.
- **MySQL:** DDL auto-commits, so migrations run without the outer tx;
  the idiom is one DDL per file to keep failures recoverable.

Once `app/migrations/` exists, `hopak sync` refuses to run — schema
evolution lives in migrations exclusively. Before that point, `sync`
is still the fastest path from `hopak new` to a working endpoint.

If you change a model column while still on `sync`, the next `hopak
dev` prints a drift warning pointing at `hopak migrate init` — the
natural moment to adopt migrations.

---

## Models

A model is one file. It defines the table, the validation, the TypeScript row type, and (optionally) the REST endpoints.

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
  timestamps: true,   // add createdAt + updatedAt columns (default: true)
});
```

---

## CRUD

CRUD is not runtime magic — it's **scaffolded files** you can read and
edit. The CLI writes two tiny route files per model; the framework
then serves them like any other file route. Nothing is synthesized
from a flag.

```bash
hopak generate crud post
# → Created file  app/routes/api/posts.ts
# → Created file  app/routes/api/posts/[id].ts
```

The generated files use the `crud` helpers from `@hopak/core`:

```ts
// app/routes/api/posts.ts
import { crud } from '@hopak/core';
import post from '../../models/post';

export const GET = crud.list(post);
export const POST = crud.create(post);
```

```ts
// app/routes/api/posts/[id].ts
import { crud } from '@hopak/core';
import post from '../../../models/post';

export const GET = crud.read(post);
export const PUT = crud.update(post);
export const PATCH = crud.patch(post);
export const DELETE = crud.remove(post);
```

That's the whole REST surface. Six endpoints under `/api/<plural>/`:

| Method | Path | Helper | Behavior |
|--------|------|--------|----------|
| `GET` | `/api/posts` | `crud.list(post)` | Paginated list |
| `GET` | `/api/posts/:id` | `crud.read(post)` | Single row, 404 if missing |
| `POST` | `/api/posts` | `crud.create(post)` | Validate body, create, return 201 |
| `PUT` | `/api/posts/:id` | `crud.update(post)` | Full body validation |
| `PATCH` | `/api/posts/:id` | `crud.patch(post)` | Partial body validation |
| `DELETE` | `/api/posts/:id` | `crud.remove(post)` | 204 on success, 404 if missing |

```bash
curl -X POST http://localhost:3000/api/posts \
  -H 'content-type: application/json' \
  -d '{"title":"Hello Hopak","content":"It works!"}'
# → 201 {"id":1,"title":"Hello Hopak","content":"It works!", ...}

curl http://localhost:3000/api/posts?limit=10&offset=20
# → {"items":[...],"total":42,"limit":10,"offset":20}
```

`limit` defaults to 20, max 100. Validation errors return 400 with
field-level details; UNIQUE violations return 409; password / secret
/ token fields are stripped from responses (including those loaded
through `include`).

### Customize an endpoint

Just edit the generated file. To replace `POST /api/posts` with your
own logic, delete the `POST` export from `app/routes/api/posts.ts`
and write a custom handler:

```ts
// app/routes/api/posts.ts
import { crud, defineRoute } from '@hopak/core';
import post from '../../models/post';

export const GET = crud.list(post);

export const POST = defineRoute({
  handler: async (ctx) => {
    // your custom create logic — e.g. force-prefix the title,
    // enforce auth, etc. — then call ctx.db!.model('post').create(...)
  },
});
```

The other five verbs stay as they are. Because everything is in
source files, there's no "override" magic to learn — you just change
what the file exports.

### Skip CRUD for a model

Don't run `hopak generate crud` for it. The model still becomes a
table, you just don't expose HTTP routes. To add them later, run the
command — or write the file by hand if you want non-`/api/<plural>/`
URLs.

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

Validation is generated from the model — no separate schema to maintain. Every CRUD `POST`/`PUT`/`PATCH` enforces it.

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

Three SQL dialects supported, one API. SQLite ships with Bun (no install);
Postgres and MySQL are opt-in via `hopak use postgres` / `hopak use mysql`.
Drizzle under the hood, but you don't write Drizzle — you write models.

The schema is created on `hopak dev`'s first boot via
`CREATE TABLE IF NOT EXISTS` for every model. Run `hopak sync` to do the
same thing explicitly without starting the server (useful in CI or on a
fresh Postgres / MySQL database). This is **idempotent naive replay** —
the same command is safe to run repeatedly, but it does **not** handle
schema changes (`ALTER TABLE` / `RENAME` / `DROP`). For schema evolution
during prototyping, drop the table and re-sync.

### Dialect matrix

| Dialect | Driver | Install | Default file / URL |
|---|---|---|---|
| `sqlite` | `bun:sqlite` | built into Bun | `.hopak/data.db` |
| `postgres` | `postgres` (postgres.js) | `hopak use postgres` | `process.env.DATABASE_URL` |
| `mysql` | `mysql2` | `hopak use mysql` | `process.env.DATABASE_URL` |

### Querying inside a handler

```ts
defineRoute({
  handler: async (ctx) => {
    const post = await ctx.db?.model('post').findOne(1);
    return post;
  },
});
```

`ctx.db` is `undefined` when the server starts without models. In a normal
app it's always set — `ctx.db!.model(...)` narrows safely, or use
`ctx.requireDb?.()` for an explicit assertion.

### Full `ModelClient` surface

Every `db.model(name)` returns a typed client with this surface:

```ts
// Read
client.findMany(options?);                           // → TRow[]
client.findMany({ select: ['id', 'title'] });        // → Pick<TRow, ...>[]
client.findOne(id, { lock?: 'forUpdate' | 'forShare' });  // → TRow | null
client.findOrFail(id, options?);                     // → TRow (throws NotFound)
client.count({ where? });                            // → number

// Write
client.create(data);                                 // → TRow
client.update(id, data);                             // → TRow (throws NotFound)
client.delete(id);                                   // → boolean
client.upsert({ where, create, update });            // → TRow

// Batch
client.createMany([row, row, row]);                  // → { count }
client.updateMany({ where, data });                  // → { count }
client.deleteMany({ where });                        // → { count }

// Aggregate
client.aggregate({ sum, avg, min, max, count });     // → AggregateResult
client.aggregate({ groupBy: ['col'], ... });         // → Array<AggregateResult + group keys>
```

### `findMany` options reference

```ts
{
  where?: WhereClause,       // filter — see recipe 10
  include?: IncludeClause,   // eager-load relations — see recipe 11
  select?: ['id', 'title'],  // projection — see recipe 16
  distinct?: true | ['col'], // dedupe — see recipe 16
  orderBy?: [{ field, direction }],
  limit?: number,
  offset?: number,
  cursor?: { id: 42 },       // keyset pagination — see recipe 14
  lock?: 'forUpdate' | 'forShare',  // row locks — see recipe 15
}
```

### Transactions

```ts
await ctx.db.transaction(async (tx) => {
  const user = await tx.model('user').create({...});
  await tx.model('post').create({ author: user.id, ... });
  // Throwing here (or from any tx query) rolls everything back.
});
```

See Recipe 15 for `FOR UPDATE` locking patterns.

### Raw Drizzle access (escape hatch)

For window functions, CTEs, full-text search, JSON operators, EXPLAIN —
anything the typed client doesn't cover — drop to Drizzle directly:

```ts
import { sql } from 'drizzle-orm';

const drizzle = ctx.db!.raw();
const top = await drizzle.execute(sql`
  SELECT author, ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS rank
  FROM posts WHERE published = true GROUP BY author LIMIT 10
`);
```

`raw()` returns the dialect's native Drizzle instance — the full Drizzle
API is available. Transactions work via `raw()` too if you need SAVEPOINTs
or custom isolation levels.

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

Two steps. Generate a dev cert once:

```bash
hopak generate cert
# writes .hopak/certs/dev.{key,crt} + a local .gitignore
```

Requires `openssl` on the machine. Then enable HTTPS in config:

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

If HTTPS is on and the cert files aren't present, `hopak dev` stops
with a message pointing back to `hopak generate cert`. The runtime
doesn't shell out to openssl on its own any more.

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
| `hopak new <name>` | Scaffold a new project and run `bun install` inline |
| `hopak new <name> --db <sqlite\|postgres\|mysql>` | Pick the dialect at creation time (default: sqlite) |
| `hopak new <name> --no-install` | Scaffold only; skip install (CI / offline) |
| `hopak dev` | Run with hot reload |
| `hopak generate model <name>` | Add a model file |
| `hopak generate crud <name>` | Scaffold the 2 CRUD route files for an existing model |
| `hopak generate route <path>` | Add a route file |
| `hopak generate cert` | Generate a self-signed dev HTTPS cert under `.hopak/certs/` |
| `hopak sync` | Apply model schema to the database (`CREATE TABLE IF NOT EXISTS`) |
| `hopak check` | Audit project state (config, models, routes) |
| `hopak use <capability>` | Switch dialect in an existing project: `sqlite` / `postgres` / `mysql` |
| `hopak use` | List available capabilities |
| `hopak --version` | Show version |
| `hopak --help` | Show help |

### `hopak use <capability>`

One command to wire a feature into an existing project — installs
any extra packages, patches the right files, and adds env keys.

| Capability | Effect |
|---|---|
| `sqlite` / `postgres` / `mysql` | Switch database dialect (driver + `hopak.config.ts` block + `.env.example`). |
| `request-log` | Patch `main.ts` to add `requestId()` + `requestLog()` from `@hopak/core`. See Recipe 23. |
| `auth` | Install `@hopak/auth`, scaffold `app/middleware/auth.ts`, signup/login/me routes, `JWT_SECRET` in `.env.example`. See Recipe 24. |

Typical DB flow:

```bash
hopak new my-app           # starts on SQLite
cd my-app
hopak use postgres         # switches to Postgres
# → bun add postgres
# → hopak.config.ts gains: database: { dialect: 'postgres', url: process.env.DATABASE_URL }
# → .env.example gains: DATABASE_URL=postgres://user:pass@localhost:5432/myapp
```

Then copy `.env.example` → `.env`, fill the secrets, run
`hopak sync`, and `hopak dev`. Nothing in your application code
changes — the same handlers work across all three dialects.

`hopak use` never overwrites a file it didn't generate. If a
target already exists and looks hand-edited, the command prints the
snippet to paste manually and exits non-zero — predictable in CI.

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
