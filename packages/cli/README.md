# @hopak/cli

[![npm](https://img.shields.io/npm/v/@hopak/cli.svg)](https://www.npmjs.com/package/@hopak/cli)
[![license](https://img.shields.io/npm/l/@hopak/cli.svg)](https://github.com/hopakjs/hopak/blob/main/LICENSE)

Command-line interface for [Hopak.js](https://github.com/hopakjs/hopak) — scaffolds projects, runs the dev server, generates models and routes, migrates the database, and audits project state.

## Contents

- [Install](#install)
- [Commands](#commands)
  - [hopak new](#hopak-new-name)
  - [hopak dev](#hopak-dev)
  - [hopak generate](#hopak-generate-kind-name)
  - [hopak migrate](#hopak-migrate)
  - [hopak check](#hopak-check)
  - [hopak --version / --help](#hopak---version----help)
- [Project structure](#project-structure)
- [Custom project paths](#custom-project-paths)
- [Integration with package.json scripts](#integration-with-packagejson-scripts)
- [Related packages](#related-packages)

---

## Install

### Globally (recommended)

```bash
bun add -g @hopak/cli
```

You get a `hopak` binary on your `$PATH`. Use this for the `hopak new <name>` flow and any ad-hoc command.

### As a dev dependency

```bash
bun add -d @hopak/cli
```

Call via `bun x hopak <cmd>` or through `package.json` scripts. Pins the CLI version with your project — good for teams and CI.

## Commands

### `hopak new <name>`

Scaffolds a new Hopak project in `./<name>/`. The directory must not exist.

```bash
hopak new my-app
```

Generates:

```
my-app/
├── app/
│   ├── models/post.ts      # example model with { crud: true }
│   └── routes/index.ts     # example route at GET /
├── public/                 # for static files
├── hopak.config.ts         # minimal config (HTTPS commented out)
├── main.ts                 # import { hopak }; await hopak().listen()
├── tsconfig.json
├── package.json            # depends on @hopak/core, devDepends on @hopak/cli
├── .gitignore
├── .env.example
└── README.md
```

Next steps are printed to the log:

```bash
cd my-app
bun install
hopak dev
```

### `hopak dev`

Runs the project with Bun's `--hot` mode. Starts `main.ts` as a child process with stdio forwarded; hot-reloads source changes automatically.

```bash
hopak dev
```

Under the hood this is a thin wrapper around:

```bash
bun --hot run main.ts
```

Pass `--entry <file>` (reserved for the future) to change the entry point. For now it defaults to `main.ts`.

On start you see:

```
  Hopak.js v0.0.6
  ↳ Listening on http://localhost:3000
  ↳ Database: sqlite
```

Press `Ctrl-C` to stop.

### `hopak generate <kind> <name>`

Scaffolds a new model or route file from a template. Aliased as `hopak g`.

#### `hopak generate model <name>`

```bash
hopak generate model comment
```

Creates `app/models/comment.ts`:

```ts
import { model, text } from '@hopak/core';

export default model(
  'comment',
  {
    name: text().required(),
  },
  { crud: true },
);
```

Edit the fields to match your domain.

#### `hopak generate route <path>`

```bash
hopak generate route search
hopak generate route posts/[id]/publish
```

Creates the file at the given path under `app/routes/`. The template exports a `GET` handler:

```ts
import { defineRoute } from '@hopak/core';

export const GET = defineRoute({
  handler: (ctx) => ({ ok: true, path: ctx.path }),
});
```

Rename the export to `POST`/`PUT`/`PATCH`/`DELETE` for other methods; multiple methods can live in one file.

Leading `/` and trailing `.ts` in the `<path>` argument are stripped automatically, so `/posts/new.ts` and `posts/new` both produce `app/routes/posts/new.ts`.

#### Refusal policy

`hopak generate` never overwrites an existing file. If the target already exists the command fails with exit code `1`.

### `hopak migrate`

Synchronises the database schema with registered models. For SQLite this runs `CREATE TABLE IF NOT EXISTS` for every model and creates the database file if needed. Safe to run repeatedly.

```bash
hopak migrate
```

Output:

```
Applying schema to database {"cwd":"/.../my-app"}
Schema synchronized {"models":3,"dialect":"sqlite"}
```

### `hopak check`

Audits project state without starting a server. Prints a coloured report of what Hopak will see at boot time: config, database location, models scanned, routes discovered, auto-CRUD endpoint count, and the static directory.

```bash
hopak check
```

```
  ✓ Config  hopak.config.ts loaded
  ✓ Database  sqlite (/.../my-app/.hopak/data.db)
  ✓ Models  3 loaded (comment, user, post)
  ✓ Routes  2 file route(s)
  ✓ Auto-CRUD  3 model(s) with crud:true → 18 endpoint(s)
  ✓ Static  serving public/
```

Exits with `1` if scanning any model or route file failed — use this in CI to catch broken scaffolds.

### `hopak --version` / `--help`

```bash
hopak --version   # prints package version
hopak -v

hopak --help      # prints command overview
hopak -h
hopak             # (no args — same as --help)
```

## Project structure

The CLI relies on the default Hopak layout unless you override paths:

```
my-app/
├── app/
│   ├── models/       # hopak generate model <name> writes here
│   └── routes/       # hopak generate route <path> writes here
├── public/           # served as static files
├── hopak.config.ts   # optional
└── main.ts           # entry point executed by hopak dev
```

`hopak migrate`, `hopak check`, and `hopak dev` all read `hopak.config.ts` to locate these directories.

## Custom project paths

Override source directories in `hopak.config.ts`:

```ts
import { defineConfig } from '@hopak/core';

export default defineConfig({
  paths: {
    models: 'src/domain',
    routes: 'src/api',
    public: 'static',
  },
});
```

After this, `hopak generate model post` writes to `src/domain/post.ts`, and `hopak dev` / `hopak check` look in the new locations.

## Integration with package.json scripts

A scaffolded project comes with:

```json
{
  "scripts": {
    "dev": "hopak dev",
    "start": "bun run main.ts"
  }
}
```

Typical extensions:

```json
{
  "scripts": {
    "dev": "hopak dev",
    "start": "bun run main.ts",
    "migrate": "hopak migrate",
    "check": "hopak check",
    "test": "bun test"
  }
}
```

When `@hopak/cli` is listed as a `devDependency`, `bun run dev` invokes the local binary — no global install needed on that machine.

## Related packages

- [`@hopak/core`](https://www.npmjs.com/package/@hopak/core) — the framework itself (models, routing, database, HTTP server)
- [`@hopak/testing`](https://www.npmjs.com/package/@hopak/testing) — test helpers
- [`@hopak/common`](https://www.npmjs.com/package/@hopak/common) — shared primitives (transitive)

Full framework documentation: https://github.com/hopakjs/hopak

## License

MIT.

## Author

**Volodymyr Press** · [vladimpress@gmail.com](mailto:vladimpress@gmail.com) · [github.com/hopakjs](https://github.com/hopakjs)
