<p align="center">
  <img alt="Hopak.js — Backend framework" src="https://raw.githubusercontent.com/hopakjs/hopak/main/.github/assets/npm_both.png" width="460">
</p>

# @hopak/cli

[![npm](https://img.shields.io/npm/v/@hopak/cli.svg)](https://www.npmjs.com/package/@hopak/cli)
[![license](https://img.shields.io/npm/l/@hopak/cli.svg)](https://github.com/hopakjs/hopak/blob/main/LICENSE)

The operator tool for [Hopak.js](https://hopak.dev).

Hopak is file-first: models, routes, CRUD endpoints, and migrations all live as regular TypeScript on disk. This CLI is the only thing that writes those files. It scaffolds new projects, runs the dev server, generates code from templates, switches database dialects, manages migrations, and audits configuration.

Keeping code generation outside the runtime means there is nothing hidden — whatever is in your repo is exactly what runs.

## Install

```bash
bun add -g @hopak/cli
```

Exposes the `hopak` binary globally. Requires Bun ≥ 1.3. Also available as a project-local dev dependency via `bun add -d @hopak/cli`.

## Documentation

Full command reference, flags, and workflows on the site:

**👉 [hopak.dev/docs/cli](https://hopak.dev/docs/cli)**

- [Quick start](https://hopak.dev/docs/quickstart) — `hopak new` to running server in under a minute
- [Project layout](https://hopak.dev/docs/project-layout) — what the CLI generates
- [Migrations](https://hopak.dev/docs/migrations) — `hopak migrate` workflow
- [Recipes](https://hopak.dev/docs/recipes) — worked examples

## Author

**Volodymyr Press** · [vladimpress@gmail.com](mailto:vladimpress@gmail.com)

## License

MIT.
