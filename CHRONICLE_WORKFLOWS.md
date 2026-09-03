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

Release only an accepted `main` commit from a clean working tree. The normal patch release commands are:

```bash
git checkout main
git pull --ff-only

npm ci
npm run release:check

npm version patch --git-tag-version=true --tag-version-prefix=v
VERSION="$(node -p "require('./package.json').version")"

git push origin main
git push origin "v${VERSION}"
```

Use `npm version minor --git-tag-version=true --tag-version-prefix=v` or `npm version major --git-tag-version=true --tag-version-prefix=v` when appropriate.

`npm version` updates `package.json` and `package-lock.json`, creates the version commit, and creates the matching `v<version>` Git tag. Review those results before pushing. Pushing `main` alone does not publish a release; pushing the version tag starts `.github/workflows/release.yml`.

The GitHub-hosted release job:

```text
tag/package version validation
→ reject an existing release
→ npm ci
→ npm audit --omit=dev
→ npm run release:check
→ npm pack
→ package allow-list validation
→ SHA-256 checksum
→ draft, verify assets, and publish GitHub Release
```

The release contains:

- `project-chronicle-<version>.tgz`
- `SHA256SUMS.txt`

The workflow uses only the built-in `GITHUB_TOKEN`, scoped in the workflow to `contents: write`. Repository owners must ensure GitHub Actions is enabled and that repository or organization policy allows this workflow to run and create releases. Keep the repository-wide default workflow permission restricted; do not enable broad read/write defaults for this release. No npm-registry token or personal access token is required.

Existing releases are immutable. If a release tag already has a GitHub Release, the workflow fails; make the correction in a new patch version instead. Do not delete and replace a published artifact.

For local package development only, `npm pack --dry-run` remains useful. Maintainers do not run `npm pack` as part of the normal production release flow.
