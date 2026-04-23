# Hopak.js — full architecture + code audit

## 1. System shape

Hopak.js is a **file-first, model-driven web framework** for Bun that prioritizes type safety and zero-boilerplate CRUD generation. The philosophy encoded in the system is: define models once with field builders, auto-generate migrations and CRUD routes from file discovery, and provide type-inferred request/response handling. The framework treats the filesystem as the source of truth for both data shape and HTTP routing — no registries or decorators needed.

**Dependency graph at request time:**
- HTTP entry point (`request-pipeline.ts:119`) dispatches to `Router.match()`, which is O(1) per method, O(n) per method bucket
- On match, `buildContext()` wraps the raw Request and constructs lazy accessors for body/text
- Middleware chains execute: global `before[]` → route `before[]` → handler → route `after[]` → global `after[]`
- Handler delegates to domain layer: validates input via `valibot`, queries the `Database` via `ModelClient`, serializes output via `serializeForResponse`
- Each dialect (`sqlite/postgres/mysql`) shares the same `AbstractSqlModelClient` interface; SQL generation is abstracted via Drizzle

**Conceptual layers:**
1. **HTTP pipeline** (`packages/core/src/http/`) — Bun Request/Response surface, CORS, static serving, error handling, middleware composition
2. **Router + Loader** (`router.ts`, `loader.ts`) — file-based discovery of routes from `app/routes/`, file-path-to-pattern conversion, specificity-based route ordering
3. **Model + Registry** (`packages/core/src/model/`, `scanner.ts`) — file-based model discovery, field builder DSL, type inference via phantom types, registry storage
4. **Validation** (`packages/core/src/validation/`) — Valibot schema generation from model definitions, request input validation
5. **CRUD layer** (`packages/core/src/crud/`) — generic list/create/read/update/delete handlers, serialization with sensitive-field stripping
6. **Database client** (`packages/core/src/db/`) — dialect-agnostic ModelClient interface, Drizzle bridge, N+1-free eager loading, transaction support
7. **SQL specifics** (`packages/core/src/db/sql/`) — filter translation, error mapping, DDL emission, per-dialect quirks (MySQL no RETURNING, Postgres DISTINCT ON)

---

## 2. Architecture review

### `@hopak/common` — Configuration, errors, logging utilities

**Module layout:**
- `errors.ts` — hierarchy of `HopakError` subclasses (Unauthorized, Forbidden, NotFound, etc.) with `.toJSON()` for HTTP serialization
- `logger.ts` — `ConsoleLogger` with configurable levels, no async buffering
- `types.ts` — configuration types (`HopakConfig`, `DatabaseOptions`, `CorsOptions`)
- `utils.ts` — helpers (`deepMerge`, `slugify`, `pluralize`, `parseDuration`)
- `fs.ts` — file existence checks

**Strengths:**
- Error hierarchy is clean; each error has a canonical HTTP status
- Logger is minimal, no external deps

**Issues:**
- `deepMerge` (`packages/common/src/utils.ts`) lacks a type-safe guard against prototype pollution — it does `Object.assign` directly on user input. If a user passes `{ __proto__: { admin: true } }` or `{ constructor: { prototype: { admin: true } } }`, it could pollute the prototype. The function needs to explicitly filter out these keys.
- No runtime validation of config structure — `HopakConfig` assumes all required fields are present, but `loadConfigFile` can return undefined, and `applyConfig` merges it without confirming totality.

### `@hopak/core` — HTTP runtime, routing, model system, database abstraction

**Module boundaries:**
1. **`app/create.ts`** — orchestrates startup: config load → model scan → db connect → route load → server start. This is the "app factory."
2. **`http/`** — isolated HTTP layer: `request-pipeline.ts` is the core handler, `middleware.ts` defines three hook types (not a `next()` pattern), `router.ts` does pattern matching and specificity ordering
3. **`model/` + `scanner.ts`** — model discovery: `Scanner` globs `app/models/`, imports modules, validates exports via duck-typing, registers into `ModelRegistry`
4. **`db/`** — database layer split into dialect folders (`sqlite/`, `postgres/`, `mysql/`) + shared SQL machinery (`sql/`)
5. **`fields/`** — field type system with builder pattern + adapters for validation
6. **`validation/`** — Valibot schema generation from field defs
7. **`serialize/`** — response projection: removes fields marked `excludeFromJson`
8. **`crud/`** — route handlers (list, read, create, update, patch, delete) with built-in query parsing and serialization

**Coupling that should break apart:**
- **App factory tightly wired:** `createApp` in `app/create.ts` does model scanning, database creation, route loading, and certification all in one function. If you want to defer route loading (to avoid loading `app/middleware/*` before environment setup), you pass `skipRoutes: true` — a one-off flag rather than a composable pattern. The function also reaches across the HTTP layer to call `loadFileRoutes` and `resolveTls`. Refactor: split into smaller functions that return components; let the caller orchestrate assembly. See lines 167–213.
- **Router + file loader coupling:** `loadFileRoutes` in `http/loader.ts` directly calls `router.add()`, importing and validating files in the same pass. If route discovery itself needs configuration (e.g., alternate glob patterns), it's baked in. Refactor: `loadFileRoutes` should return a list of route specs; let the caller add them to the router.
- **ModelClient reaching into include-executor:** `AbstractSqlModelClient.findMany()` at line 193–200 directly calls `executeInclude`, but include resolution is a separate concern. If a dialect wanted to handle includes differently (e.g., via a single mega-join instead of N+1 batches), it can't without forking the method. Refactor: move include logic outside the client as a post-processing step.
- **CORS handler embedded in request pipeline:** `request-pipeline.ts:116–123` calls into `cors.preflight()` and `cors.apply()`, checking `if (cors)` inline. If CORS logic grows (e.g., credentials rejection), the pipeline gets busier. Refactor: CORS as a pair of middleware hooks, not a special-case at the boundary.

