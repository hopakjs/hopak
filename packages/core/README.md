# @hopak/core

Core of [Hopak.js](https://github.com/hopakjs/hopak) — the backend framework for Bun. Models, routing, database, validation, auto-CRUD, and the `hopak()` bootstrap.

## Install

```bash
bun add @hopak/core
```

## Quick start

```ts
// main.ts
import { hopak } from '@hopak/core';

await hopak().listen(3000);
```

Then drop a model in `app/models/post.ts`:

```ts
import { model, text, boolean } from '@hopak/core';

export default model(
  'post',
  {
    title: text().required().min(3).max(200),
    content: text().required(),
    published: boolean().default(false),
  },
  { crud: true },
);
```

You get six auto-CRUD endpoints under `/api/posts`, validation, JSON serialization, and TypeScript types.

## Docs

Full framework docs: https://github.com/hopakjs/hopak

## Related

- [`@hopak/cli`](https://www.npmjs.com/package/@hopak/cli) — project scaffolding and dev server
- [`@hopak/testing`](https://www.npmjs.com/package/@hopak/testing) — test helpers

## License

MIT
