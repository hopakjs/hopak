<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/hopakjs/hopak/main/.github/assets/npm_white.png">
    <img alt="Hopak.js — Backend framework" src="https://raw.githubusercontent.com/hopakjs/hopak/main/.github/assets/npm_black.png" width="520">
  </picture>
</p>

# @hopak/testing

[![npm](https://img.shields.io/npm/v/@hopak/testing.svg)](https://www.npmjs.com/package/@hopak/testing)
[![license](https://img.shields.io/npm/l/@hopak/testing.svg)](https://github.com/hopakjs/hopak/blob/main/LICENSE)

Test helpers for [Hopak.js](https://github.com/hopakjs/hopak). Spins
up real in-process servers on random ports and gives you a typed
`fetch` client — no mocks, no manual setup.

## Contents

- [Install](#install)
- [Quick example](#quick-example)
- [`createTestServer`](#createtestserver)
- [`JsonClient`](#jsonclient)
- [Patterns](#patterns)
- [Related packages](#related-packages)

---

## Install

```bash
bun add -d @hopak/testing
```

Written for `bun:test`, but `createTestServer` is framework-agnostic
— you can use it under Vitest, Jest, or Node's built-in test runner.

## Quick example

```ts
import { afterEach, expect, test } from 'bun:test';
import { Router, crud, model, text, boolean } from '@hopak/core';
import { createTestServer, type TestServer } from '@hopak/testing';

const post = model('post', {
  title: text().required().min(3),
  published: boolean().default(false),
});

let env: TestServer | undefined;

afterEach(async () => {
  await env?.stop();
  env = undefined;
});

test('POST /api/posts creates a row', async () => {
  // Wire up CRUD explicitly — nothing auto-registers.
  const router = new Router();
  router.add('GET', '/api/posts', crud.list(post));
  router.add('POST', '/api/posts', crud.create(post));

  env = await createTestServer({ models: [post], router });

  const res = await env.client.post<{ id: number; title: string }>('/api/posts', {
    title: 'Hello',
  });

  expect(res.status).toBe(201);
  expect(res.body.title).toBe('Hello');
});
```

No HTTP server configuration, no free-port bookkeeping — the test
picks a random port (`port: 0`), tears down in `afterEach`, and the
in-memory SQLite database lives only for the test.

## `createTestServer`

Starts a real Hopak HTTP server for the test. Two modes:

### Mode 1: point at a project `rootDir`

Boots exactly like `hopak dev` — scans `app/models/`, loads file
routes from `app/routes/`. Use this for integration tests that
exercise real scaffolded route files.

```ts
const env = await createTestServer({ rootDir: process.cwd() });
```

> **Migrations + `rootDir`.** When the target project has
> `app/migrations/`, `createApp` skips `db.sync()` at boot just like
> `hopak dev` does. Your test suite is then responsible for bringing
> the schema up — either run `hopak migrate up` against the test DB
> before the suite, or call the runner directly:
>
> ```ts
> import { applyUp, loadMigrations } from '@hopak/core';
>
> const env = await createTestServer({ rootDir });
> const { migrations } = await loadMigrations(`${rootDir}/app/migrations`);
> await applyUp({ db: env.requireDb(), dialect: 'sqlite' }, migrations);
> ```
>
> Mode 2 (`models`) keeps its straightforward `db.sync()` behavior —
> perfect for unit tests that don't care about the committed schema
> history.

### Mode 2: in-memory `models` + `router`

For unit-ish tests where you wire a small router by hand.

```ts
const env = await createTestServer({
  models: [post],
  router: preBuiltRouter,
});
```

### Signature

```ts
interface TestServerOptions {
  rootDir?: string;                      // scan a full project (mutually exclusive with models/router)
  models?: readonly ModelDefinition[];   // in-memory SQLite opens + syncs
  router?: Router;                       // pre-populated with routes
  middleware?: Middleware;               // global before/after/wrap for every request
  log?: Logger;                          // override logger — useful for capturing output
  staticDir?: string;                    // path to a public/ directory
  exposeStack?: boolean;                 // include stack traces in 500 responses
}

interface TestServer {
  readonly url: string;                  // e.g. 'http://localhost:53248'
  readonly router: Router;               // add more routes after start
  readonly db: Database | null;          // null when no models were passed
  readonly client: JsonClient;           // fetch wrapper — see below
  readonly server: ListeningServer;      // raw handle (port, stop, etc.)
  requireDb(): Database;                 // throws if models weren't passed
  stop(): Promise<void>;                 // closes server + DB
}

declare function createTestServer(options?: TestServerOptions): Promise<TestServer>;
```

### Options

- **`rootDir`** — boot a full project from disk. Scans models + file routes using the same pipeline as `hopak dev`. Mutually exclusive with `models` / `router` (the constructor throws if you pass both).
- **`models`** — array of `ModelDefinition`s. When provided, an in-memory SQLite database is opened and `db.sync()` runs so you can call `env.db.model('post').create(...)` inside tests.
- **`router`** — use your own `Router` (pre-registered with routes via `crud.*` or `defineRoute`) instead of the default empty one.
- **`middleware`** — `{ before, after, wrap }` applied to every request, same shape as `hopak().before(...).after(...).wrap(...)` in production. Test global middleware (request-log, auth) in isolation:
  ```ts
  import { requestLog } from '@hopak/core';
  env = await createTestServer({
    router,
    middleware: { before: [], after: [requestLog()], wrap: [] },
  });
  ```
- **`log`** — swap the logger to capture output. Pair with a stub logger in tests that assert on log lines (see `@hopak/core` request-log tests for an example).
- **`staticDir`** — directory to serve under the root (for static-file tests).
- **`exposeStack: true`** — include the stack trace in 500 responses. Handy when debugging a test that triggered a server-side error.

### Teardown

Always call `env.stop()` in `afterEach` (or a `try/finally`). It
closes the HTTP listener and the database.

## `JsonClient`

`env.client` is a minimal typed fetch wrapper. Every method returns
a `JsonResponse<T>`:

```ts
interface JsonResponse<T = unknown> {
  status: number;
  body: T;              // parsed JSON, or raw text if non-JSON
  headers: Headers;
  raw: Response;        // original fetch Response
}

interface JsonClient {
  get<T>(path: string, init?: RequestInit): Promise<JsonResponse<T>>;
  post<T>(path: string, body?: unknown): Promise<JsonResponse<T>>;
  put<T>(path: string, body?: unknown): Promise<JsonResponse<T>>;
  patch<T>(path: string, body?: unknown): Promise<JsonResponse<T>>;
  delete<T>(path: string): Promise<JsonResponse<T>>;
}
```

- `post`/`put`/`patch` set `content-type: application/json` and `JSON.stringify` the body.
- `get` accepts an optional second `RequestInit` if you need custom headers.
- Works over `http` **or** `https` URLs — the client follows whatever `env.url` returns.

### Standalone usage

`createJsonClient(baseUrl)` is also exported if you need the client
without `createTestServer`:

```ts
import { createJsonClient } from '@hopak/testing';

const client = createJsonClient('http://localhost:3000');
const res = await client.get('/health');
```

## Patterns

### End-to-end via `rootDir` (recommended for integration tests)

```ts
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createTestServer, type TestServer } from '@hopak/testing';

let env: TestServer;

beforeAll(async () => {
  env = await createTestServer({ rootDir: process.cwd() });
});
afterAll(() => env.stop());

test('auto-CRUD from scaffolded files works', async () => {
  const created = await env.client.post('/api/posts', { title: 'seed', content: 'x' });
  expect(created.status).toBe(201);
});
```

Uses whatever `hopak generate crud` wrote. Zero test-specific routing
code — you're testing the files the runtime actually serves.

### Sensitive fields are stripped in responses (top-level + include)

```ts
import { crud, Router, email, model, password, text } from '@hopak/core';

const user = model('user', {
  email: email().required().unique(),
  password: password().required().min(8),
});

test('password is never returned', async () => {
  const router = new Router();
  router.add('POST', '/api/users', crud.create(user));

  const env = await createTestServer({ models: [user], router });
  try {
    const res = await env.client.post<Record<string, unknown>>('/api/users', {
      email: 'a@b.com',
      password: 'secret12',
    });
    expect(res.status).toBe(201);
    expect(res.body.password).toBeUndefined();
  } finally {
    await env.stop();
  }
});
```

### Custom routes only, no database

```ts
import { defineRoute, Router } from '@hopak/core';

const router = new Router();
router.add('GET', '/health', defineRoute({ handler: () => ({ ok: true }) }));

const env = await createTestServer({ router });
const res = await env.client.get<{ ok: boolean }>('/health');
expect(res.body.ok).toBe(true);
```

### Using the database directly

```ts
const env = await createTestServer({ models: [post] });

// requireDb() throws if models weren't passed — great for type narrowing
const db = env.requireDb();
await db.model('post').create({ title: 'seed' });
```

### Static files

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'hopak-static-'));
await mkdir(join(dir, 'public'), { recursive: true });
await writeFile(join(dir, 'public', 'hello.txt'), 'hi');

const env = await createTestServer({ staticDir: join(dir, 'public') });
const res = await env.client.get<string>('/hello.txt');
expect(res.body).toBe('hi');
```

### Assertion style

Since `body` is the decoded JSON (or string), you can use standard
`expect` calls directly:

```ts
expect(res.status).toBe(200);
expect(res.body).toEqual({ id: 1, title: 'Hello' });
expect(res.headers.get('etag')).toBeTruthy();
```

For error responses, assert on the typed shape of `HopakError`:

```ts
const res = await env.client.get<{ error: string; message: string }>('/api/posts/9999');
expect(res.status).toBe(404);
expect(res.body.error).toBe('NOT_FOUND');
```

## Related packages

- [`@hopak/core`](https://www.npmjs.com/package/@hopak/core) — the framework
- [`@hopak/cli`](https://www.npmjs.com/package/@hopak/cli) — command-line
- [`@hopak/common`](https://www.npmjs.com/package/@hopak/common) — shared primitives

Full framework documentation: https://github.com/hopakjs/hopak

## License

MIT.

## Author

**Volodymyr Press** · [vladimpress@gmail.com](mailto:vladimpress@gmail.com) · [github.com/hopakjs](https://github.com/hopakjs)
