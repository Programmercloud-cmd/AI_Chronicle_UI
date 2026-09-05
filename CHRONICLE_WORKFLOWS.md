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
<installed-version> → <new-version>
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

Release only an accepted `main` commit from a clean working tree. Replace `<next-version>` with the intended patch, minor, or major version. Prepare the version on a release branch:

```bash
git switch main
git pull --ff-only
git switch -c "release/v<next-version>"

npm ci
npm version "<next-version>" --no-git-tag-version
npm run release:check

git add package.json package-lock.json
git commit -m "chore(release): v<next-version>"
git push -u origin "release/v<next-version>"
```

Open a pull request to `main`, obtain review and a successful required `Canonical release gate`, then merge using a normal repository-supported method. If Docker is unavailable locally, rely on that required canonical PR gate. If the intended version is already in both manifests on `main`, do not bump it again; continue with the main checks below.

After the merge, update local `main` and record its exact SHA:

```bash
git switch main
git pull --ff-only
git status --short
git rev-parse HEAD
```

Require a clean working tree, matching intended versions in both manifests, and a successful **push-triggered** `.github/workflows/ci.yml` run with a green `Canonical release gate` for that exact `main` SHA. A green PR run is not sufficient. If main CI is pending or failing, do not create a tag; make any repairs through a new PR and repeat these checks. Confirm that neither the intended tag nor its GitHub Release already exists. Then create the annotated tag on that exact green commit, verify its peeled SHA equals `HEAD`, and push:

```bash
git tag -a "v<next-version>" -m "Project Chronicle v<next-version>"
git rev-parse "v<next-version>^{}"
git rev-parse HEAD
git push origin "v<next-version>"
```

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

`v0.2.0` was the failed first release attempt and remains an unpublished tag. The first corrected release is `v0.2.1`. Keep `v0.2.0` untouched; do not move, delete/recreate, or reuse it.

For local package development only, `npm pack --dry-run` remains useful. Maintainers do not run `npm pack` as part of the normal production release flow.
