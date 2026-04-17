# @hopak/common

Shared primitives for [Hopak.js](https://github.com/hopakjs/hopak) — error hierarchy, logger, HTTP status codes, filesystem helpers, common types.

This package is a dependency of `@hopak/core`. Install it directly only if you're building your own Hopak integration.

## Install

```bash
bun add @hopak/common
```

## What's inside

- `HopakError` hierarchy (`NotFound`, `Forbidden`, `Unauthorized`, `Conflict`, `ValidationError`, ...)
- `Logger` interface + `ConsoleLogger` implementation
- `HttpStatus` constants
- `pathExists`, `isFile`, `isDirectory` helpers
- `slugify`, `pluralize`, `parseDuration`, `deepMerge` utilities
- Shared config types (`HopakConfig`, `HopakConfigInput`, `DbDialect`)

## Docs

Full framework docs: https://github.com/hopakjs/hopak

## License

MIT
