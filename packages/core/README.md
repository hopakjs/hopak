<p align="center">
  <img alt="Hopak.js — Backend framework" src="https://raw.githubusercontent.com/hopakjs/hopak/main/.github/assets/npm_both.png" width="460">
</p>

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

0.2 is a breaking release. If you had `{ crud: true }` on any model,
run `hopak generate crud <name>` once per model and then drop the
flag — the CLI scaffolds the six route files the runtime used to
inject at boot. If you had `server.https.enabled: true`, run
`hopak generate cert` once; boot no longer shells out to openssl
for you. `@hopak/testing`'s `withCrud` option went with the same
change — wire routes via the new `crud.*` helpers, or point
`createTestServer` at a project `rootDir`. Nothing else in the
public surface moved; models, queries, validation, errors, CORS,
`hopak use`, `hopak sync`, and `hopak check` all keep working the
way they did.

## Upgrading from 0.3.x to 0.4.0

`@hopak/core@0.4.0` swaps the validation runtime from **Zod** to
**Valibot** — ~10× smaller bundle, ~2–3× faster parse, same
`validate()` / `buildModelSchema()` API. Code using only Hopak's
model-driven validation keeps working untouched.

**What actually changes:**

- `@hopak/core` no longer depends on `zod`. If your project code
  imported `zod` transitively, add it to your own `package.json`.
- `RouteSchemas.body | query | params` types are now Valibot schemas
  (`v.GenericSchema`), not `z.ZodType`. Route files that passed Zod
  schemas directly need to switch to Valibot:

  ```ts
  // before
  import { z } from 'zod';
  body: z.object({ title: z.string().min(3) })

  // after
  import * as v from 'valibot';
  body: v.object({ title: v.pipe(v.string(), v.minLength(3)) })
  ```

- Error messages use Valibot's defaults. Re-snapshot any tests that
  assert on exact message text.
- `ZodFieldSchema` type export renamed to `FieldSchema`.

## Quick start

```bash
bun add -g @hopak/cli
hopak new my-app           # SQLite by default (zero-install, works offline)
cd my-app
hopak dev
```

Want a different dialect from day one? `hopak new my-app --db postgres`
(or `--db mysql`) wires the config, adds the driver, and seeds
`.env.example` in one pass.

Server on `http://localhost:3000`. Scaffold a model plus its REST
route files with two commands:

```bash
hopak generate model post
hopak generate crud post
```

You get validation, JSON serialization, pagination, static files —
and every endpoint lives in a real file you can open and edit.
Nothing is synthesized at runtime; the CLI writes the files, the
runtime just serves them.

Already inside a project? Switch dialects in place:

```bash
hopak use postgres         # installs `postgres` driver, patches config, updates .env.example
hopak use mysql            # installs `mysql2`, etc.
hopak use sqlite           # back to default
```

---

## Recipes

Common backend tasks, step by step. Every recipe shows **where the
file goes**, the **code**, **how to run it**, and **what you should
see**. Start from a freshly scaffolded project:

```bash
hopak new my-app           # SQLite by default (zero-install, works offline)
cd my-app
```

`hopak new` runs `bun install` for you — no separate step. Want a
different dialect up front? Pass `--db`:

```bash
hopak new my-app --db postgres
hopak new my-app --db mysql
```

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
`app/routes/api/posts/[id].ts` (read + replace + patch + delete).
Open either file; the entire REST surface is there as plain code
you can read and edit — nothing is synthesized at runtime.

**2.** Fill in your fields:

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

On first boot Hopak creates the SQLite file at `.hopak/data.db` and
runs `CREATE TABLE IF NOT EXISTS` for every model. Safe to repeat
— `hopak sync` does the same thing explicitly if you prefer to
separate schema sync from server start (handy for CI or a fresh
Postgres / MySQL database).

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

