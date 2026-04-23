<p align="center">
  <img alt="Hopak.js — Backend framework for Bun" src=".github/assets/git_banner.png" width="100%">
</p>

<p align="center">
  <a href="https://hopak.dev"><img alt="hopak.dev" src="https://img.shields.io/badge/site-hopak.dev-0d6efd?labelColor=0d1117"></a>
  <a href="https://www.npmjs.com/package/@hopak/core"><img alt="npm" src="https://img.shields.io/npm/v/@hopak/core.svg?labelColor=0d1117"></a>
  <a href="https://github.com/hopakjs/hopak/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/npm/l/@hopak/core.svg?labelColor=0d1117"></a>
  <a href="https://bun.sh"><img alt="bun" src="https://img.shields.io/badge/runtime-Bun%20%E2%89%A5%201.3-f472b6?labelColor=0d1117"></a>
</p>

<p align="center">
  <strong>A backend framework for <a href="https://bun.sh">Bun</a>.</strong><br>
  File-based routing. Typed models. Scaffolded CRUD.
</p>

<p align="center">
  <strong>📖 Full documentation: <a href="https://hopak.dev/docs">hopak.dev/docs</a></strong>
</p>

---

```bash
bun add -g @hopak/cli
hopak new my-app
cd my-app && hopak dev
```

## Packages

| Package | npm | Purpose |
|---|---|---|
| [`@hopak/core`](./packages/core) | [![npm](https://img.shields.io/npm/v/@hopak/core.svg)](https://www.npmjs.com/package/@hopak/core) | Framework runtime |
| [`@hopak/cli`](./packages/cli) | [![npm](https://img.shields.io/npm/v/@hopak/cli.svg)](https://www.npmjs.com/package/@hopak/cli) | Operator tool |
| [`@hopak/auth`](./packages/auth) | [![npm](https://img.shields.io/npm/v/@hopak/auth.svg)](https://www.npmjs.com/package/@hopak/auth) | Auth + OAuth + RBAC |
| [`@hopak/testing`](./packages/testing) | [![npm](https://img.shields.io/npm/v/@hopak/testing.svg)](https://www.npmjs.com/package/@hopak/testing) | In-process test server |
| [`@hopak/common`](./packages/common) | [![npm](https://img.shields.io/npm/v/@hopak/common.svg)](https://www.npmjs.com/package/@hopak/common) | Shared primitives |

## Contributing

Pull requests welcome. For substantial changes, open an issue first. The repo is a Bun workspace — `bun install` at the root covers every package.

## License

[MIT](./LICENSE) — Volodymyr Press.
