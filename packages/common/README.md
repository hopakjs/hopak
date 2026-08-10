<p align="center">
  <img alt="Hopak.js — Backend framework" src="https://raw.githubusercontent.com/hopakjs/hopak/main/.github/assets/npm_both.png" width="460">
</p>

# @hopak/common

[![npm](https://img.shields.io/npm/v/@hopak/common.svg)](https://www.npmjs.com/package/@hopak/common)
[![license](https://img.shields.io/npm/l/@hopak/common.svg)](https://github.com/hopakjs/hopak/blob/main/LICENSE)

Shared primitives for [Hopak.js](https://hopak.dev) — errors, logger, config types. Zero runtime dependencies.

```bash
bun add @hopak/common
```

**📖 Docs: [hopak.dev/docs/packages/common](https://hopak.dev/docs/packages/common)**

You rarely install this directly — [`@hopak/core`](https://www.npmjs.com/package/@hopak/core) re-exports all of it.

## Errors

Every error carries an HTTP status and a code, and the framework's error handler serialises it to `{ error, message, details }`:

```ts
import { NotFound, Forbidden, ValidationError } from '@hopak/common';

throw new NotFound('post not found');        // → 404 NOT_FOUND
throw new Forbidden('not your post');        // → 403 FORBIDDEN
throw new ValidationError('bad input', {});  // → 400 VALIDATION_ERROR
```

Also `HopakError` (base), `Unauthorized`, `Conflict`, `RateLimited`, `InternalError`, `ConfigError`, `PluginError`.

## Logger

```ts
import { createLogger } from '@hopak/common';

const log = createLogger({ level: 'debug' });
log.info('started', { port: 3000 });
log.child({ requestId }).warn('slow query');
```

## Also included

`HopakConfig` and friends (the shape of `hopak.config.ts`), `HttpStatus` constants, and small helpers: `slugify`, `pluralize`, `parseDuration`, `deepMerge` (which drops `__proto__` / `constructor` / `prototype` keys), `pathExists`, `isFile`, `isDirectory`.

## Requirements

Bun ≥ 1.3.

## Author

**Volodymyr Press** · [vladimpress@gmail.com](mailto:vladimpress@gmail.com)

## License

MIT.