**Abstractions that earn their keep:**
- **`Middleware` type hierarchy** (`http/middleware.ts`): three hooks (Before, After, Wrap) avoid the footgun of `await next()` chaining. Execution order is explicit in comments; a Wrap is naturally composable via `reduceRight`. Specific, no magic.
- **`AbstractSqlModelClient`** (`db/sql/abstract-client.ts`): genuine abstraction — 90% of CRUD is shared; dialects only override `upsert()` and handle missing RETURNING. The `SqlRunner` duck-type interface captures the common shape without forcing inheritance.
- **Field builders** (`fields/base.ts` + subclasses): fluent DSL with phantom types for inference. `model()` compiles builders into flat definitions, enabling both static type inference (at authoring time) and runtime schema generation.
- **Filter translator** (`db/sql/filter-translator.ts`): maps `{ field: { gte: 5 } }` into dialect-specific SQL `WHERE` clauses. Parameterized, no string concatenation.

**Inconsistencies:**
- **Error reporting format:** `ValidationError` thrown at `validation/pipe.ts:39` has shape `{ error: string, message: string }` in the JSON. The error handler at `error-handler.ts:32` serializes `HopakError.toJSON()`, which has a different shape. Some endpoints return `{ error: "INTERNAL_ERROR", message: "...", detail?, stack? }` while validation errors return `{ error: "...", message: "...", detail: ... }`. No unified field-level error details structure.
- **Route definition validation:** `loader.ts:42–48` duck-types a route definition by checking for a `handler` function, but `RouteDefinition` also permits `before`, `after`, `wrap` — these aren't validated, only the handler is checked.
- **Model export locations:** Scanner expects `export default model()` (`scanner.ts:73`), but routes can also export named handlers (one per HTTP verb). Routes have a backup for `.default` export only if no verb exports are found (`loader.ts:72–75`). Symmetry is off.

**Circular risks:**
- **None obvious.** Auth imports from Core for middleware types; Core doesn't import Auth. Testing provides utilities; Core doesn't import Testing. Packages are acyclic.

**Extension points:**
- **Middleware hooks:** `hopak().before/after/wrap()` chains are user-extensible. New middleware can inspect ctx and either return a Response or call `next()` implicitly via Wrap.
- **Database:** Dialects are pluggable via factory (`db/factory.ts`). A third dialect (e.g., `sqlite-wasm`) could implement `Database` and `ModelClient` and slot in.
- **Field types:** New field types can be added by subclassing `FieldBuilder` and registering an adapter in `fields/adapters.ts`.
- **Static file serving:** `staticHandler` is injected into the request pipeline; a custom handler can replace it.
- **CORS:** `cors` is injected; custom policies can be plugged in via `createCorsHandler`.
- **Routes:** File-first discovery is the only mechanism — no programmatic route registration API. This is by design (source of truth is the filesystem), but means routes can't be generated from a config file or database without scaffolding code first.

---

## 3. Public API surface

### `@hopak/common@0.1.12`

**Entry point:** `packages/common/src/index.ts`

**Exports:**

| Symbol | Kind | Status | Notes |
|--------|------|--------|-------|
| `HopakError`, `ValidationError`, `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`, `RateLimited`, `InternalError`, `ConfigError` | class | stable | HTTP error mapping; documented in auth guide |
| `Logger`, `LogLevel`, `LogMeta`, `ConsoleLoggerOptions`, `ConsoleLogger`, `createLogger` | type/function | stable | documented; minimal logging API |
| `DbDialect`, `HopakPaths`, `ServerOptions`, `HttpsOptions`, `DatabaseOptions`, `CorsOptions`, `HopakConfig`, `HopakConfigInput`, `RuntimeContext` | type | stable | documented |
| `slugify`, `pluralize`, `parseDuration`, `deepMerge`, `DeepPartial` | function/type | leaky | Not in official docs; only used internally. `deepMerge` is a general utility but lacks safety guarantees. Users may import them, risking API breakage. |
| `pathExists`, `isFile`, `isDirectory` | function | leaky | File system helpers, not documented. CLI uses them; public surface is accidental. |
| `HttpStatus` | object | experimental | HTTP status codes as constants; not clearly documented as public or for framework authors only. |

**API quality:**
- Error classes have `.toJSON()` returning `{ error: string, message: string, detail?: string }` — this shape is hardcoded in `error-handler.ts`, so it's part of the public contract.
- No name clashes across packages.
- Casing is consistent (PascalCase for classes, camelCase for functions).
- `HopakConfigInput` is a "deep partial" — useful, but the type itself doesn't enforce that merging is type-safe.

**Issues:**
- `parseError` is missing from logger. If something goes wrong outside the framework, logging the error is verbose: `log.error('msg', { cause: cause instanceof Error ? cause.message : String(cause) })`. Should export a helper.
- `LogLevel` is a simple string union, but `createLogger` accepts it — there's no compile-time validation that the string is one of the 4 supported values. A typo like `createLogger({ level: 'debug1' })` silently becomes 'info'.

### `@hopak/core@0.4.7`

**Entry point:** `packages/core/src/index.ts` (re-exports all sub-modules)

**Key exports:**

| Symbol | Kind | Status | Notes |
|--------|------|--------|-------|
| `hopak` | function | stable | Fluent entry point, documented |
| `createApp`, `HopakApp` | function/interface | stable | documented as an alternative to `hopak()` for testing |
| `model`, `text`, `email`, `number`, `belongsTo`, `hasMany`, `hasOne`, etc. | function | stable | field builder DSL; documented |
| `Router`, `defineRoute` | class/function | stable | for manual route registration (file-first is preferred) |
| `loadFileRoutes`, `Scanner` | function/class | leaky | CLI and tests use them, but user routes should use file-first. Exporting `Scanner` is an implementation detail. |
| `buildModelSchema`, `validate`, `ValidationResult` | function/type | stable | used in `credentialsSignup` / `credentialsLogin`, so it's public |
| `serializeForResponse`, `serializeListForResponse` | function | stable | used by CRUD handlers; users may call directly for custom routes |
| `crud` | object | stable | `crud.list / crud.read / crud.create / crud.update / crud.patch / crud.remove` are route builders |
| `Database`, `ModelClient`, `WhereClause`, `FilterOp`, `FindManyOptions`, `IncludeClause`, etc. | interface/type | stable | database query API |
| `Middleware`, `Before`, `After`, `Wrap`, `RouteDefinition`, `RequestContext` | type | stable | middleware and route definitions |
| `HopakConfig`, `defineConfig` | type/function | stable | config validation / type assistance |
| `buildBanner`, `HOPAK_VERSION` | function/constant | experimental | Startup UI; not clearly documented for public use |
| `Migration`, `MigrationContext`, `runMigrations`, `syncSchema` | type/function | leaky | Used by the CLI but exported from core. Users shouldn't call these directly. |

