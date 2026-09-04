# Chronicle distribution workflows

Project Chronicle's application package and each consumer project's `chronicle/` dataset have separate lifecycles. A new application release never recreates or overwrites an existing dataset.

## Consumer workflow

Consumers do not need a Chronicle source checkout, development dependencies, or a local build.

1. Open the [Project Chronicle Releases page](https://github.com/Programmercloud-cmd/AI_Chronicle_UI/releases).
2. Download `project-chronicle-<version>.tgz` and, optionally, `SHA256SUMS.txt`.
3. In the download directory, optionally verify the package with `sha256sum --check SHA256SUMS.txt`.
4. Install the downloaded package globally:

   ```bash
   npm install -g /path/to/downloaded/project-chronicle-<version>.tgz
   ```

5. In the consuming project, validate and serve its existing dataset:

   ```bash
   cd /path/to/my-project
   chronicle validate ./chronicle
   chronicle serve ./chronicle
   ```

Only a project without a Chronicle dataset should initialize one:

```bash
chronicle init ./chronicle
```

The project's coding agent should then read `chronicle/AGENTS.md`.

Installing a newer Chronicle application version does **not** mean running `chronicle init` again:

```text
Consumer project
└── chronicle/     existing history remains unchanged

Chronicle application
0.1.0 → 0.2.0
```

After an application upgrade, run `chronicle validate ./chronicle` and `chronicle serve ./chronicle` against the existing history.

## Maintainer workflow

### Canonical checks

Chronicle maintains one authoritative visual baseline. Its exact environment is:

- Linux/amd64;
- the official Playwright Noble image `mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e`;
- `@playwright/test` 1.62.1 and its managed headless Chromium build;
- the viewport, locale, timezone, scale, and animation settings tracked in the Playwright configuration.

There is no Windows baseline and no host-Chrome fallback. `npm run check` is the fast native build and unit-test loop. The public `npm run release:check` command always enters the pinned Linux container, performs the locked install and production audit, and invokes the nonrecursive inner release gate. Windows maintainers must enable Docker Desktop's Linux-container mode. If Docker is unavailable, the command fails clearly; use pull-request CI for the canonical result instead of updating screenshots on Windows.

For an intentional visual change:

1. Make the UI or visual-test change and ensure the snapshot directory contains no unrelated edits.
2. Run `npm run test:visual:update -- --confirm`. It generates images only inside the canonical container and refuses CI or a dirty snapshot directory.
3. Inspect every changed snapshot. Check wrapping, clipping, overlap, responsive behavior, hover/focus state, and detail views; do not accept a bulk regeneration solely because pixels changed.
4. Run comparison-only `npm run release:check` without any snapshot-update flag; all visual cases and the complete gate must pass against the newly generated files.
5. Commit the reviewed snapshots with the intentional source/test change and canonical environment evidence. An independent read-only critic must accept every changed case.

CI and release workflows never use `--update-snapshots`. On visual failure they retain `test-results/**`, including expected, actual, and diff PNGs, as a GitHub Actions artifact for 14 days. A Playwright version or container digest change is a deliberate environment-and-baseline migration and receives the same independent review.

### Pull-request and main gate

`.github/workflows/ci.yml` runs `npm run release:check` for pull requests targeting `main` and every push to `main`. Configure branch protection to require its stable `Canonical release gate` job before merge. The workflow has read-only `contents: read` permission and uses the same public container launcher as local and release checks, so tags are not the first place canonical CI runs.

### Version and release

Release only an accepted `main` commit from a clean working tree. For the next patch release:

```bash
git checkout main
git pull --ff-only

npm ci
npm run release:check

npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore(release): v0.2.1"
git push origin main
```

Wait for `.github/workflows/ci.yml` to complete successfully for the exact version-commit SHA. If it fails, repair the version commit and obtain a successful exact-SHA run before creating any tag. Then create and push the annotated tag:

```bash
git tag -a v0.2.1 -m "Project Chronicle v0.2.1"
git push origin v0.2.1
```

Use `npm version minor --no-git-tag-version` or `npm version major --no-git-tag-version` when appropriate, and substitute that version consistently in the commit and tag.

`--no-git-tag-version` updates the manifests without creating a commit or tag, preventing a stale local tag if canonical main CI requires repair. Pushing `main` alone does not publish a release; pushing the annotated version tag starts `.github/workflows/release.yml`.

The GitHub-hosted release job:

```text
tag/package version validation
→ tagged commit ancestry validation
→ reject an existing release
→ require a successful ci.yml push run for the exact tagged SHA
→ npm run release:check
→ npm pack
→ package allow-list validation
→ SHA-256 checksum
→ draft, verify assets, and publish GitHub Release
```

The release contains:

- `project-chronicle-<version>.tgz`
- `SHA256SUMS.txt`

The release queries workflow runs, rather than check runs, for an exact-SHA successful `push` run of `ci.yml` on `main`. It uses only the built-in `GITHUB_TOKEN`, scoped to `contents: write` for release publication and `actions: read` for that workflow-run lookup. No PAT, `checks: read`, npm-registry token, or broader workflow permission is required. Keep the repository-wide default permission restricted and ensure repository policy allows GitHub Actions to create releases.

Existing releases are immutable. If a release tag already has a GitHub Release, the workflow fails; make the correction in a new patch version instead. Do not delete and replace a published artifact.

The remote `v0.2.0` tag from the failed first attempt remains untouched and unpublished. Do not move, delete/recreate, or silently reuse it. The first corrected release is `v0.2.1`, created only after its version commit has successful canonical main CI.

For local package development only, `npm pack --dry-run` remains useful. Maintainers do not run `npm pack` as part of the normal production release flow.