Six endpoints from two generated files: list, read, create, replace, patch, delete — all paginated and validated. Don't want endpoints for a given model? Just don't run `hopak generate crud` for it — the model still becomes a table, you just don't expose HTTP routes. The plural segment (`/api/posts`) comes from `pluralize('post')` — irregular plurals are handled (`story → stories`, `box → boxes`).

### 2. Validate input

**Goal:** reject malformed requests with clear, per-field error messages.

Validation is generated **from the model** — you don't write a separate schema. `POST` and `PUT` validate the full object; `PATCH` validates a partial one automatically.

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
    "name":  ["Invalid length: Expected >=2 but received 1"],
    "email": ["Invalid email: Received \"not-an-email\""],
    "age":   ["Invalid value: Expected >=18 but received 5"],
    "role":  ["Invalid type: Expected (\"admin\" | \"user\" | \"guest\") but received \"superman\""]
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

When writing your own handler, validate with the same schema the CRUD uses:

```ts
// app/routes/api/signup.ts
import { defineRoute, buildModelSchema, validate, ValidationError } from '@hopak/core';
import user from '../../models/user';

const schema = buildModelSchema(user, { omitId: true });

export const POST = defineRoute({
  handler: async (ctx) => {
    const result = validate(schema, await ctx.body());
    if (!result.ok) {
      throw new ValidationError('Invalid signup', result.errors);
    }
    // result.data is fully typed from the model
    return ctx.db?.model('user').create(result.data);
  },
});
```

`buildModelSchema(model, { partial: true })` gives the `PATCH`-flavoured schema. `result.errors` is `Record<field, string[]>` — the same shape CRUD sends back.

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

Exclusion happens in the serializer — it applies to every response
the `crud.*` helpers produce (list, single, create reply, update
reply), and to any value you return from a custom route that
includes one of these columns (for example
`return await ctx.db.model('user').findOne(1)`). Nested rows loaded
through `include` are stripped too.

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

**Goal:** replace just the `POST /api/posts` handler with custom
logic. Keep the other five verbs as they were.

The CRUD files are plain source. Open
`app/routes/api/posts.ts` (generated earlier by
`hopak generate crud post`) and swap the `POST` export for your
own `defineRoute(...)`:

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

`GET /api/posts` still comes from `crud.list(post)`. The item-level
file (`posts/[id].ts`) is untouched, so the other four verbs keep
working as they did.

#### Disable a single verb

Delete the export. The router answers `405 Method Not Allowed` with
an `Allow:` header listing the verbs that remain.

```ts
// app/routes/api/posts/[id].ts — DELETE removed
import { crud } from '@hopak/core';
import post from '../../../models/post';

export const GET = crud.read(post);
export const PUT = crud.update(post);
export const PATCH = crud.patch(post);
// no DELETE — clients now get 405 with Allow: GET, PUT, PATCH
```

#### Skip CRUD for a model entirely

Don't run `hopak generate crud` for it, or delete the two files the
generator produced. The model stays a table and can be queried via
`ctx.db!.model('post')` from any custom route.

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

If the project has zero models, Hopak doesn't open a database — `ctx.db` stays `undefined`. Handlers that require it check explicitly:

```ts
if (!ctx.db) throw new InternalError('Database not configured');
const posts = await ctx.db.model('post').findMany();
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

**Goal:** use Postgres or MySQL instead of the default SQLite. Two
entry points depending on where you are.

#### 17a. At project creation — `hopak new --db postgres`

Pick the dialect up front; everything is wired in one go.

```bash
hopak new my-app --db postgres
cd my-app
```

What happens during `hopak new`:

1. `hopak.config.ts` gets
   `database: { dialect: 'postgres', url: process.env.DATABASE_URL }`.
2. `package.json` lists `postgres` (or `mysql2`) as a dependency —
   `bun install` picks it up in the same run.
3. `.env.example` has a placeholder
   `DATABASE_URL=postgres://user:pass@localhost:5432/myapp`.
