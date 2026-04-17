# @hopak/cli

Command-line interface for [Hopak.js](https://github.com/hopakjs/hopak) — scaffold projects, run dev server, generate models and routes.

## Install

Globally (for the `hopak new my-app` flow):

```bash
bun add -g @hopak/cli
```

Or per-project (recommended for team consistency):

```bash
bun add -d @hopak/cli
```

## Commands

| Command | What it does |
|---------|--------------|
| `hopak new <name>` | Scaffold a new project |
| `hopak dev` | Run with hot reload |
| `hopak generate model <name>` | Add a model file |
| `hopak generate route <path>` | Add a route file |
| `hopak migrate` | Sync database schema (dev) |
| `hopak check` | Audit project state |

## Docs

Full framework docs: https://github.com/hopakjs/hopak

## License

MIT