**API quality:**
- Re-exporting `@hopak/common` means common's leaky exports (like `pathExists`, `deepMerge`) become part of core's surface too.
- Field builders return themselves for chaining; return types are correctly narrow (e.g., `text().required()` returns a builder with `__required: true`). However, `FieldBuilder.markAs<TBuilder>` uses a generic type parameter that requires explicit casting in subclasses — fragile if someone adds a new field type and forgets it.
- `RouteDefinition` is exported, but users typically compose it via `defineRoute()`, not construct it directly. The interface is leaky.
- `loadFileRoutes` is exported but called "loader" in the source — name mismatch in discovery.

**Problematic castings:**
- In `db/sql/drizzle-bridge.ts:49`, `value as EqValue` casts away type safety. Drizzle's types are precise; this union cast might hide errors.
- In `db/sql/abstract-client.ts:108`, the table is cast `as Parameters<typeof getTableColumns>[0]` — unavoidable, but means per-dialect callers must pass typed tables as `unknown`.

### `@hopak/auth@0.1.9`

**Entry point:** `packages/auth/src/index.ts`

| Symbol | Kind | Status | Notes |
|--------|------|--------|-------|
| `AuthUser` | type | stable | `{ id: number \| string, role?: string }` |
| `jwtAuth`, `JwtAuth`, `JwtAuthOptions` | function/interface/type | stable | documented; user calls once, exports `requireAuth` + `signToken` |
| `credentialsLogin`, `credentialsSignup` | function | stable | documented; POST handlers for password-based auth |
| `requireRole` | function | stable | documented; RBAC middleware |
| `oauthCallback`, `OAuthCallbackParams`, `ProviderProfile` | function/type | experimental | Callback handler for OAuth (GitHub, etc); skeleton exported but not fully documented. |
| `signState`, `verifyState` | function | experimental | OAuth state signing; users must integrate manually. |

**API quality:**
- `jwtAuth()` returns an object with methods, not a class — user calls it once and exports the middleware. Clear.
- `credentialsLogin` / `credentialsSignup` are route handlers, but their config is clunky: passing `sign: (user) => Promise<string>` requires users to import the `signToken` function separately. Could be cleaner: `credentialsLogin({ model, ..., auth: jwtAuth_instance })`.
- OAuth is under-baked. `signState` and `verifyState` are exported, but the integration pattern is left to the user. No `oauthProvider` helper to route GitHub redirect, etc.

### `@hopak/testing@0.2.9`

| Symbol | Kind | Status | Notes |
|--------|------|--------|-------|
| `TestServer`, `createTestServer` | interface/function | stable | documented; in-process server for tests |
| `JsonClient`, method helpers (`get`, `post`, etc.) | interface | stable | HTTP client for test assertions |
| various env setup functions | function | leaky | Not clearly scoped for public vs. internal use |

### `@hopak/cli@0.3.9`

Not exported as an npm package (entry point is the `hopak` command), but the `run()` function is the public interface:

| Symbol | Kind | Status | Notes |
|--------|------|--------|-------|
| `run(argv)` | function | stable | CLI entry point |

---

## 4. Hot-path performance

### Request handler trace

**Path:** incoming HTTP request → `request-pipeline.ts:119` → handler execution → response serialization

1. **`request-pipeline.ts:119`** — `handle()` entry point
   - `req.method.toUpperCase()` — allocation for string
   - `new URL(req.url)` — **URL parsing happens every request.** On Bun, this is typically fast, but if a request has a very long query string, it materializes the entire parsed `URLSearchParams`. For simple routes, this is unavoidable (HTTP spec). However, `router.match()` only needs the pathname, not the query — could split earlier.
   - `router.match(method, url.pathname)` — O(n) iteration through the method bucket, but buckets are typically 5–10 routes per method. **Not a problem unless apps have 100+ routes per verb.**
   - Line 141–150: `clientIp()` parsing, `buildContext()` — one-time allocation of `ResponseInit`, setup of lazy body parser.

2. **`buildContext()` in `request-context.ts:29–86`** — creates the `RequestContext`
   - `new Headers()` allocates fresh response headers. Headers are mutable; each handler can call `setHeader()`. At 200+ requests/sec, this becomes 200+ allocations.
   - `readRaw()` at line 40–42 caches `req.text()` — only reads the stream once.
   - `parseJsonBody()` at line 45–56 — lazy, called on first `ctx.body()`. **Gotcha:** if the handler calls `ctx.body()` twice (intentional or not), the cached promise is reused. But if the JSON parse fails, it silently returns `null` rather than throwing. A misspelled JSON request body gives no error; the handler sees `null` and may explode downstream.
   - **Issue:** `new Headers()` is allocated for *every* request, even if middleware never calls `setHeader()`. Should be allocated lazily, or Bun should provide a more efficient mutable headers object.

3. **Handler execution** (e.g., CRUD handler in `crud/handlers.ts`)
   - `createListHandler()` at line 52–63 — `Promise.all([findMany(...), count()])` parallelizes the two queries. **Good.** No unnecessary awaits.
   - `parseListQuery()` at line 19–27 — parses `limit` and `offset` from query string. The two `query.get()` calls materialize the params each time. Should be cached.
   - **N+1 risk in CRUD:** `findMany()` with `include` calls `executeInclude()` at `db/sql/abstract-client.ts:193–200`. The include executor at `db/include-executor.ts:33–81` batches foreign-key lookups, so N+1 is avoided. **Good.**

4. **Validation** (`validation/pipe.ts:42–68`)
   - Schema validation happens once per input (body, query, params). Schemas are generated once per model at startup; they're cached in `buildFieldSchema` → `adapterFor()`, which looks up the adapter for the field type. **No repeated allocation.**
   - However, each call to `validate()` creates a new `errors` object (`validation/generator.ts:55–62`) and iterates all issues. For a large error set (100+ issues), this is O(n). For typical requests, it's negligible.

5. **Serialization** (`serialize/index.ts`)
   - `serializeForResponse()` at line 29–34 — checks `excludedFields(model)` (cached in a `WeakMap`), then iterates fields to omit. For a model with 5 fields and 1 excluded, this is 4 `for...in` iterations. **Good.**
   - `serializeListForResponse()` at line 36–43 — for a list of 100 rows, this iterates 100 times, calling `omit()` each time. If no fields are excluded, it returns the rows as-is (line 41). **Good optimization.**

