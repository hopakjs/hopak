<p align="center">
  <img alt="Hopak.js — Backend framework" src="https://raw.githubusercontent.com/hopakjs/hopak/main/.github/assets/npm_both.png" width="460">
</p>

# @hopak/common

[![npm](https://img.shields.io/npm/v/@hopak/common.svg)](https://www.npmjs.com/package/@hopak/common)
[![license](https://img.shields.io/npm/l/@hopak/common.svg)](https://github.com/hopakjs/hopak/blob/main/LICENSE)

Shared primitives for [Hopak.js](https://hopak.dev) — the error hierarchy, logger, HTTP status codes, filesystem helpers, small utilities, and the config type system used by every other `@hopak/*` package.

> Application code usually does not depend on this directly. `@hopak/core` already depends on it and re-exports the public surface (errors, logger, `HttpStatus`). Install this package only when building a plug-in or extension that cannot go through core.

## Install

```bash
bun add @hopak/common
```

Requires Bun ≥ 1.3.

## Documentation

Full API on the site:

**👉 [hopak.dev/docs/packages/common](https://hopak.dev/docs/packages/common)**

- Error hierarchy and `HopakError` shape
- `Logger` interface, `ConsoleLogger`, child loggers
- `HttpStatus` constants
- Filesystem helpers, slug/plural/duration/deep-merge utilities
- Config types (`HopakConfig`, `DatabaseOptions`, `CorsOptions`, …)

## Author

**Volodymyr Press** · [vladimpress@gmail.com](mailto:vladimpress@gmail.com)

## License

MIT.
