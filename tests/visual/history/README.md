# History visual fixtures

The files in `snapshots/` are the single authoritative Linux baseline. They are
rendered with Playwright-managed Chromium in Chronicle's digest-pinned
Playwright Noble container on `linux/amd64`; Windows-rendered and host-browser
baselines are not supported.

Run the canonical comparison from the repository root:

```sh
npm run test:visual
```

Docker must be available; on Windows, use Docker Desktop with Linux containers.
If Docker is unavailable, use the pull-request CI result and its uploaded
expected, actual, and diff images. Never fall back to a Windows or host Chrome
comparison.

After an intentional visual change, first ensure the snapshot directory is
clean, then generate the candidate canonical baseline explicitly:

```sh
npm run test:visual:update -- --confirm
```

The update command refuses CI, an omitted confirmation, and an already-dirty
snapshot directory. Review every changed PNG and the application change with an
independent critic, then rerun `npm run test:visual` without update mode. Do not
accept regenerated images that reveal clipping, overlap, missing content,
incorrect responsive behavior, or a broken interaction state. Changes to the
Playwright version or canonical container require a separate reviewed baseline
migration.