4. The generated project `README.md` tells you the one extra step
   before `hopak dev`: copy `.env.example` to `.env` and run
   `hopak sync`.

Then:

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

1. Installs the driver — `bun add postgres` (or `bun add mysql2`).
   SQLite ships with Bun, nothing to install there.
2. Rewrites the `database:` block in `hopak.config.ts`. A bare
   default block (what `hopak new` wrote) is replaced cleanly; a
   block you've tuned — custom file path, extra URL params, `ssl:`
   config — is left alone and the command prints a snippet for you
   to paste manually, so tuning is never silently discarded.
3. Adds `DATABASE_URL` to `.env.example` if it isn't already there.

Then:

```bash
# 1. Start Postgres locally (or use a managed one like Neon / Supabase / RDS)
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=hopak postgres:16-alpine

# 2. Fill DATABASE_URL in .env:
#    DATABASE_URL=postgres://postgres:hopak@localhost:5432/postgres

# 3. Sync schema + run
hopak sync
hopak dev
```

The rest of the project code is **unchanged** — models, CRUD
scaffolds, routes, `ctx.db.model(...)` — all work identically on
every dialect.

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

**Goal:** test your frontend against `https://localhost:3443` using
a self-signed cert.

**1.** Generate the dev cert (one-time):

```bash
hopak generate cert
# → Generating self-signed dev certificate { path: ".hopak/certs" }
# → Dev certificate ready. Re-run `hopak dev` with HTTPS enabled.
```

This runs `openssl req -x509` once and writes three files:

```
.hopak/certs/
├── dev.key     # private key (gitignored)
├── dev.crt     # self-signed cert (gitignored)
└── .gitignore  # `*` — keeps everything except itself out of commits
```

Requires `openssl` on the machine. macOS ships it. On Ubuntu/Debian:
`apt install openssl`. On Alpine: `apk add openssl`.

**2.** Turn HTTPS on in config:

```ts
// hopak.config.ts
import { defineConfig } from '@hopak/core';

export default defineConfig({
  server: { https: { enabled: true, port: 3443 } },
});
```

**3.** Restart:

```bash
hopak dev
```

Hopak reads the cert pair from `.hopak/certs/dev.{key,crt}` and
serves HTTPS on 3443. If the files aren't there it fails fast
with a pointer back to `hopak generate cert` — nothing is
fabricated at boot.

**4.** Verify:

```bash
curl -k https://localhost:3443/           # -k accepts the self-signed cert
```

Browser will show a warning the first time — that's expected for a
self-signed cert. Delete `.hopak/certs/` and re-run
`hopak generate cert` to re-issue.

#### Trust the cert (remove the browser warning)

