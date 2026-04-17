# @hopak/testing

[![npm](https://img.shields.io/npm/v/@hopak/testing.svg)](https://www.npmjs.com/package/@hopak/testing)
[![license](https://img.shields.io/npm/l/@hopak/testing.svg)](https://github.com/hopakjs/hopak/blob/main/LICENSE)

Test helpers for [Hopak.js](https://github.com/hopakjs/hopak). Spins up real in-process servers on random ports and gives you a typed `fetch` client — no mocks, no manual setup.

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

Written for `bun:test`, but `createTestServer` is framework-agnostic — you can use it under Vitest, Jest, or Node's built-in test runner.

## Quick example

```ts
import { afterEach, expect, test } from 'bun:test';
import { createTestServer, type TestServer } from '@hopak/testing';
import { model, text, boolean } from '@hopak/core';

const post = model('post', {
  title: text().required().min(3),
  published: boolean().default(false),
}, { crud: true });

let env: TestServer | undefined;

afterEach(async () => {
  await env?.stop();
  env = undefined;
});

test('POST /api/posts creates a row', async () => {
  env = await createTestServer({ models: [post], withCrud: true });

  const res = await env.client.post<{ id: number; title: string }>('/api/posts', {
    title: 'Hello',
  });

  expect(res.status).toBe(201);
  expect(res.body.title).toBe('Hello');
});
```

No HTTP server configuration, no free-port bookkeeping — the test picks a random port (`port: 0`), tears down in `afterEach`, and the in-memory SQLite database lives only for the test.

## `createTestServer`

Starts a real Hopak HTTP server for the test.

### Signature

```ts
interface TestServerOptions {
  models?: readonly ModelDefinition[];   // if set, in-memory SQLite is opened
  router?: Router;                       // pre-populate with custom routes
  withCrud?: boolean;                    // register auto-CRUD for each model
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

- **`models`** — array of `ModelDefinition`s. When provided, an in-memory SQLite database is opened and `db.sync()` runs so you can call `env.db.model('post').create(...)` inside tests.
- **`router`** — use your own `Router` (e.g. pre-registered with file routes) instead of the default empty one.
- **`withCrud: true`** — register auto-CRUD routes for every model. Combine with `models` to test `POST /api/<plural>` etc.
- **`staticDir`** — directory to serve under the root (for static-file tests).
- **`exposeStack: true`** — include the stack trace in 500 responses. Handy when debugging a test that triggered a server-side error.

### Teardown

Always call `env.stop()` in `afterEach` (or a `try/finally`). It closes the HTTP listener and the database.

## `JsonClient`

`env.client` is a minimal typed fetch wrapper. Every method returns a `JsonResponse<T>`:

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

`createJsonClient(baseUrl)` is also exported if you need the client without `createTestServer`:

```ts
import { createJsonClient } from '@hopak/testing';

const client = createJsonClient('http://localhost:3000');
const res = await client.get('/health');
```

## Patterns

### Auto-CRUD end-to-end

```ts
const user = model('user', {
  email: email().required().unique(),
  password: password().required().min(8),
}, { crud: true });

test('password is never returned', async () => {
  const env = await createTestServer({ models: [user], withCrud: true });
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
const router = new Router();
router.add('GET', '/health', defineRoute({ handler: () => ({ ok: true }) }));

const env = await createTestServer({ router });
const res = await env.client.get<{ ok: boolean }>('/health');
expect(res.body.ok).toBe(true);
```

### Using the database directly

```ts
const env = await createTestServer({ models: [post], withCrud: true });

// requireDb() throws if models weren't passed — great for type narrowing
const db = env.requireDb();
await db.model('post').create({ title: 'seed' });

const res = await env.client.get<{ items: unknown[] }>('/api/posts');
expect(res.body.items).toHaveLength(1);
```

### Static files

```ts
import { mkdir, writeFile } from 'node:fs/promises';
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

Since `body` is the decoded JSON (or string), you can use standard `expect` calls directly:

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

- [`@hopak/core`](https://www.npmjs.com/package/@hopak/core) — framework (peer at test time)
- [`@hopak/cli`](https://www.npmjs.com/package/@hopak/cli) — command-line
- [`@hopak/common`](https://www.npmjs.com/package/@hopak/common) — shared primitives

Full framework documentation: https://github.com/hopakjs/hopak

## License

MIT.

## Author

**Volodymyr Press** · [vladimpress@gmail.com](mailto:vladimpress@gmail.com) · [github.com/hopakjs](https://github.com/hopakjs)
