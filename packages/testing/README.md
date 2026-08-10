<p align="center">
  <img alt="Hopak.js — Backend framework" src="https://raw.githubusercontent.com/hopakjs/hopak/main/.github/assets/npm_both.png" width="460">
</p>

# @hopak/testing

[![npm](https://img.shields.io/npm/v/@hopak/testing.svg)](https://www.npmjs.com/package/@hopak/testing)
[![license](https://img.shields.io/npm/l/@hopak/testing.svg)](https://github.com/hopakjs/hopak/blob/main/LICENSE)

Test helpers for [Hopak.js](https://hopak.dev) — an in-process server on an ephemeral port, plus a JSON client.

```bash
bun add -d @hopak/testing
```

**📖 Docs: [hopak.dev/docs/packages/testing](https://hopak.dev/docs/packages/testing)**

## Boot your real project

```ts
import { expect, test } from 'bun:test';
import { createTestServer } from '@hopak/testing';

test('lists posts', async () => {
  const env = await createTestServer({ rootDir: '.' });
  try {
    const res = await env.client.get<{ total: number }>('/api/posts');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  } finally {
    await env.stop();
  }
});
```

`rootDir` scans models and route files exactly like `hopak dev` does. Pass `plugins: [...]` when the app registers custom field types.

## Or assemble one in memory

```ts
const env = await createTestServer({ models: [post], router });
await env.requireDb().model('post').create({ title: 'seed', content: '…' });
```

Models sync to an ephemeral SQLite database; `env.requireDb()` returns it for seeding and assertions.

## Also included

- `createJsonClient(baseUrl)` — `get` / `post` / `put` / `patch` / `delete`, each returning `{ status, body, headers, raw }`.
- `getPostgresUrl()`, `getMysqlUrl()`, `resetPostgres(url, tables)`, `resetMysql(url, tables)` — for integration suites that run against real databases.

## Requirements

Bun ≥ 1.3. `@hopak/core` and `@hopak/common` are peer dependencies, so your project's copy is the one under test.

## Author

**Volodymyr Press** · [vladimpress@gmail.com](mailto:vladimpress@gmail.com)

## License

MIT.