If the warning is blocking your frontend (e.g. a cookie with `SameSite=None; Secure` won't set), trust the cert once:

**macOS:**

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain .hopak/certs/dev.crt
```

**Linux (Debian/Ubuntu):**

```bash
sudo cp .hopak/certs/dev.crt /usr/local/share/ca-certificates/hopak-dev.crt
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

1. **File-based routes** in `app/routes/` (any HTTP method). This
   includes the CRUD files written by `hopak generate crud` — they
   are file routes like any others, they just use the `crud.*`
   helpers from `@hopak/core`.
2. **Static file** in `public/` (only `GET` and `HEAD`).
3. If the URL has no handler for this verb but does for others,
   **`405 Method Not Allowed`** with an `Allow:` header.
4. **404 Not Found** with a JSON body.

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
    migrations: 'src/migrations',
    public: 'static',
  },
});
```

After this:

- `hopak generate model post` writes to `src/domain/post.ts`
- `hopak generate route posts/[id]` writes to `src/api/posts/[id].ts`
- `hopak migrate new add_slug` writes to `src/migrations/<timestamp>_add_slug.ts`
- `hopak dev`, `hopak sync`, `hopak check` scan the new directories
- Static files are served from `static/` instead of `public/`

#### All configurable paths

```ts
paths: {
  models: 'src/domain',        // where hopak scans models
  routes: 'src/api',           // where hopak scans routes
  migrations: 'src/migrations',// where hopak migrate writes files
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

**Goal:** don't write boilerplate by hand. Every file Hopak serves
at runtime is generated by a single command and then edited like
normal source — no config flag synthesizes routes, certs, or
handlers behind your back.

Four kinds: `model`, `route`, `crud`, `cert`.

#### `generate model <name>` — one table

```bash
hopak generate model comment
# → Created file  app/models/comment.ts

hopak g model comment              # same thing, short form
```

The template is deliberately minimal — replace the fields:

```ts
import { model, text } from '@hopak/core';

export default model('comment', {
  name: text().required(),
});
```

Generating the model alone gives you a DB table (after `hopak sync`,
or automatically on first SQLite `hopak dev` boot) and a typed
client via `ctx.db.model('comment')`. No HTTP endpoints until you
also run `hopak generate crud comment`.

#### `generate crud <name>` — REST for a model

```bash
hopak generate crud post
# → Created file  app/routes/api/posts.ts
# → Created file  app/routes/api/posts/[id].ts
```

Each file uses the `crud` helpers exported from `@hopak/core`:

```ts
// app/routes/api/posts.ts
import { crud } from '@hopak/core';
import post from '../../models/post';

export const GET = crud.list(post);
export const POST = crud.create(post);
```

Six endpoints on `/api/<plural>/` — paginated, validated, sensitive
fields (password/secret/token) stripped. Customize a verb by
swapping its export with your own `defineRoute(...)`; delete the
export to remove the verb (router answers `405 Method Not Allowed`
with an `Allow:` header listing what's left).

The model must exist before you run `generate crud`; the command
only writes the route files.

#### `generate route <path>` — one handler

```bash
hopak generate route search
# → Creates app/routes/search.ts  (URL: /search)

hopak generate route posts/[id]/publish
# → Creates app/routes/posts/[id]/publish.ts  (URL: /posts/:id/publish)

hopak generate route api/users/[id]
# → Creates app/routes/api/users/[id].ts  (URL: /api/users/:id)

hopak generate route files/[...rest]
# → Creates app/routes/files/[...rest].ts  (URL: /files/* catch-all)
```

All generated routes start with a `GET` handler:

```ts
import { defineRoute } from '@hopak/core';

export const GET = defineRoute({
  handler: (ctx) => ({ ok: true, path: ctx.path }),
});
```

Rename `GET` to `POST` / `PUT` / `PATCH` / `DELETE`, or add multiple exports in the same file for multiple methods.

#### `generate cert` — dev HTTPS key + cert

```bash
hopak generate cert
# → Generating self-signed dev certificate { path: ".hopak/certs" }
# → Dev certificate ready. Re-run `hopak dev` with HTTPS enabled.
```

Writes `.hopak/certs/dev.key` + `dev.crt` + a local `.gitignore` so
the material never lands in a commit. Pair with
`server.https.enabled: true` in config; `hopak dev` refuses to
start with HTTPS enabled but no cert files present and points you
back here. Idempotent — running again when files exist is a no-op.
Requires `openssl`. See Recipe 18.

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

If `hopak.config.ts` has `paths.models: 'src/domain'`, `hopak generate model comment` writes to `src/domain/comment.ts` — the generator respects the config (see Recipe 21).

#### Refusal policy — never overwrites

Running `hopak generate model/route/crud` twice against the same
target fails on the second run:

```
Error: File already exists: app/models/comment.ts
```

Exit code `1` — safe to run from npm scripts or Makefiles. Delete the file (or rename it) if you really want a fresh template. `generate cert` is the exception: if both `dev.key` and `dev.crt` exist it exits `0` (idempotent — safe in setup scripts).

### 23. Log every request (with a correlation id)

**Goal:** one line per request, plus a correlation id echoed back
to the client. Both helpers ship with `@hopak/core`:

```bash
hopak use request-log
# → Patched main.ts — requestId() + requestLog() now run on every request
```

```ts
// main.ts
import { hopak, requestId, requestLog } from '@hopak/core';

await hopak().before(requestId()).after(requestLog()).listen();
```

On each request:

```
GET /api/posts 200 3ms [0f4b2c…]
POST /api/auth/login 401 8ms [b1c9ae…] ! bad credentials
```

The same id is set on `ctx.requestId` (so your own `ctx.log.*` calls
can include it) and sent back as `X-Request-Id` on the response.

Switch to structured logs (`format: 'json'`) or attach extra fields
per request:

```ts
.after(requestLog({ format: 'json' }))
.after(requestLog({ extra: (ctx) => ({ tenant: ctx.user?.tenantId }) }))
```

Swap the generator for ULIDs or any id scheme you like:

```ts
.before(requestId({ generate: () => someUlid() }))
```

### 24. Evolve the schema with migrations

**Goal:** change a model after day 1 without losing data — with
reviewable `up`/`down` files, rollback, and audit trail.

`hopak sync` is for the dev bootstrap: it runs `CREATE TABLE IF NOT
EXISTS` on first boot and nothing else. The moment you need to add a
column to an existing table, migrations take over.

#### First migration — capture current state

```bash
hopak migrate init
# → Created app/migrations/20260422T153012345_init.ts
```

Generated file: one `ctx.execute(...)` per table for each dialect.
Commit it. Now `hopak sync` refuses to run:

```
$ hopak sync
This project uses migrations. Run `hopak migrate up` to apply pending
schema changes.
```

#### Add a column

1. Edit the model:
   ```ts
   // app/models/user.ts
   export default model('user', {
     name: text().required(),
     email: email().required().unique(),
     role: text().default('user'),   // new
   });
   ```

2. Create a migration:
   ```bash
   hopak migrate new add_role_to_user
   # → Created app/migrations/20260422T160100123_add_role_to_user.ts
   ```

3. Fill in `up`/`down`:
   ```ts
   import type { MigrationContext } from '@hopak/core';

   export const description = 'Add role to user';

   export async function up(ctx: MigrationContext): Promise<void> {
     await ctx.execute(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`);
   }

   export async function down(ctx: MigrationContext): Promise<void> {
     await ctx.execute(`ALTER TABLE users DROP COLUMN role`);
   }
   ```

4. Apply:
   ```bash
   hopak migrate up
   # → Applying 20260422T160100123_add_role_to_user — Add role to user
   # → Applied 1 migration(s).
   ```

Rollback with `hopak migrate down`. Status with `hopak migrate status`.
Preview with `hopak migrate up --dry-run` before touching prod.

#### Data migrations — same file

`ctx.db` is the full Hopak client inside `up`/`down`, so schema
changes and data backfills live in one migration:

```ts
export async function up(ctx: MigrationContext): Promise<void> {
  await ctx.execute(`ALTER TABLE posts ADD COLUMN slug TEXT`);
  const posts = await ctx.db.model('post').findMany();
  for (const p of posts) {
    await ctx.db.model('post').update(p.id, { slug: slugify(p.title) });
  }
  await ctx.execute(`CREATE UNIQUE INDEX idx_posts_slug ON posts(slug)`);
}
```

#### Transactional contract

- **SQLite / Postgres** — every migration runs inside `db.transaction()`.
  A throw inside `up` rolls back every DDL and data change.
- **MySQL** — most DDL auto-commits, so the transactional wrap is
  skipped. Failure partway leaves partial state. The idiom is one DDL
  per migration file; split complex changes into separate files.

#### Drift warning — bridge from sync to migrate

If you change a model in a project that still uses `sync` (no
`app/migrations/` yet) and restart the server, `sync` prints:

```
⚠ Model schema drifted from the database. `hopak sync` only creates
  new tables; column changes need a migration:
    users: missing columns "role"

  hopak migrate init       # one-time: capture current state
  hopak migrate new <name> # write ALTER TABLE up/down