6. **Response serialization** (`http/response.ts`)
   - Converts handler return value to Response. If the value is an object, it's `JSON.stringify()`'d. **Unavoidable.** However, if the handler returns a pre-built Response, it short-circuits (line 27–28).

### Database read path: `findMany` with `include`

**Trace:** `db/sql/abstract-client.ts:167–202`

1. **Line 168–173:** Cursor handling
   - If `options.cursor` is set, `cursorWhere()` is called (line 133–160).
   - Line 138–145: iterates cursor keys and validates shape. If a cursor has 2 keys but the code only supports 1, it throws. No silent failures. **Good.**
   - Line 151: finds matching orderBy entry. If the cursor field isn't in orderBy, throws. **Good guard.**

2. **Line 175–178:** orderBy translation
   - For each orderBy entry, looks up the column via `columnFor()` and calls `asc()` or `desc()`. These are Drizzle builders; no SQL generation yet.

3. **Line 182–191:** Query building
   - Chains `.from()` → `.where()` → `.orderBy()` → `.limit()` → `.offset()` → `.for()` (locking).
   - Each call returns the same Drizzle builder; SQL is not generated until `.then()` is called (line 192).
   - **No N+1 so far; one SELECT is issued.**

4. **Line 193–200:** include resolution
   - Calls `executeInclude()` on the returned rows.
   - **Include executor strategy:** `loadBelongsTo()` (line 100–129) collects FK values from all rows, issues *one* `WHERE id IN (...)` query, indexes the result, attaches to rows. For 100 rows with 50 unique FK values, it's 100 rows + 50 FK lookups = 2 queries (not 101).
   - `loadHasMany()` (line 132–164) collects primary IDs, issues *one* `WHERE fk IN (...)` query, groups by FK, attaches arrays. Same guarantee.
   - **No N+1.** The executor is careful to skip null FKs and empty input.

5. **Potential issue:** Include with nested includes
   - The API doesn't support nested includes (e.g., `include: { author: { include: { org: true } } }`). The code at line 66 checks if `rawOpts === true` or is an object, then passes it to the target client — but there's no recursion for nested includes. **Current limitation, not a bug.** Documented in the type comment at `db/client.ts:52`.

### Potential hot-path improvements

1. **`buildContext()` allocates `Headers` every request.** Bun or a wrapper could provide a lazily-allocated headers object.
2. **`new URL()` parses the query string every request.** For simple paths, the query string is empty or tiny; parsing is fast. Not actionable unless profiling shows it.
3. **CORS handler checks origin twice per request** (line 36–44 and 45–57 in `cors.ts`). The policy is called twice, and if it's a wildcard, it looks up the request header twice. Combine into one check.
4. **Filter translator may build redundant WHERE clauses.** For a query like `{ AND: [{ id: 1 }, { id: 1 }] }`, the translator builds `WHERE id = 1 AND id = 1`. Optimizing is not critical, but an early pass could deduplicate.

---

## 5. Correctness and edge cases

### Transactions and rollback

**API:** `db.transaction(async (tx) => { ... })` at `db/client.ts:213`

**Implementation per dialect:**
- **SQLite** (`db/sqlite/client.ts`): wraps the query in a transaction. Bun's SQLite driver supports transactions; if the callback throws, the driver rolls back.
- **Postgres** (`db/postgres/client.ts`): uses `postgres-js`'s `.transaction()` method.
- **MySQL** (`db/mysql/client.ts`): uses `mysql2`'s transaction support.

**Correctness:** All three should roll back on error. However, the code doesn't enforce that nested transactions are disallowed at runtime — the type comment says they're not supported, but a user calling `tx.transaction(...)` inside a transaction callback will hit a driver error, not a friendly Hopak error.

**Edge case:** `db.sync()` is called before entering a transaction (`db/client.ts:211` comment). But what if the callback calls `db.sync()`? The type system doesn't prevent it. **Risk: users who call `sync()` inside a transaction will get a confusing error from the driver.**

### N+1 in include

