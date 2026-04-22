<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/hopakjs/hopak/main/.github/assets/npm_black.png">
    <img alt="Hopak.js — Backend framework" src="https://raw.githubusercontent.com/hopakjs/hopak/main/.github/assets/npm_white.png" width="520">
  </picture>
</p>

# @hopak/cli

[![npm](https://img.shields.io/npm/v/@hopak/cli.svg)](https://www.npmjs.com/package/@hopak/cli)
[![license](https://img.shields.io/npm/l/@hopak/cli.svg)](https://github.com/hopakjs/hopak/blob/main/LICENSE)

Command-line interface for [Hopak.js](https://github.com/hopakjs/hopak) —
scaffolds projects, runs the dev server, generates models / routes / CRUD /
dev certs, switches database dialects, syncs schema, and audits project state.

Everything the framework serves at runtime is a file on disk. The CLI is the
only thing that writes those files — there are no config flags that cause
runtime to materialize code or crypto on your behalf.

## Contents

- [Install](#install)
- [Commands](#commands)
  - [hopak new](#hopak-new-name)
  - [hopak dev](#hopak-dev)
  - [hopak generate](#hopak-generate-kind-name)
  - [hopak use](#hopak-use-capability)
  - [hopak sync](#hopak-sync)
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

You get a `hopak` binary on your `$PATH`. Use this for the
`hopak new <name>` flow and any ad-hoc command.

### As a dev dependency

```bash
bun add -d @hopak/cli
```

Call via `bunx hopak <cmd>` or through `package.json` scripts. Pins
the CLI version with your project — good for teams and CI.

## Commands

### `hopak new <name>`

Scaffolds a new Hopak project in `./<name>/`. The directory must not
exist. By **default the dialect is SQLite** — zero-install, works
offline, file stored at `.hopak/data.db`. Pick a different DB up
front with `--db`:

```bash
hopak new my-app                   # SQLite (default)
hopak new my-app --db postgres     # Postgres — installs `postgres` driver
hopak new my-app --db mysql        # MySQL — installs `mysql2` driver
hopak new my-app --db sqlite       # explicit opt-in (same as default)
```

Flags:

| Flag | Effect |
|---|---|
| `--db <sqlite\|postgres\|mysql>` | Preconfigures `hopak.config.ts`, adds the driver to `package.json`, seeds `.env.example` with a `DATABASE_URL` placeholder. |
| `--no-install` | Skips `bun install` — useful for CI or offline setups. |

Generates (SQLite default):

```
my-app/
├── app/
│   ├── models/post.ts             # example model — edit fields to taste
│   ├── routes/index.ts            # GET /
│   └── routes/api/
│       ├── posts.ts               # GET list + POST create (uses crud.*)
│       └── posts/[id].ts          # GET/PUT/PATCH/DELETE (uses crud.*)
├── public/                        # static files
├── hopak.config.ts                # database: { dialect: 'sqlite', ... }
├── main.ts                        # await hopak().listen()
├── tsconfig.json
├── package.json                   # depends on @hopak/core, dev-depends on @hopak/cli
├── .gitignore
├── .env.example
└── README.md
```

With `--db postgres` / `--db mysql` the `database:` block reads
`{ dialect: 'postgres', url: process.env.DATABASE_URL }`, the driver
(`postgres` or `mysql2`) is added to dependencies, and
`.env.example` contains a `DATABASE_URL=…` placeholder.

After scaffolding:

```bash
cd my-app
# sqlite: just run —
hopak dev

# postgres / mysql: fill in the connection first —
cp .env.example .env
# edit DATABASE_URL, then:
hopak sync      # CREATE TABLE IF NOT EXISTS for every model
hopak dev
```

`hopak sync` is the bootstrap path for new projects. The moment you
need schema evolution (adding a column to an existing table), switch
to migrations — `hopak migrate init` captures the current state, and
`hopak migrate new <name>` is the canonical flow from there on. `sync`
refuses to run once `app/migrations/` has files.

### `hopak dev`

Runs the project with Bun's `--hot` mode plus a lightweight file
watcher on `app/` so newly-added model or route files trigger a
cold-restart (Bun's own hot reload only patches already-imported
modules).

```bash
hopak dev
```

On start:

```
  Hopak.js v0.3.4
  ↳ Listening on http://localhost:3000
  ↳ Database: sqlite
```

Edits to existing files reload through Bun's HMR with state preserved
(milliseconds). Adding / deleting a route or model file logs
`New/removed file under app/ — restarting…` and the dev child is
respawned.

Press `Ctrl-C` to stop.

### `hopak generate <kind> [<name>]`

Scaffolds files from a template. Aliased as `hopak g`. Four kinds:

| Kind | What it writes | Arg |
|---|---|---|
| `model <name>` | `app/models/<name>.ts` (one table) | required |
| `crud <name>` | `app/routes/api/<plural>.ts` + `app/routes/api/<plural>/[id].ts` (REST for the model) | required |
| `route <path>` | `app/routes/<path>.ts` (one handler) | required |
| `cert` | `.hopak/certs/dev.{key,crt}` + local `.gitignore` (for local HTTPS) | none |

#### `hopak generate model <name>`

```bash
hopak generate model comment
# → Created file  app/models/comment.ts
```

```ts
// app/models/comment.ts
import { model, text } from '@hopak/core';

export default model('comment', {
  name: text().required(),
});
```

Edit the fields to match your domain. Generating the model alone
gives you a typed client via `ctx.db.model('comment')`; a DB table
follows on the next `hopak sync` (or first `hopak dev` boot) on a
project without migrations — if the project uses migrations, write
`hopak migrate new add_comments` + `hopak migrate up`. Then
`hopak generate crud comment` scaffolds the HTTP endpoints.

#### `hopak generate crud <name>`

```bash
hopak generate crud post
# → Created file  app/routes/api/posts.ts
# → Created file  app/routes/api/posts/[id].ts
```

Each generated file uses the `crud` helpers exported from `@hopak/core`:

```ts
// app/routes/api/posts.ts
import { crud } from '@hopak/core';
import post from '../../models/post';

export const GET = crud.list(post);
export const POST = crud.create(post);
```

```ts
// app/routes/api/posts/[id].ts
import { crud } from '@hopak/core';
import post from '../../../models/post';

export const GET = crud.read(post);
export const PUT = crud.update(post);
export const PATCH = crud.patch(post);
export const DELETE = crud.remove(post);
```

Six endpoints on `/api/<plural>/` — all paginated, validated, and
with sensitive fields (password / secret / token) stripped. Customize
a verb by replacing its export with your own `defineRoute(...)`;
delete an export to remove the verb entirely (the router answers
`405 Method Not Allowed` with an `Allow:` header listing what
remains).

#### `hopak generate route <path>`

```bash
hopak generate route search
hopak generate route posts/[id]/publish
hopak generate route api/users/[id]
hopak generate route files/[...rest]
```

Creates the file at the given path under `app/routes/`. Leading `/`
and trailing `.ts` are stripped — `posts/new.ts` and `posts/new` both
produce `app/routes/posts/new.ts`. The template starts with a
`GET` handler:

```ts
import { defineRoute } from '@hopak/core';

export const GET = defineRoute({
  handler: (ctx) => ({ ok: true, path: ctx.path }),
});
```

Rename the export to any verb, or add multiple exports in one file.

#### `hopak generate cert`

```bash
hopak generate cert
# → Generating self-signed dev certificate { path: ".hopak/certs" }
# → Dev certificate ready. Re-run `hopak dev` with HTTPS enabled.
```

Shells out to `openssl req -x509` once, writes the key/cert/gitignore
trio, and exits. Idempotent — running it when both files already
exist is a no-op. Pair with `server.https.enabled: true` in
`hopak.config.ts`; `hopak dev` refuses to start with HTTPS enabled
but no cert files present and points you back here.

Requires `openssl` on the machine. macOS ships it; on Linux:
`apt install openssl` / `apk add openssl`.

#### Refusal policy

`hopak generate model/route/crud` never overwrites. If any target
already exists the command fails with exit code `1`. `generate cert`
is the exception — it's idempotent and exits `0` when the files are
already there.

### `hopak use <capability>`

Enables a capability in an existing project. One command installs
any packages, patches the right files, and adds env keys.

Run with no arguments to see what's available:

```bash
hopak use
# Usage: hopak use <capability>
#
# Available:
#   sqlite       SQLite via bun:sqlite (default, zero install)
#   postgres     Postgres via postgres.js
#   mysql        MySQL via mysql2
#   request-log  Per-request logging — tags each request with an id and logs method/path/status/ms
#   auth         JWT auth — signup/login/me routes + requireAuth() middleware
```

#### Database dialects — `sqlite` / `postgres` / `mysql`

Switch dialects: installs the driver (`postgres` / `mysql2`),
rewrites the `database:` block in `hopak.config.ts`, and adds
`DATABASE_URL` to `.env.example`.

```bash
hopak use postgres
hopak use mysql
hopak use sqlite
```

The patcher replaces a bare-default block (what `hopak new` writes)
in place, but refuses to touch a block you've tuned (custom file
path, extra URL params, `ssl` config) — it prints the snippet to
paste and exits `1`, so tuning is never silently discarded.

For a brand-new project, prefer `hopak new <name> --db <dialect>` —
it's one fewer step.

#### `request-log`

Patches `main.ts` so every request gets a correlation id and a log
line. Goes from:

```ts
import { hopak } from '@hopak/core';

await hopak().listen();
```

to:

```ts
import { hopak, requestId, requestLog } from '@hopak/core';

await hopak().before(requestId()).after(requestLog()).listen();
```

Subsequent runs detect that `requestId` + `requestLog` are already
in the chain (by factory name, not exact call) and report
`Already using request-log` — safe to run in setup scripts. If
`main.ts` has drifted from the template, the patcher refuses and
prints the snippet to paste.

See the core README recipe for format options (`'simple'` / `'json'`)
and custom id generators.

#### `auth`

Scaffolds JWT credential auth in one command. Creates:

```
app/middleware/auth.ts           # exports requireAuth + signToken
app/routes/api/auth/signup.ts    # POST /api/auth/signup
app/routes/api/auth/login.ts     # POST /api/auth/login
app/routes/api/auth/me.ts        # GET /api/auth/me (requires token)
app/models/user.ts               # created only if you don't already have one
```

It also adds `JWT_SECRET` to `.env.example` and runs
`bun add @hopak/auth jose`.

```bash
hopak use auth
# → files created, deps installed
# → next: copy .env.example → .env, set JWT_SECRET
#
# no migrations yet:
#   hopak sync && hopak dev
#
# migrations already in use:
#   hopak migrate new add_users
#   # fill in up/down with CREATE TABLE users (...)
#   hopak migrate up && hopak dev
```

If any scaffolded file already exists, the command refuses to
overwrite it and prints the snippet so you can merge by hand. See
the `@hopak/auth` README for full API (OAuth providers, RBAC, claim
extension).

### `hopak sync`

Create missing tables from the current models — dev bootstrap. Emits
`CREATE TABLE IF NOT EXISTS` for every registered model and
`CREATE INDEX IF NOT EXISTS` for each `.index()` field, topologically
sorted so FK targets come before dependents.

```bash
hopak sync
```

```
Syncing schema to database {"cwd":"/.../my-app"}
Schema synchronized {"models":3,"dialect":"sqlite"}
```

Safe to run repeatedly. Useful in CI, right after `hopak use postgres`
on a fresh database, or before the first `hopak dev` on Postgres /
MySQL. Does not ALTER existing tables — the moment model columns drift
from the DB, `sync` prints a drift warning pointing at `hopak migrate`.

Once `app/migrations/` exists, `sync` refuses to run and directs you
to `hopak migrate up` so the two mechanisms never fight.

### `hopak migrate`

Schema evolution with history and rollback. Subcommands:

| Command | Effect |
|---|---|
| `hopak migrate init` | Generate initial migration from current models (one time) |
| `hopak migrate new <name>` | Empty skeleton file with `up`/`down` |
| `hopak migrate up [--to ID] [--dry-run]` | Apply pending migrations |
| `hopak migrate down [--steps N] [--to ID]` | Roll back (default: last 1) |
| `hopak migrate status` | Applied / pending / missing |

Each migration is one `.ts` file in `app/migrations/`:

```ts
// app/migrations/20260422T160100_add_role.ts
import type { MigrationContext } from '@hopak/core';

export const description = 'Add role column to user';

export async function up(ctx: MigrationContext): Promise<void> {
  await ctx.execute(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`);
}

export async function down(ctx: MigrationContext): Promise<void> {
  await ctx.execute(`ALTER TABLE users DROP COLUMN role`);
}
```

`ctx.db` is the full Hopak db client — use it for data migrations
(backfill columns, rewrite rows) alongside DDL in the same file.

SQLite + Postgres run each migration inside a transaction. MySQL
auto-commits DDL, so split multi-step changes into separate files;
drift partway through leaves partial state otherwise.

See core `README` → "Evolve the schema with migrations" for the
full walkthrough.

### `hopak check`

Audits project state without starting a server. Prints a coloured
report of what Hopak will see at boot time: config, database
location, models scanned, routes discovered, static directory.
Validates the config up front and fails fast on an invalid
`dialect`, `port`, or `logLevel`.

```bash
hopak check
```

```
  ✓ Config    hopak.config.ts loaded
  ✓ Database  sqlite (/.../my-app/.hopak/data.db)
  ✓ Models    3 loaded (comment, user, post)
  ✓ Routes    8 file route(s)
  ✓ Static    serving public/
```

Exits with `1` if any model/route file fails to scan, or if the
config is invalid — safe to run in CI to catch broken scaffolds
before they hit the dev server.

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
│   ├── routes/       # hopak generate route/crud writes here
│   └── migrations/   # hopak migrate init / new writes here
├── public/           # served as static files
├── .hopak/           # runtime state (db file, dev cert); gitignored
├── hopak.config.ts   # optional
└── main.ts           # entry point executed by hopak dev
```

`hopak sync`, `hopak check`, and `hopak dev` all read
`hopak.config.ts` to locate these directories.

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

After this, `hopak generate model post` writes to `src/domain/post.ts`,
and `hopak dev` / `hopak check` look in the new locations.

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
    "sync": "hopak sync",
    "check": "hopak check",
    "test": "bun test"
  }
}
```

When `@hopak/cli` is listed as a `devDependency`, `bun run dev`
invokes the local binary — no global install needed on that machine.

## Related packages

- [`@hopak/core`](https://www.npmjs.com/package/@hopak/core) — the framework itself (models, routing, database, HTTP server)
- [`@hopak/testing`](https://www.npmjs.com/package/@hopak/testing) — test helpers
- [`@hopak/common`](https://www.npmjs.com/package/@hopak/common) — shared primitives (transitive)

Full framework documentation: https://github.com/hopakjs/hopak

## License

MIT.

## Author

**Volodymyr Press** · [vladimpress@gmail.com](mailto:vladimpress@gmail.com) · [github.com/hopakjs](https://github.com/hopakjs)