```

This is the natural moment to adopt migrations. Nothing forces it —
dev DBs you drop on every iteration never need them.

#### Escape hatch

`ctx.execute(sql, params?)` is dialect-specific SQL. For multi-dialect
apps, branch on `ctx.dialect`:

```ts
if (ctx.dialect === 'sqlite') {
  await ctx.execute(`ALTER TABLE posts ADD COLUMN count INTEGER DEFAULT 0`);
} else {
  await ctx.execute(`ALTER TABLE posts ADD COLUMN count INT DEFAULT 0`);
}
```

---

## Models

A model is one file. It defines the table, the validation, and the
TypeScript row type. REST endpoints are a separate scaffold
(`hopak generate crud <name>`) that writes route files wired to
the model — so you can read every handler, tweak any verb, or skip
HTTP altogether for internal models.

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

CRUD routes are **scaffolded**, not synthesized. The CLI writes two
files per model; the framework serves them like any other file route.

```bash
hopak generate crud post
# → app/routes/api/posts.ts         (list + create)
# → app/routes/api/posts/[id].ts    (read + update + patch + delete)
```

The generated files call `crud.*` helpers exported from `@hopak/core`:

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

Six endpoints under `/api/<plural>/`:

| Method | Path | Helper |
|--------|------|--------|
| `GET` | `/api/posts` | `crud.list(post)` |
| `GET` | `/api/posts/:id` | `crud.read(post)` |
| `POST` | `/api/posts` | `crud.create(post)` |
| `PUT` | `/api/posts/:id` | `crud.update(post)` |
| `PATCH` | `/api/posts/:id` | `crud.patch(post)` |
| `DELETE` | `/api/posts/:id` | `crud.remove(post)` |

`limit` defaults to 20, max 100. Validation errors return 400; UNIQUE
violations return 409; fields declared with `password()` / `secret()` /
`token()` are stripped from responses (including those loaded through
`include`) — the name of the field doesn't matter, the field factory
does. See Recipe 3.

### Customize an endpoint

Edit the generated file. To replace just `POST /api/posts`, swap that
export for a custom handler and leave `crud.list(post)` alone:

```ts
// app/routes/api/posts.ts
import { crud, defineRoute } from '@hopak/core';
import post from '../../models/post';

