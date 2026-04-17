# Releasing

Hopak publishes four packages together under `@hopak/*`:

- `@hopak/common`
- `@hopak/core`
- `@hopak/testing`
- `@hopak/cli`

All packages share one version. A release publishes them as a set.

## Prerequisites (one-time)

1. Create an [npm automation token](https://docs.npmjs.com/creating-and-viewing-access-tokens) with publish permissions for the `@hopak` org.
2. Add it to repo secrets: **Settings → Secrets and variables → Actions → New repository secret**, name `NPM_TOKEN`.
3. Create a GitHub environment named `npm-publish` (**Settings → Environments → New environment**). Enable **Required reviewers** — this gates every publish behind a manual approval.

## Release steps

1. **Bump versions** in every package — all four must match:

   ```bash
   VERSION=0.1.0
   for pkg in packages/*/package.json; do
     jq ".version = \"$VERSION\"" "$pkg" > "$pkg.tmp" && mv "$pkg.tmp" "$pkg"
   done
   ```

2. **Re-format** (jq pretty-prints, which diverges from Biome style):

   ```bash
   bunx @biomejs/biome check --write packages/*/package.json
   ```

3. **Verify locally** before publish:

   ```bash
   bun test
   bun run typecheck
   bunx @biomejs/biome check .
   ```

4. **Commit and tag**:

   ```bash
   git add packages/*/package.json
   git commit -m "chore: release $VERSION"
   git tag "v$VERSION"
   git push origin main "v$VERSION"
   ```

5. Tag push triggers the **Release** workflow. It runs lint + typecheck + tests, then waits for approval in the `npm-publish` environment.

6. **Approve** in the Actions tab. The workflow:
   - Rewrites `workspace:*` dependencies to `^$VERSION` (npm doesn't do this itself)
   - Publishes in order: `common` → `core` → `testing` → `cli`
   - Attaches npm provenance (OIDC)

7. **Create a GitHub release**:

   ```bash
   gh release create "v$VERSION" --title "v$VERSION" --generate-notes
   ```

## Manual trigger (no git tag)

**Actions → Release → Run workflow**:

- `version` — must match all `package.json` versions
- `dry-run` — tick to validate without publishing

## Dry-run first

Before a real publish, always run with `dry-run: true` to catch missing files, permissions, or name conflicts before they hit the registry.

---

## Author

**Volodymyr Press** · [vladimpress@gmail.com](mailto:vladimpress@gmail.com) · [github.com/hopakjs](https://github.com/hopakjs)