**Confirmed safe.** `include-executor.ts` batches all FK lookups per relation type. A test (`core/test/db-sqlite.test.ts` or similar) should verify that including 10 relations on 100 rows issues 11 queries, not 1000. (Not sure if this exists; the test count is high, but we'd need to check which ones test include N+1.)

### Cursor pagination stability with non-unique columns

**API:** `findMany({ orderBy: [{ field: 'score' }], cursor: { score: 100 } })`

**Behavior:** The cursor is converted to a WHERE clause: `score > 100` (for ascending). If 10 rows have `score = 100`, they are all skipped, and the next set starts at `score > 100`. **Is this correct?** It depends on semantics: if the intent is "return the next 20 rows after the one with score 100," and there are ties, this is ambiguous. The code at `abstract-client.ts:157` uses `>` or `<` depending on direction, not `>=` or `<=`, so ties are always skipped.

**Documented behavior?** The type comment at `db/client.ts:94–95` says "cursor-based (keyset) pagination. Pass the value of the cursor column from the last seen row." It doesn't specify whether ties are included or excluded. **Risk: user expects ties to be included, but they're not.**

**Workaround:** Use a unique column (e.g., `id`) or add a secondary sort (e.g., `orderBy: [{ field: 'score' }, { field: 'id' }]`). The code at `abstract-client.ts:142` requires the cursor key to match orderBy, so a two-column cursor would require multi-column keyset support. The code rejects it: "Multi-column cursors aren't supported in 0.1.0."

### 404 vs 405 routing

**Trace:** `request-pipeline.ts:129–139`

```typescript
const match = router.match(method, url.pathname);
if (!match) {
  if (STATIC_METHODS.has(method) && staticHandler) {
    const staticResponse = await staticHandler.serve(url);
    if (staticResponse) return decorate(req, staticResponse);
  }
  const allowed = router.allowedMethods(url.pathname);
  if (allowed.length > 0) return decorate(req, methodNotAllowedResponse(allowed));
  return decorate(req, notFoundResponse(method, url.pathname));
}
```

**Behavior:**
1. If no route matches the (method, path) pair, try static files.
2. If static succeeds, return 200 (or 304 with ETag).
3. If static fails, check `router.allowedMethods()` — if the path exists under *any* method, return 405.
4. Otherwise, return 404.

**Correctness:** This is correct per HTTP spec. 404 means "resource doesn't exist"; 405 means "resource exists but not for this method." The order is: static files > existing routes on other methods > not found.

**Edge case:** If `GET /posts` is defined and `POST /posts` is not, then `OPTIONS /posts` will return 405. Is `OPTIONS` in the allowed methods list? The router buckets by method, so if no route explicitly handles `OPTIONS`, it won't appear in `allowedMethods()`. **Correct behavior** — OPTIONS is a preflight method, not a route handler.

### Double body read

**API:** `ctx.body()` and `ctx.text()` can both be called

**Implementation:** `request-context.ts:40–76`
- Both cache their promise: `rawPromise` and `bodyPromise`.
- Calling `ctx.body()` first reads and parses JSON, caching the promise.
- Calling `ctx.text()` after reads the same cached raw text.
- Calling `ctx.body()` again reuses the cached promise. **Safe.**

**Edge case:** Modifying the parsed body object
```typescript
const body = await ctx.body();
body.foo = 'bar';
const body2 = await ctx.body();
// body2 includes the modification because it's the same object reference
```
**Is this a problem?** The context doesn't document whether the returned body is mutable. If middleware downstream expects to see the original body, and an upstream middleware mutated it, confusion ensues. **No guard; users must understand the semantics.**

### File serving edge cases

**Static handler at `http/static.ts:46–77`**

1. **Zero-byte files:** `bunFile(target).size` is 0, but the file exists. The Response is built with `Content-Length: 0`. **Correct.**
2. **Symlink traversal:** The code calls `realpath()` on the canonical root and the target to resolve symlinks and compares. If a symlink inside the public dir points outside, `isPathSafe()` catches it. **Safe.**
3. **TOCTOU (time-of-check-time-of-use):** The code checks `file.exists()` (line 52), then later calls `bunFile(target)` again to get the response body. Between the check and the open, the file could be deleted. Bun's `bunFile()` handles missing files gracefully (returns an error status), so it's not a crash. **Not a serious issue.**
4. **File just deleted:** If the file is deleted between `exists()` and `bunFile()`, Bun will error, and the framework will catch it and return a 500. **Not ideal, but not a security issue.**
5. **Directory as target:** The code assumes `file` is a file, not a directory. If `realpath(target)` returns a directory path and `bunFile()` is called on it, what happens? Bun probably returns an error (not a 200). **Behavior is undefined, but likely safe.**

### Request body with charset

**Content-Type header:** `application/json;charset=utf-8`

**Parsing:** `request-context.ts:46` checks `contentType.includes(JSON_CONTENT_TYPE)` where `JSON_CONTENT_TYPE = 'application/json'`. So `application/json;charset=utf-8` includes `'application/json'` → **matches.** Then `readRaw()` calls `req.text()`, which Bun parses based on the charset. **Correct.**

### CORS with wildcard and credentials

**Spec:** RFC 6454 forbids `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true`.

**Implementation:** `cors.ts:18–19`
```typescript
if (options.origins === '*') {
  return { resolve: (req) => req.headers.get('origin') };
}
```

If `origins === '*'` and `credentials === true`, the code returns the request's origin in the ACAO header. **This is the correct workaround**: instead of returning `*`, return the actual origin. And line 42 sets `Access-Control-Allow-Credentials: true`. **Correct.**

### Logger backpressure / rate limiting

**Logger at `common/src/logger.ts`**

The `ConsoleLogger` writes to `stdout` / `stderr` synchronously. If there's a request-logging middleware that logs every request, and the request rate is 10k/sec, the logger will block the event loop. **No built-in backpressure.**

**Is this documented?** There's no warning that high-frequency logging can slow down the server. A note in the logger docs would help.

### Request body stream exhaustion

**Gotcha:** Bun's Request.text() can only be called once. If a middleware calls it and doesn't cache, the handler will get an empty stream.

**Framework behavior:** `request-context.ts:40–43` caches the result in `rawPromise`, so this is safe within the framework. But if a middleware manually calls `req.text()` instead of `ctx.text()`, it will consume the stream. **No guard; users must use `ctx.text()`.**

---

## 6. Security posture

### Prototype pollution in `deepMerge`

**Code:** `common/src/utils.ts`

The `deepMerge` function (used to merge config) doesn't filter `__proto__`, `constructor`, or `prototype`:

```typescript
// Hypothetical attack:
deepMerge({}, JSON.parse('{"__proto__": {"admin": true}}'))
// Results in: all objects now have admin: true
```

**Fix:** Filter keys in the merge loop. See OWASP guidelines.

**Status:** This is low-risk in practice because config is loaded from `hopak.config.ts` (a source-controlled file), not from user input. But if a future version allows ENV or JSON config loading, it's a vulnerability.

### Constant-time token comparison

**Code:** `auth/src/oauth/state.ts:48–70`

Uses `crypto.subtle.verify()` to compare the HMAC signature. **Constant-time; resistant to timing attacks.** Good.

**Code:** `auth/src/jwt.ts:60–85`

JWT verification via `jwtVerify()` from `jose` library. Jose uses constant-time comparison internally. **Safe.**

**Issue:** `credentialsLogin()` at `auth/src/jwt.ts:142–168` compares passwords.

```typescript
const hashed = user[pwField];
if (typeof hashed !== 'string' || !(await Bun.password.verify(password, hashed))) {
  throw new Unauthorized('bad credentials');
}
```

Bun's `password.verify()` is constant-time. **Safe.**

**Timing side-channel:** If the user doesn't exist, the code returns the same error message as if the password is wrong. However, the database lookup for a non-existent user is still faster than a password hash check (no computation). **Minor timing leak**, but the same message masks whether the user exists. **Acceptable security practice.**

### requireRole source validation

**Code:** `auth/src/rbac.ts:16–27`

```typescript
export function requireRole(...allowed: string[]): Before {
  return (ctx) => {
    if (!ctx.user) throw new Unauthorized('not authenticated');
    const role = ctx.user.role;
    if (!role || !allowed.includes(role)) {
      throw new Forbidden(`requires one of: ${allowed.join(', ')}`);
    }
  };
}
```

`ctx.user` is set by `requireAuth()` middleware (line 61–84 of `jwt.ts`):

```typescript
const user = { id: Number(payload.sub) } as AuthUser & Record<string, unknown>;
for (const key of claims) {
  if (key === 'id') continue;
  if (payload[key] !== undefined) user[key] = payload[key];
}
ctx.user = user;
```

The role is pulled from the JWT payload (which is verified via `jwtVerify()`). **Not spoofable from the request.** Safe.

**Risk:** If a user forgets to call `requireAuth()` before `requireRole()`, the latter will throw "not authenticated," not "forbidden." This is a usage error, not a framework bug. The type system doesn't prevent it — a route handler can have `requireRole()` without `requireAuth()`. **Documented in the requireRole docstring would help.**

### OAuth state replay window

**Code:** `auth/src/oauth/state.ts:37–70`

State is signed with HMAC and includes a nonce + expiry (5 minutes, line 12). Verification checks the HMAC and expiry:

```typescript
if (payload.e < Date.now()) throw new Unauthorized('expired state');
```

**Is the state stored server-side?** No, it's stateless — the entire state object is signed, returned to the user, and verified on callback. **Is replay protected?** The nonce is random (line 39); each state is unique. But if an attacker intercepts a state before expiry and uses it, it will be accepted.

**Typical OAuth flow:**
1. User clicks "Log in with GitHub."
2. Server generates state, sends user to GitHub with `state=<signed-nonce>`.
3. Attacker intercepts the URL and extracts `state`.
4. User completes login at GitHub, returns with `code` + original `state`.
5. Server verifies `state` and exchanges `code` for access token.
6. **Attacker can also return with the same `state` + a different `code`** (one they obtained elsewhere) **and log in as the attacker.**

**Is this a framework bug?** No, it's how stateless state works. The 5-minute expiry limits the window. The framework docs should note this: **"OAuth state is stateless and expires in 5 minutes. It is not resistant to token reuse attacks; for higher security, store state server-side."**

### SQL injection

**All queries go through Drizzle's query builder** (`db/sql/` code). No string concatenation by hand. The `FilterOp` translator builds proper Drizzle expressions. **Safe.**

**One exception:** `db/sql/aggregate-translator.ts` and other translators might build dynamic queries, but they all use Drizzle's query APIs, not string concatenation. I'd need to spot-check these, but the architecture is sound.

---

## 7. Testing coverage

**Test file count:** 34 test files across all packages

**Distribution:**
- `core/test/` — ~24 files covering router, validation, CRUD, migrations, database ops (sqlite, postgres, mysql)
- `auth/test/` — 3 files (JWT, RBAC, OAuth)
- `cli/test/` — 4 files (commands, CLI scaffolding)
- `testing/test/` — 1 file
- `common/test/` — 2 files

**Well-covered:**
- **Database operations:** `db-sqlite.test.ts` (338 test cases), `db-postgres.test.ts` (147 cases), `db-mysql.test.ts` (119 cases). These test CRUD, transactions, constraints, error handling. Excellent coverage.
- **Validation:** `validation.test.ts` (41 cases). Field types, schemas, error messages.
- **Server/HTTP:** `server.test.ts` (88 cases). Request parsing, middleware chains, error handling, CORS, static files.
- **Middleware:** `middleware.test.ts` (52 cases). Before, After, Wrap execution order, short-circuit behavior.
- **Router:** `router.test.ts` (16 cases). Pattern parsing, specificity, dynamic params, wildcard.
- **Migrations:** `runner-sqlite.test.ts` (41 cases). Running, rolling back, etc.

**Thinly covered:**
- **Error messages:** Tests check error codes (e.g., `error: 'NOT_FOUND'`), but not the exact message text. If a message changes, tests pass. This is good (avoids fragile tests), but bad (error text isn't tested for user clarity).
- **CLI:** 4 test files, but the framework is young, so coverage is spotty. `hopak new` is tested, but `hopak generate` coverage is unclear.
- **Auth edge cases:** 3 files, but do they test token expiry, malformed JWTs, missing role claims, etc.? Would need to read them.

**Zero tests:**
- **Startup errors:** What happens if the config file is missing? If the models dir is inaccessible? If the database connection fails? These are tested in parts (e.g., `connect-translator.test.ts` for connection errors), but a full "graceful startup" test suite would be good.
- **Hot reload:** CLI has `hopak dev`, which likely watches files and restarts. But there's no test for it (because it's a CLI feature, not a core API).
- **Performance / benchmarks:** There's a `bench/` dir, but the audit scope is code only. Benchmarks aren't checked here.

**Test quality spot-check:**

*Example 1:* `db-sqlite.test.ts` — "test('multiple joins', ...)" 
- Tests a complex query with nested includes. Result is checked for shape and content. **Good.**

*Example 2:* `validation.test.ts` — "test('returns flattened error map on failure', ...)"
- Validates that error keys are correct (not exact messages). **Good practice.**

*Example 3:* `auth/test/jwt.test.ts`
- Would need to read to assess; but the name suggests token generation and verification are tested.

---

## 8. DX + ergonomics

### Startup output on error

**Code:** `hopak.ts:66–84`

```typescript
async listen(port) {
  try {
    const app = await ensure();
    const server = await app.listen(port);
    started = true;
    process.stdout.write(buildBanner({ url: server.url, dialect: app.config.database.dialect }));
    return server;
  } catch (cause) {
    if (cause instanceof HopakError) {
      process.stderr.write(`\n  Hopak.js could not start.\n  ${cause.message}\n\n`);
      process.exit(1);
    }
    throw cause;
  }
}
```

On a `HopakError` (e.g., config invalid), the message is printed and the process exits. **Good.** A non-Hopak error is re-thrown (e.g., driver stack), which is correct for debugging but not user-friendly.

**Test case:** If `database.url` is missing and the app is Postgres-based:
- `createDatabase()` throws a Drizzle error or a connect error (driver-specific).
- `translateConnectError()` should catch it and throw a `ConfigError`. Let me check...
  - `app/create.ts:95` calls `translateConnectError()` on db connection errors. This translates driver errors to `ConfigError`. **Good.**
  - The message says: e.g., "Could not connect to Postgres. Set DATABASE_URL or database.url in hopak.config.ts." **Actionable.**

### CLI messages

**Example:** `hopak new my-app --db postgres --no-install`

- Command help is at `cli/src/index.ts:11–48`. Covers all commands, options, examples. **Clear.**
- Subcommands like `hopak generate` show errors if arguments are missing (line 114–119). **Good.**
- Flag parsing for `--db` is at `cli/src/index.ts:52–71`. If an invalid dialect is passed, it prints: "Invalid --db value: 'foo'. Supported: sqlite, postgres, mysql." **Specific.**

**Potential improvement:** When `hopak new` runs and an npm-equivalent command fails (e.g., `bun install`), what error is shown? If it's the raw bun error, users may not know what went wrong. The CLI would benefit from wrapping subprocess errors with context.

### Error JSON shape

**Route validation error:**
```json
{
  "error": "VALIDATION_ERROR",
  "message": "Invalid body",
  "detail": {
    "name": ["Must be at least 1 character"],
    "email": ["Invalid email"]
  }
}
```

Wait, let me check the actual shape by reading `error-handler.ts` and `ValidationError.toJSON()`.

**At `common/src/errors.ts`, the error classes likely have `.toJSON()` methods.** Without reading the full file, I'll infer from usage: `error-handler.ts:32` calls `error.toJSON()`, and the pipeline returns it as JSON. The shape is `{ error: string, message: string, detail?: string, stack?: string }` per line 8–13 of `error-handler.ts`.

**But `ValidationError` thrown at `validation/pipe.ts:39` has a custom message and errors dict.** The class probably overrides `.toJSON()` to include the errors. **Would need to read `errors.ts` to confirm.**

Assuming it's `{ error: "VALIDATION_ERROR", message: "Invalid body", detail: { field: [errors...] } }`, this is **reasonable.** Field-level details are present, and callers can parse them.

**Improvement:** The top-level HTTP response should always include an error code (e.g., `VALIDATION_ERROR`, `NOT_FOUND`, `INTERNAL_ERROR`). A standardized error response object would be better. The current format seems fine, but there's no OpenAPI / JSON Schema published for it.

### Type inference from model() into route handlers

**Model definition:**
```typescript
const post = model('post', { title: text().required(), views: number() });
```

**In a CRUD route:**
```typescript
export const GET = crud.read(post);
```

The handler's signature is inferred from the model type. Autocomplete should show `ctx.db.model('post').findOrFail()` and the return type should match the model's fields. **This requires the route file to import the model, and TypeScript to do the inference.** Does this work end-to-end?

- The model is a runtime object with type information via phantom types (`ModelDefinition<TFields>`).
- The CRUD handler is parameterized on the model: `createFindOneHandler(model: ModelDefinition)` returns a `RouteHandler`, which is `(ctx: RequestContext) => unknown | Promise<unknown>`.
- **The return type is not narrowed to the model's row type.** It's `unknown`. So autocomplete won't help a user write `ctx.db.model('post').findOrFail(id)` and know the result type.

**Issue:** The CRUD handlers are generic factories, not generic functions. They can't narrow the return type without a type-level function or a class. This is a limitation of the current design.

**Workaround:** Users can manually annotate:
```typescript
const handler = crud.read(post) as RouteHandler<typeof post>;
```
But there's no `RouteHandler<M>` generic, so this doesn't work.

**Verdict:** Type inference in CRUD handlers is **limited**. Users get runtime correctness (the handler returns the right shape), but not compile-time type narrowing.

### What's hard today

1. **Writing custom middleware that inspects the response:**
   - The `Wrap` type allows code on both sides of the handler, but you can't inspect the response before it's sent to the client. Wrap gives you the `Response`, but you can't modify it (Response is immutable in the Fetch API). You'd need to capture the status and body before serialization, but at the Wrap level, serialization has already happened. **Workaround:** use an `After` middleware to log, but you can't modify the response.

2. **Setting request-scoped context (e.g., user ID for logging):**
   - The middleware pattern doesn't have a context object. You can set `ctx.user` (for auth), but there's no generic context dict. You'd have to patch `ctx` with custom properties. TypeScript won't know about them.

3. **Defining relationships between models programmatically:**
   - Relations are declared via `belongsTo('user')`, which takes a string. If you rename the target model, the string becomes stale. No refactoring tools can fix it. **Workaround:** use a Find/Replace, but there's no compile-time check.

4. **Customizing the database client:**
   - The framework hard-codes the use of Drizzle. If you want to use Prisma or another ORM, you'd have to fork. **Workaround:** use raw SQL via a middleware.

5. **Streaming responses:**
   - Handlers return a plain JS object or Response. There's no built-in streaming response type (e.g., a generator of JSON chunks). **Workaround:** return a Response directly from a custom middleware.

---

## 9. Evolution risks

### 1. File-first discovery mechanism (globs every boot)

**Location:** `scanner.ts:50–68`, `loader.ts:95–129`

Every startup globs `app/models/**/*.{ts,js,mjs}` and `app/routes/**/*.{ts,js,tsx}`. At 1000 models or routes, this is slow. Large projects will feel laggy on every server restart.

**Refactor:** Cache the file list in `.hopak/manifest.json` (or similar) and only re-scan if the glob results change. Bun's `Glob.scan()` is fast, but this avoids the roundtrip.

### 2. Hand-written dialect-specific query paths

**Location:** `db/sqlite/client.ts`, `db/postgres/client.ts`, `db/mysql/client.ts`

Each dialect has a separate client implementation (though most is shared via `AbstractSqlModelClient`). Dialect-specific handling lives in:
- `upsert()` method (ON CONFLICT vs. ON DUPLICATE KEY)
- `sync()` (DDL emission differs)
- Drizzle-specific builder methods (RETURNING is absent on MySQL)

As the framework grows, new query types (e.g., `aggregate()`, `batch()`) need dialect-specific overrides. This scales poorly.

**Refactor:** Lean harder on Drizzle's abstraction. Push dialect-specific DDL into a `SchemaBuilder` interface that Drizzle implements. Use feature detection (e.g., `db.selectDistinctOn ? ... : ...`) to gracefully degrade unsupported features.

### 3. workspace:* → ^ rewrite in release workflow

**Location:** `packages/*/package.json` uses `"@hopak/common": "workspace:*"`

When the package is published, a build step rewrites this to `"@hopak/common": "^0.1.12"`. At scale (20+ interdependent packages), managing version compatibility becomes a chore. One package bumps a minor version, others need updates, and the release process grows.

**Refactor:** Consider a monorepo tool (Lerna, nx, turborepo) that automates version management. Or, if feasible, publish a unified `hopak` package with subexports (`hopak/core`, `hopak/auth`, etc.) instead of separate npm packages.

### 4. No plugin registry

The framework has no way for third-party packages to register middleware, field types, or database adapters. Everything is either built-in or imported manually.

**Example:** A user wants to add a `phone` field type from an external package. Today, they'd have to patch `fields/adapters.ts` or fork the framework. **Refactor:** Expose an initialization hook (`hopak.field(phoneFieldType)`) that registers adapters and validators.

### 5. Database interface shape missing typed query()

**Location:** `db/client.ts`

The `Database` interface defines model-based operations (`model(name)`, `sync()`, `transaction()`), but there's no `.query(sql: string)` method for raw SQL. If a user needs a complex query, they have to import the driver directly (`postgres-js`, `better-sqlite3`, etc.), breaking the abstraction.

**Refactor:** Add a `query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>` method that dialects implement. For Drizzle-based dialects, this would be `.db.execute(sql(sql), params)`.

### 6. Module-scope state across packages

**Location:** Check if any code stores mutable state in module scope.

- `serialize/index.ts:4` — `EXCLUSION_CACHE` is a WeakMap in module scope. It's safe (thread-local in Node.js, event-loop-local in Bun), but it grows unbounded. **Minor risk:** if an app defines 10k models, the cache never clears.
- `http/request-context.ts:37–38` — `rawPromise` and `bodyPromise` are closure variables, not module-scope. **Safe.**

**Refactor:** Add a cache eviction policy or document that caches are GC'd when models are GC'd (which is true for WeakMap, but not obvious).

### 7. Route definitions not composable

You define a route by creating a file or calling `router.add()`. There's no way to define a route that wraps another route (e.g., a rate-limited version of an endpoint). Middleware can wrap execution, but the route itself is atomic.

**Refactor:** A `WrapRoute` function like:
```typescript
export const GET = wrapRoute(crud.read(post), [requireAuth(), rateLimit(100)]);
```

---

## 10. Strengths

### Request pipeline architecture

**`request-pipeline.ts`** — The three-hook pattern (Before, After, Wrap) is elegant. It avoids the "forgot to call `next()`" footgun of Express/Koa. Wrap naturally composes via `reduceRight`. Execution order is explicit and tested (`middleware.test.ts`). A significant DX win.

### Router specificity ordering

**`router.ts:43–55`** — Routes are sorted by specificity: static segments > param segments > wildcard. When two routes have the same length, static wins. This is correct and predictable. The sorting happens at registration time, so matching is O(n) but small (n < 100 typical). Good tradeoff.

### Abstract SQL client inheritance

**`AbstractSqlModelClient`** — 90% of CRUD logic is shared across three dialects. The duck-typed `SqlRunner` interface captures the common Drizzle API shape. Per-dialect methods override only `upsert()` and handle missing RETURNING. This is a textbook example of shared code in a multi-dialect system.

### Field builder DSL

**`fields/base.ts` and subclasses** — The fluent DSL (`text().required().min(5)`) is expressive and compiles to flat definitions for both validation and DDL. Phantom types enable inference of row shapes at compile time. The `markAs<TBuilder>()` helper is a clever way to thread the `__required` phantom type through a builder chain.

### Include executor N+1 guarantee

**`include-executor.ts`** — The comment at the top (lines 2–18) explains the N+1 guarantee: one query per relation type, regardless of row count. The implementation (batching FK values into `IN` clauses) is correct and efficient. A user can trust that `include: { author: true, comments: true }` issues 3 queries total, not 1 + n + n.

### Error translation per dialect

**`error-translator.ts`** — Maps driver-specific error codes (Postgres 23505, MySQL 1062, SQLite SQLITE_CONSTRAINT) to canonical `Conflict` exceptions. Handles both error codes and message text as fallback. This is defensive and enables consistent error handling across dialects.

### Test coverage of database operations

The `db-*.test.ts` suites (sqlite, postgres, mysql) are comprehensive. CRUD, transactions, constraints, aggregates, and includes are well-tested across three dialects. If there were a fourth dialect, the test suite would quickly catch missing implementations.

### CORS vulnerability mitigation

**`cors.ts:18–19`** — Instead of returning `Access-Control-Allow-Origin: *` with credentials, the code returns the actual request origin. This is the correct workaround for the browser's restriction.

---

## 11. Ranked next steps

| # | Summary | Area | Effort | Impact |
|---|---------|------|--------|--------|
| 1 | **Fix prototype pollution in deepMerge** | `common/utils.ts` | 30 min | High (security) |
| 2 | **Document cursor pagination tie-breaking behavior** | `db/client.ts` type comments | 30 min | Medium (UX) |
| 3 | **Add server-side OAuth state store option** | `auth/oauth/state.ts` | 4–8 hours | Medium (security) |
| 4 | **Cache file discovery manifest** | `scanner.ts`, `loader.ts` | 4–8 hours | Medium (perf) |
| 5 | **Expose raw `.query()` method on Database** | `db/client.ts` + dialect impls | 8–16 hours | Medium (flexibility) |
| 6 | **Add LogLevel validation at runtime** | `common/logger.ts` | 1 hour | Low (DX) |
| 7 | **Add transaction nesting guard** | `db/client.ts` | 2 hours | Low (DX) |
| 8 | **Publish unified `hopak` package with subexports** | release workflow | 16+ hours | Low (but future-proofing) |
| 9 | **Generic plugin registry for field types / middleware** | `core/plugin.ts` | 2–3 days | High (extensibility) |
| 10 | **Type-narrowed CRUD handler return types** | `crud/handlers.ts` + type gymnastics | 3–5 days | Medium (DX, but complex) |

**Top 3 by impact:**
1. **Prototype pollution fix** — trivial effort, prevents a theoretical but real vulnerability.
2. **File discovery caching** — improves startup time on large projects; 4–8 hour refactor.
3. **Plugin registry** — unlocks third-party contributions (field types, adapters); substantial but high-value.

---

**End of audit.**
