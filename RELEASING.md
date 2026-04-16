# Releasing

Hopak publishes four packages together under `@hopak/*`:

- `@hopak/common`
- `@hopak/core`
- `@hopak/testing`
- `@hopak/cli`

All packages share one version. A release publishes them together.

## Prerequisites (one-time)

1. Create an [npm automation token](https://docs.npmjs.com/creating-and-viewing-access-tokens) with publish permissions for the `@hopak` org.
2. Add it to repo secrets: **Settings → Secrets and variables → Actions → New repository secret**, name `NPM_TOKEN`.
3. Create a GitHub environment named `npm-publish` (**Settings → Environments → New environment**). Enable **Required reviewers** and add yourself — this gates every publish behind a manual approval.

## Release steps

1. **Bump versions** in every package — all four must match:

   ```bash
   # Example for 0.0.2
   for pkg in packages/*/package.json; do
     jq '.version = "0.0.2"' "$pkg" > "$pkg.tmp" && mv "$pkg.tmp" "$pkg"
   done
   ```

2. **Commit and tag**:

   ```bash
   git add packages/*/package.json
   git commit -m "chore: release 0.0.2"
   git tag v0.0.2
   git push origin main --tags
   ```

3. The push of `v0.0.2` triggers the `Release` workflow. It first runs lint + typecheck + tests, then waits for your approval in the `npm-publish` environment.

4. **Approve** in the Actions tab. Packages publish in order: `common` → `core` → `testing` → `cli`.

## Manual trigger (no git tag)

Use **Actions → Release → Run workflow**. Provide:

- `version` — must match all `package.json` versions
- `dry-run` — check to validate without publishing

## Dry-run first time

Before your first real publish, run the workflow with `dry-run: true` to confirm everything is wired up.
