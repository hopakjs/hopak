<p align="center">
  <img alt="Hopak.js — Backend framework" src="https://raw.githubusercontent.com/hopakjs/hopak/main/.github/assets/npm_both.png" width="460">
</p>

# @hopak/cli

[![npm](https://img.shields.io/npm/v/@hopak/cli.svg)](https://www.npmjs.com/package/@hopak/cli)
[![license](https://img.shields.io/npm/l/@hopak/cli.svg)](https://github.com/hopakjs/hopak/blob/main/LICENSE)

The operator tool for [Hopak.js](https://hopak.dev) — scaffolds projects, runs the dev server, generates code, manages migrations.

```bash
bun add -g @hopak/cli
hopak new my-app
cd my-app && hopak dev
```

**📖 Docs: [hopak.dev/docs/cli](https://hopak.dev/docs/cli)**

## Commands

| Command | What it does |
|---|---|
| `hopak new <name>` | Scaffold a project. `--db sqlite\|postgres\|mysql`, `--no-install` |
| `hopak dev` | Dev server with hot reload; restarts when you add or remove files under `app/` |
| `hopak generate <kind>` | Scaffold a `model`, `route`, `crud` pair, or a dev HTTPS `cert`. Aliased `hopak g` |
| `hopak sync` | Create missing tables from models. Refuses once `app/migrations/` exists |
| `hopak migrate <sub>` | `init`, `new <name>`, `up`, `down`, `status` |
| `hopak check` | Audit config, models, routes and database without starting a server |
| `hopak openapi` | Print an OpenAPI 3.1 spec. `--out <file>` to write it |
| `hopak use <capability>` | Turn on `sqlite`, `postgres`, `mysql`, `request-log`, or `auth` in an existing project |

`hopak use` edits your files: it rewrites the `database` block in `hopak.config.ts` and patches `main.ts`. It only replaces blocks it recognises as untouched defaults — a block you have tuned yourself is reported as a conflict with a snippet to paste, never silently overwritten.

## Pipe the spec into a client generator

```bash
hopak openapi | bunx openapi-typescript /dev/stdin -o api.d.ts
```

## Requirements

Bun ≥ 1.3.

## Author

**Volodymyr Press** · [vladimpress@gmail.com](mailto:vladimpress@gmail.com)

## License

MIT.
