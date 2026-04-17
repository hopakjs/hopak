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

On first boot Hopak creates the SQLite file at `.hopak/data.db` and runs `CREATE TABLE IF NOT EXISTS` for every model. Safe to repeat — `hopak migrate` does the same thing explicitly if you prefer to separate schema sync from server start.

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

curl 'http://localhost:3000/api/posts?limit=5&offset=10'
# pagination via query string; limit defaults to 20, max 100
```

**5.** Verify what's actually registered:

```bash
hopak check
# ✓ Models     1 loaded (post)
# ✓ Auto-CRUD  1 model(s) with crud:true → 6 endpoint(s)
```

Six endpoints from one file: list, read, create, replace, patch, delete — all paginated and validated. Remove `{ crud: true }` to keep the table but suppress the endpoints (useful for internal-only models). The plural segment (`/api/posts`) comes from `pluralize('post')` — irregular plurals are handled (`story → stories`, `box → boxes`).

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

When writing your own handler, validate with the same schema the auto-CRUD uses:

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

`buildModelSchema(model, { partial: true })` gives the `PATCH`-flavoured schema. `result.errors` is `Record<field, string[]>` — the same shape auto-CRUD sends back.

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

### 5. Override one auto-CRUD endpoint

**Goal:** replace just the `POST /api/posts` handler with custom logic, keep the other five auto-CRUD endpoints as they are.

Create a file at the matching path. **File routes always win**, matched by exact method + URL pattern.

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

#### Disable a single endpoint

Create the override and throw from it — clients see the exact status you pick:

```ts
// app/routes/api/posts/[id].ts — block DELETE only
import { defineRoute, Forbidden } from '@hopak/core';

export const DELETE = defineRoute({
  handler: () => { throw new Forbidden('Posts cannot be deleted'); },
});
```

`GET`, `PUT`, `PATCH` for `/api/posts/:id` still work — only `DELETE` is locked down.

#### Turn off auto-CRUD entirely

Drop `{ crud: true }` from the model. The table and validation stay, but no endpoints are generated — you write every route by hand, with full control over the URL structure (no forced `/api/<plural>` prefix).

#### Gotcha: file path must match the auto-CRUD URL

Auto-CRUD mounts at `/api/<plural>/[:id]`. The override file has to live at the same path — `app/routes/api/posts.ts` for `POST /api/posts`, or `app/routes/api/posts/[id].ts` for `PUT /api/posts/:id`. A file at `app/routes/posts.ts` won't override anything (it creates a new `/posts` resource next to the auto-CRUD one).

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

`where` is a flat object of `{ field: value }` pairs combined with `AND`. Values are matched by equality. That's it today — OR, `>`/`<`, `IN`, `LIKE` are not yet on the typed client. For anything richer, drop to raw SQL (below).

#### Pagination defaults

```ts
client.findMany({})               // limit: 20, offset: 0
client.findMany({ limit: 100 })   // 100 is the hard cap
client.findMany({ limit: 500 })   // clamped to 100 — no error
```

These are the same defaults auto-CRUD applies, so custom routes and generated endpoints paginate consistently.

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

#### The FK field in the API

The **API field** is what you named in the model (`author`). The **column name** is `<field>_id` under the hood, but you don't interact with it — Hopak maps both directions. Send `{ "author": 1 }` in JSON; filter with `{ where: { author: 1 } }` in the client; receive `"author": 1` in responses.

Foreign-key integrity is enforced by SQLite — inserting a post with `author: 999` where user 999 doesn't exist returns `409 CONFLICT`.

#### Fetch the parent manually

Relations today don't eager-load (no `?include=author` query). To return a post with its author attached, join in a custom route:

```ts
// app/routes/api/posts/[id]/with-author.ts
import { defineRoute, NotFound } from '@hopak/core';

export const GET = defineRoute({
  handler: async (ctx) => {
    const id = Number(ctx.params.id);
    const post = await ctx.db?.model('post').findOne(id);
    if (!post) throw new NotFound(`Post ${id} not found`);
    const author = post.author
      ? await ctx.db?.model('user').findOne(post.author)
      : null;
    return { ...post, author };
  },
});
```

For `hasMany`, fetch the children with a filter:

```ts
const author = await ctx.db?.model('user').findOrFail(Number(ctx.params.id));
const posts = await ctx.db?.model('post').findMany({ where: { author: author.id } });
return { ...author, posts };
```

#### Migrations

`hopak migrate` (and `hopak dev`'s first boot) creates the column and the FK constraint. Changing a `belongsTo` target after rows exist is not automatic — you'd drop the table or migrate the data by hand. For prototyping, delete `.hopak/data.db` and restart.

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

First boot runs `openssl req` to generate a self-signed certificate under `.hopak/certs/localhost.{crt,key}` (the directory is in `.gitignore` automatically). Subsequent boots reuse it. Delete the files to re-issue.

**Requires `openssl` on the machine.** macOS ships it. On Ubuntu/Debian: `apt install openssl`. On Alpine: `apk add openssl`.

**3.** Verify:

```bash
curl -k https://localhost:3443/           # -k accepts the self-signed cert
```

Browser will show a warning the first time — that's expected for a self-signed cert.

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

### 11. Allow CORS from your frontend

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

### 12. Serve static files

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
2. **Auto-CRUD routes** generated by `model(..., { crud: true })`
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

After this:

- `hopak generate model post` writes to `src/domain/post.ts`
- `hopak generate route posts/[id]` writes to `src/api/posts/[id].ts`
- `hopak dev`, `hopak migrate`, `hopak check` scan the new directories
- Static files are served from `static/` instead of `public/`

#### All configurable paths

```ts
paths: {
  models: 'src/domain',        // where hopak scans models
  routes: 'src/api',           // where hopak scans routes
  public: 'static',            // static-file root
  jobs: 'src/jobs',            // background jobs (Phase 2)
  migrations: 'src/migrations',// migration files (Phase 2)
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

### 14. Scaffold files from the CLI

**Goal:** don't write boilerplate by hand — let `hopak generate` create the file with a starter template.

```bash
hopak generate model comment
# → Creates app/models/comment.ts

hopak g model comment
# ↑ same thing, short form
```

Contents of the generated model:

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

Replace the fields with your real schema and save — `hopak dev` hot-reloads.

#### Generating routes

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

If `hopak.config.ts` has `paths.models: 'src/domain'`, `hopak generate model comment` writes to `src/domain/comment.ts` — the generator respects the config (see recipe #13).

#### Refusal policy — never overwrites

Running `hopak generate model comment` twice fails on the second run:

```
Error: app/models/comment.ts already exists
```

Exit code `1` — safe to run from npm scripts or Makefiles. Delete the file (or rename it) if you really want a fresh template.

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
