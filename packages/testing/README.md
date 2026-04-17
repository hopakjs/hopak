# @hopak/testing

Test helpers for [Hopak.js](https://github.com/hopakjs/hopak) — a test server on a random port and a typed JSON client.

## Install

```bash
bun add -d @hopak/testing
```

## Example

```ts
import { test, expect } from 'bun:test';
import { createTestServer } from '@hopak/testing';
import postModel from './app/models/post';

test('POST /api/posts creates a row', async () => {
  const env = await createTestServer({ models: [postModel], withCrud: true });

  const res = await env.client.post('/api/posts', {
    title: 'Hello',
    content: 'Hopak',
  });

  expect(res.status).toBe(201);
  await env.stop();
});
```

## API

- `createTestServer(options)` — spins up a Hopak server on a random port
- `createJsonClient(baseUrl)` — typed `fetch` wrapper with `get/post/put/patch/delete`

## Docs

Full framework docs: https://github.com/hopakjs/hopak

## License

MIT