export const GET = crud.list(post);
export const POST = defineRoute({ handler: async (ctx) => { /* … */ } });
```

Removed verbs simply disappear — the router answers `405 Method Not
Allowed` with an `Allow:` header listing what remains.

### Gate a CRUD verb with middleware

Each `crud.*` helper takes an optional second argument with
`before`, `after`, `wrap`:

```ts
import { crud } from '@hopak/core';
import { requireAuth, requireRole } from '@hopak/auth';
import post from '../../models/post';

export const GET = crud.list(post);
export const POST = crud.create(post, { before: [requireAuth()] });
export const DELETE = crud.remove(post, {
  before: [requireAuth(), requireRole('admin')],
});
```

Options apply only to that verb. See the Middleware section below
for the full `Before` / `After` / `Wrap` contract.

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

Every `defineRoute({...})` accepts optional `before`, `after`, `wrap`
middleware alongside `handler` (see Middleware below):

```ts
export const POST = defineRoute({
  before: [requireAuth()],
  after: [audit],
  handler: async (ctx) => { /* … */ },
});
```

---

## Middleware

Three hooks for the request pipeline. Typed functions, not a
Koa-style `(ctx, next)` chain — no `next()` to forget.

```ts
type Before = (ctx: RequestContext) =>
  Promise<Response | void> | Response | void;

type After = (
  ctx: RequestContext,
  result: { response?: Response; error?: unknown },
) => Promise<void> | void;

