# @hopak/common

[![npm](https://img.shields.io/npm/v/@hopak/common.svg)](https://www.npmjs.com/package/@hopak/common)
[![license](https://img.shields.io/npm/l/@hopak/common.svg)](https://github.com/hopakjs/hopak/blob/main/LICENSE)

Shared primitives for [Hopak.js](https://github.com/hopakjs/hopak) — the error hierarchy, logger, HTTP status codes, filesystem helpers, utilities, and config types. Used by every other `@hopak/*` package.

> **You probably don't need to install this directly.** `@hopak/core` already depends on `@hopak/common` and re-exports its entire public surface. Install this package only when building your own Hopak plug-in or extension.

## Contents

- [Install](#install)
- [Errors](#errors)
- [Logger](#logger)
- [HTTP status codes](#http-status-codes)
- [Filesystem helpers](#filesystem-helpers)
- [Utilities](#utilities)
- [Config types](#config-types)
- [Related packages](#related-packages)

---

## Install

```bash
bun add @hopak/common
```

Everything exported here is also available from `@hopak/core`:

```ts
// equivalent imports
import { HopakError, NotFound, HttpStatus, createLogger } from '@hopak/core';
import { HopakError, NotFound, HttpStatus, createLogger } from '@hopak/common';
```

## Errors

All framework errors extend `HopakError`. Throwing one inside a route handler produces a structured JSON response with the correct status code.

### Hierarchy

```ts
import {
  HopakError,         // base — status 500
  ValidationError,    // 400
  Unauthorized,       // 401
  Forbidden,          // 403
  NotFound,           // 404
  Conflict,           // 409
  RateLimited,        // 429
  InternalError,      // 500
  ConfigError,        // 500 — config-layer problems
} from '@hopak/common';
```

### Shape

Every `HopakError` has:

- `status: number` — HTTP status code
- `code: string` — machine-readable error code (e.g. `"NOT_FOUND"`)
- `message: string` — human-readable message
- `details?: unknown` — optional payload (used by `ValidationError` for field errors)
- `toJSON()` — the response body

### Usage

```ts
throw new NotFound('Post not found');
// → 404 { "error": "NOT_FOUND", "message": "Post not found" }

throw new ValidationError('Invalid body', { email: ['Required'] });
// → 400 { "error": "VALIDATION_ERROR", "message": "Invalid body",
//          "details": { "email": ["Required"] } }
```

### Custom errors

Subclass `HopakError`, set `status` and `code`:

```ts
class PaymentFailed extends HopakError {
  override readonly status = 402;
  override readonly code = 'PAYMENT_FAILED';
}
throw new PaymentFailed('Insufficient funds');
```

## Logger

### Interface

```ts
export interface Logger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
  child(bindings: LogMeta): Logger;
}
```

`LogMeta` is `Record<string, unknown> | object` — any plain object works.

### `ConsoleLogger`

The bundled implementation writes JSON-tagged lines to `stdout` (or `stderr` for errors). Colour and timestamp included.

```ts
import { createLogger } from '@hopak/common';

const log = createLogger({ level: 'debug' });

log.info('server up', { port: 3000 });
log.error('DB connection failed', { cause: 'ECONNREFUSED' });
```

### Child loggers

Pre-bind context on an existing logger:

```ts
const reqLog = log.child({ requestId: '123' });
reqLog.info('handler called');
// → [2026-...] INFO handler called {"requestId":"123"}
```

### Plugging your own logger in

`Logger` is a plain interface — anything that satisfies it works. Pipe to pino, winston, or a custom transport.

## HTTP status codes

```ts
import { HttpStatus } from '@hopak/common';

HttpStatus.Ok;                    // 200
HttpStatus.Created;               // 201
HttpStatus.NoContent;             // 204
HttpStatus.BadRequest;            // 400
HttpStatus.Unauthorized;          // 401
HttpStatus.Forbidden;             // 403
HttpStatus.NotFound;              // 404
HttpStatus.MethodNotAllowed;      // 405
HttpStatus.Conflict;              // 409
HttpStatus.TooManyRequests;       // 429
HttpStatus.InternalServerError;   // 500
```

Exported as a `const` object plus a matching union type — use the object for values, the type as the annotation:

```ts
import { HttpStatus } from '@hopak/common';

function respond(status: HttpStatus) { /* ... */ }
respond(HttpStatus.Created);
```

## Filesystem helpers

Async wrappers around `node:fs/promises` that return `false` instead of throwing when the path is missing.

```ts
import { pathExists, isFile, isDirectory } from '@hopak/common';

await pathExists('./hopak.config.ts');    // true | false
await isFile('./README.md');              // true only if a regular file
await isDirectory('./app/models');        // true only if a directory
```

## Utilities

### `slugify(input)`

```ts
slugify('Hello, World!')   // 'hello-world'
slugify('Привіт світ')     // '' (ASCII-only; non-latin input yields empty)
```

Lowercases, trims, strips non-word characters, collapses whitespace to `-`.

### `pluralize(word)`

Simple English pluraliser used by auto-CRUD to form URL segments:

```ts
pluralize('post')    // 'posts'
pluralize('story')   // 'stories'
pluralize('box')     // 'boxes'
```

### `parseDuration(input)`

Parses `"100ms"`, `"5s"`, `"10m"`, `"1h"`, `"7d"` into milliseconds:

```ts
parseDuration('5s')     // 5000
parseDuration('2h')     // 7200000
```

Throws on unknown units or malformed input.

### `deepMerge(target, source)`

Recursively merges plain objects. Arrays and primitives in `source` replace those in `target`. `undefined` in `source` is ignored. Used by the config layer to apply user overrides on top of defaults.

```ts
deepMerge({ a: { x: 1, y: 2 } }, { a: { y: 20, z: 30 } });
// { a: { x: 1, y: 20, z: 30 } }
```

## Config types

```ts
import type {
  HopakConfig,
  HopakConfigInput,
  HopakPaths,
  ServerOptions,
  HttpsOptions,
  DatabaseOptions,
  CorsOptions,
  DbDialect,
  RuntimeContext,
  DeepPartial,
} from '@hopak/common';
```

- `HopakConfig` — fully-resolved config object (what the framework sees at runtime)
- `HopakConfigInput` — `DeepPartial<HopakConfig>`; the shape you pass to `defineConfig({...})`
- `HopakPaths` — resolved `models` / `routes` / `jobs` / `public` / `migrations` / `hopakDir` directories
- `ServerOptions` — `{ port, host, https? }`
- `HttpsOptions` — `{ enabled, port?, cert?, key? }`
- `DatabaseOptions` — `{ dialect, url?, file? }`
- `CorsOptions` — `{ origins, credentials? }`
- `DbDialect` — `'sqlite' | 'postgres' | 'mysql'`
- `RuntimeContext` — `{ log, config }`; useful when writing plug-ins
- `DeepPartial<T>` — recursive `Partial`

## Related packages

- [`@hopak/core`](https://www.npmjs.com/package/@hopak/core) — framework (re-exports everything here)
- [`@hopak/cli`](https://www.npmjs.com/package/@hopak/cli) — command-line
- [`@hopak/testing`](https://www.npmjs.com/package/@hopak/testing) — test helpers

Full framework documentation: https://github.com/hopakjs/hopak

## License

MIT.