type Wrap = (
  ctx: RequestContext,
  run: () => Promise<Response>,
) => Promise<Response>;
```

- **`Before`** — runs before the handler. Throw a `HopakError` to
  short-circuit with that status. Return a `Response` to short-circuit
  with that response. Return nothing to continue. Mutations to `ctx`
  flow through (e.g. `ctx.user = ...`). Right place for auth,
  rate-limiting, request-id.
- **`After`** — runs after the handler (or error), with the final
  response. Cannot change the response — read-only. Use for access
  logs, metrics, audit trails. If it throws, the error is logged and
  the request still completes.
- **`Wrap`** — wraps handler execution (plus route-level `before`s).
  `run()` produces the response. Use this only when observation
  isn't enough — per-request transactions, request-scoped caches,
  correlation-id propagation in `async_hooks`.

### Where to register

Two scopes — global (every request) and per-route:

```ts
// main.ts — global
import { hopak, requestId, requestLog } from '@hopak/core';

await hopak()
  .before(requestId())
  .after(requestLog())
  .wrap(async (_ctx, run) => run())  // rarely needed
  .listen();
```

```ts
// app/routes/api/posts.ts — per-route
export const POST = defineRoute({
  before: [requireAuth()],
  after: [audit],
  handler: async (ctx) => { /* … */ },
});
```

`crud.*` helpers take the same options as a second argument —
see CRUD → Gate a CRUD verb.

### Execution order

For one request:

```
global.before[]  →  wrap[]  →  route.before[]  →  handler
                                (throw or return Response short-circuits)
route.after[]    →  global.after[]
```

`Wrap`s nest — the outer-most runs first on entry, last on exit
(like onion layers).

### `hopak().before/.after/.wrap` is frozen after `listen()`

Registering middleware after the server starts throws:

```ts
const app = hopak();
await app.listen();
app.before(requestId());
// Error: hopak().before(): cannot register middleware
//        after listen() — add it before starting the server.
```

This protects against half-applied middleware on live requests.

### Built-in: `requestId()` + `requestLog()`

See Recipe 23 for the full walkthrough. One command enables both:
`hopak use request-log`.

### `EMPTY_MIDDLEWARE`

Exported sentinel for `{ before: [], after: [], wrap: [] }`. Useful
if you compose your own `Middleware` object and want an explicit
empty default.

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
    ctx.startedAt;          // number — request start (Date.now()), used for duration
    ctx.requestId;          // string | undefined — set if requestId() middleware ran

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

Plug-in packages extend `ctx` via module augmentation — `@hopak/auth`
adds `ctx.user?: AuthUser` when `requireAuth()` runs; custom plug-ins
follow the same pattern.

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
    "title": ["Invalid length: Expected >=3 but received 2"],
    "content": ["Invalid key: Expected \"content\" but received undefined"]
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

On a fresh project, `hopak dev` and `hopak sync` create tables via
`CREATE TABLE IF NOT EXISTS` for every model — plus `CREATE INDEX IF
NOT EXISTS` for each `.index()` field. This path is **idempotent naive
replay**: safe to run repeatedly, but doesn't handle schema changes
(`ALTER TABLE` / `RENAME` / `DROP`).

The moment `app/migrations/` contains files, this path shuts off —
`hopak dev` boots without touching the schema and `hopak sync` exits
`1` pointing at `hopak migrate up`. Migrations own schema evolution
from that point on; see Recipe 24.

Drift warning: if you change a model in a project that still uses
sync (no migrations yet), the next `hopak sync` or `hopak dev` compares
live columns against the model and prints a WARN pointing at
`hopak migrate init`.

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
app it's always set — `ctx.db!.model(...)` narrows safely, or
`if (!ctx.db) throw new InternalError(...)` for an explicit check.

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

### `execute(sql, params?)` — arbitrary SQL

For statements the typed client doesn't cover (`ALTER TABLE`, `PRAGMA`,
`REFRESH MATERIALIZED VIEW`, introspection queries), drop to raw SQL:

```ts
await ctx.db.execute(
  `ALTER TABLE posts ADD COLUMN slug TEXT`,
);

await ctx.db.execute(
  `INSERT INTO audit (actor_id, action) VALUES (?, ?)`,
  [userId, 'login'],
);
```

Dialect-specific syntax — you're writing raw SQL, portability is your
call. Parameter binding works on SQLite and MySQL; on Postgres it
works outside a transaction but params aren't supported inside a tx
callback (inline values or use `ctx.db.model(...)`).

This is the same method the migration runner uses under the hood —
migrations are just `execute` calls wrapped in a versioned file.

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

If HTTPS is on and the cert files aren't there, `hopak dev` fails
fast with a pointer back to `hopak generate cert` — the runtime
never shells out to openssl on its own.

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
    migrations: 'app/migrations',   // where `hopak migrate *` writes files
    public: 'public',
    hopakDir: '.hopak',             // runtime state (SQLite file, certs)
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
│   ├── models/        # one file per resource (hopak generate model)
│   ├── routes/        # file-based routing (hopak generate route / crud)
│   └── migrations/    # versioned schema changes (hopak migrate new / up)
├── public/            # static files
├── .hopak/            # runtime state (SQLite file, dev certs); gitignored
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
| `hopak sync` | Create missing tables from models. Refuses once `app/migrations/` exists — prints drift warning when live columns lag the model |
| `hopak migrate init` | Seed initial migration from current models |
| `hopak migrate new <name>` | Empty up/down skeleton |
| `hopak migrate up [--to ID] [--dry-run]` | Apply pending migrations |
| `hopak migrate down [--steps N] [--to ID]` | Roll back (default: last 1) |
| `hopak migrate status` | Applied / pending / missing |
| `hopak check` | Audit project state (config, models, routes) |
| `hopak use <capability>` | Enable a capability: `sqlite` / `postgres` / `mysql` / `request-log` / `auth` |
| `hopak use` | List available capabilities |
| `hopak --version` | Show version |
| `hopak --help` | Show help |

### `hopak use <capability>`

One command to wire a feature into an existing project — installs
extra packages, patches the right files, and adds env keys.

| Capability | Effect |
|---|---|
| `sqlite` / `postgres` / `mysql` | Switch database dialect (driver + `hopak.config.ts` block + `.env.example`). |
| `request-log` | Patch `main.ts` to add `requestId()` + `requestLog()` from `@hopak/core`. See Recipe 23. |
| `auth` | Install `@hopak/auth`, scaffold `app/middleware/auth.ts`, signup/login/me routes, `JWT_SECRET` in `.env.example`. See Recipe 24. |

Run `hopak use` with no args for the up-to-date list.

Typical DB flow:

```bash
hopak new my-app           # starts on SQLite
cd my-app
hopak use postgres         # switches to Postgres
# → bun add postgres
# → hopak.config.ts gains: database: { dialect: 'postgres', url: process.env.DATABASE_URL }
# → .env.example gains: DATABASE_URL=postgres://user:pass@localhost:5432/myapp
```

Then copy `.env.example` → `.env`, fill secrets, run `hopak sync`,
and `hopak dev`. Nothing in your application code changes — the
same handlers work across all three dialects.

`hopak use` never overwrites a file it didn't generate. If a target
already exists and looks hand-edited, the command prints the snippet
to paste manually and exits non-zero — predictable in CI.

---

## Stack

- **Runtime:** Bun
- **Validation:** Valibot
- **ORM:** Drizzle (SQLite / Postgres / MySQL)
- **Lint/Format:** Biome

---

## License

MIT.

## Author

**Volodymyr Press** · [vladimpress@gmail.com](mailto:vladimpress@gmail.com) · [github.com/hopakjs](https://github.com/hopakjs)

Made with ❤️ in Ukraine 🇺🇦
