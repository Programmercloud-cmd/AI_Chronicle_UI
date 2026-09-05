# Project Chronicle

Project Chronicle is a local, read-only viewer for portable software-project history.

A project keeps its Chronicle data in a normal directory such as:

```text
my-project/
└── chronicle/
```

Chronicle itself is installed separately as a CLI application. The project directory contains the history; the globally installed Chronicle package validates and displays it.

---

## Consumer: install and use Chronicle

Consumers install a package from the [Project Chronicle Releases page](https://github.com/Programmercloud-cmd/AI_Chronicle_UI/releases). They do not need to clone this repository, install Chronicle's development dependencies, or build Chronicle themselves.

The consumer flow is:

```text
download release
→ optionally verify SHA-256
→ install globally
→ initialize once or use an existing dataset
→ validate
→ serve
```

### 1. Install Chronicle once on your machine

Download `project-chronicle-<version>.tgz` and, optionally, `SHA256SUMS.txt` from the Releases page. From the download directory, the checksum can be verified with:

```bash
sha256sum --check SHA256SUMS.txt
```

Install the downloaded package:

```bash
npm install -g /path/to/project-chronicle-<version>.tgz
```

Verify that the CLI is available:

```bash
chronicle --help
```

You only need to install Chronicle once per machine.

---

### 2. Add Chronicle to a project for the first time

From the root of the project:

```bash
chronicle init ./chronicle
```

Run `init` **only once**, when the project does not already contain a Chronicle dataset.

A new dataset contains the files needed to begin, including:

```text
chronicle/
├── AGENTS.md
├── .gitattributes
├── project.yaml
└── roadmap.yaml
```

`current.yaml` is optional. Author it after the first milestone has been
accepted, when the dataset has a current operational state to summarize.

Record directories such as these may not exist yet:

```text
branches/
milestones/
engineering-events/
revisions/
evidence/records/
evidence/artifacts/
```

That is expected. Missing collection directories mean that the collection is currently empty. They are created when the first corresponding record or artifact is added.

`AGENTS.md` contains Chronicle authoring guidance for coding agents.

`.gitattributes` protects checksummed evidence artifacts from Git line-ending conversion.

Both are project helpers rather than Chronicle schema records.

---

### 3. Let your coding agent establish or maintain the project history

For an existing project that already has development history, a suitable first instruction is:

> Read `chronicle/AGENTS.md` and begin maintaining Chronicle for this project. Inspect the existing project and create only the truthful baseline needed to represent the work already completed, the current accepted state, active work, blockers, and next step. Do not invent unsupported historical detail.

Chronicle is intentionally conservative about milestones. Routine implementation iterations, reviews, test runs, and ordinary code changes normally belong in engineering events or evidence rather than becoming primary History nodes.

---

### 4. Validate the dataset

After creating or changing Chronicle records:

```bash
chronicle validate ./chronicle
```

Validation errors must be resolved before the dataset can be served.

Warnings should be reviewed but do not necessarily prevent serving.

---

### 5. Open the Chronicle UI

```bash
chronicle serve ./chronicle
```

Open the localhost URL printed by Chronicle.

The application provides:

- **Current** — accepted project state, active work, blockers, and next step;
- **History** — chronological branching milestone history;
- **Roadmap** — forward-looking planned work;
- **Milestone Detail** — context, engineering events, evidence, diffs, and neighboring milestones.

The server binds only to `127.0.0.1` and defaults to port `4317`.

---

## If the repository already contains `chronicle/`

Do **not** run `chronicle init` again.

For a freshly cloned project that already tracks Chronicle data:

```bash
git clone <repository-url>
cd my-project

chronicle validate ./chronicle
chronicle serve ./chronicle
```

If Chronicle is not installed on that machine yet, install it globally first:

```bash
npm install -g /path/to/project-chronicle-<version>.tgz
```

The commands have distinct purposes:

```text
chronicle init      create a Chronicle dataset once
chronicle validate  check an existing dataset
chronicle serve     open an existing dataset in the local UI
```

---

## Track Chronicle with the project

The project-local `chronicle/` directory is intended to be committed with the project:

```bash
git add chronicle
git commit -m "Add Project Chronicle documentation"
```

Because empty collection directories are not required, Chronicle survives normal Git commit/clone workflows without placeholder files such as `.gitkeep`.

The dataset-local `.gitattributes` preserves the exact bytes of files below `evidence/artifacts/`, which is required for SHA-256 evidence validation across Windows and Linux checkouts.

---

# Updating Chronicle itself

The Chronicle application and a project's Chronicle dataset are separate:

```text
Globally installed Chronicle application
        +
Project-local chronicle/ dataset
```

Updating the Chronicle application does not recreate or replace project history.

For ordinary backward-compatible releases, a consumer installs the new package globally and continues using the same dataset.

Example:

```bash
npm install -g /path/to/project-chronicle-<version>.tgz

cd /path/to/my-project
chronicle validate ./chronicle
chronicle serve ./chronicle
```

Do **not** run `chronicle init` again after upgrading the application.

If a future release introduces an incompatible dataset-schema change, that release must provide an explicit compatibility or migration path.

---

# Chronicle maintainer: develop and release

This section is for contributors working on Chronicle itself, not consumers using Chronicle in another project.

## Requirements

- Node.js 20.19 or newer
- Linux or Windows development machine
- Docker with Linux containers enabled for canonical visual and release checks

Chronicle has one authoritative visual environment: Linux/amd64 in the official Playwright 1.62.1 Noble image pinned by digest. It uses Playwright's managed Chromium, not Chrome installed on the host. Windows-rendered screenshots are useful for local debugging but are not visual baselines.

## Install the locked development dependencies

From a Chronicle source checkout:

```bash
npm ci
```

`package-lock.json` is tracked and should remain the reproducible dependency lock for Chronicle development.

Prefer `npm ci` over routine `npm install` when working from the repository's existing lockfile.

## Build and test

```bash
npm run build
npm run check
npm run release:check
```

`npm run check` is the fast native development loop. `npm run release:check` launches the pinned Linux container and covers the locked install, production dependency audit, schema/type drift, production build, automated tests, reviewed History visual checks, package inspection, installed CLI/HTTP smoke tests, and packaged-browser security/accessibility checks. On Windows, Docker Desktop must be using Linux containers; if Docker is unavailable the command fails rather than comparing against a Windows baseline. Pull-request CI can provide the authoritative result when a workstation cannot run Docker.

Intentional screenshot changes are generated only through `npm run test:visual:update -- --confirm` in the canonical container. Review every changed PNG and include it with the UI or visual-test change. CI and ordinary release checks compare screenshots only and never regenerate them. See `CHRONICLE_WORKFLOWS.md` for the complete baseline review procedure.

## Inspect a package locally

```bash
npm pack --dry-run
npm pack
```

This local development check produces:

```text
project-chronicle-<version>.tgz
```

The tarball is generated package output, is ignored by Git, and should not be committed. GitHub Actions performs production packaging; maintainers do not manually run `npm pack` for a normal release.

The package contains the runtime and initialization assets needed by consumers. Chronicle's own tracked project history, examples, tests, and development scratch state are not part of the consumer package.

## Versioning and release flow

`main` is the single authoritative Chronicle source branch.

The intended development and distribution flow is:

```text
feature / release branch (including untagged version commit)
    ↓
canonical PR review / tests
    ↓
main
    ↓
successful canonical main CI for the exact commit
    ↓
annotated version tag
    ↓
GitHub Actions repeats release gates and runs npm pack
    ↓
project-chronicle-<version>.tgz
    ↓
consumer installs globally
```

Release only from an accepted `main` commit and a clean working tree. Replace `<next-version>` below with the intended version. A bug fix normally receives a patch version; a backward-compatible feature normally receives a minor version. Prepare a new version on a release branch:

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

Require a clean working tree, matching intended versions in both manifests, and a successful **push-triggered** `Canonical release gate` in `.github/workflows/ci.yml` for that exact `main` SHA. A green PR run is not sufficient. Do not create a local tag while main CI is pending or failing; make any repairs through a new PR and repeat these checks. Confirm that neither the intended tag nor its GitHub Release already exists. Then create the annotated tag on that exact green commit, verify its peeled SHA equals `HEAD`, and push:

```bash
git tag -a "v<next-version>" -m "Project Chronicle v<next-version>"
git rev-parse "v<next-version>^{}"
git rev-parse HEAD
git push origin "v<next-version>"
```

`npm version --no-git-tag-version` updates `package.json` and `package-lock.json` without creating a commit or tag. This prevents a stale local release tag when the version commit needs repair. A tag push triggers `.github/workflows/release.yml`; a push to `main` alone does not create a release.

The release workflow validates the tag, ancestry, and successful canonical `ci.yml` push run for the exact tagged SHA; repeats `release:check`; then packs, checksums, and publishes through the built-in `GITHUB_TOKEN`. Its least-privilege permissions are `contents: write` and `actions: read`; no personal access token is used. Visual failures upload expected, actual, and diff evidence for review. Repository maintainers can see [CHRONICLE_WORKFLOWS.md](https://github.com/Programmercloud-cmd/AI_Chronicle_UI/blob/main/CHRONICLE_WORKFLOWS.md) for the exact procedures and required repository setting.

Published releases are immutable. Correct a bad release with a new patch version rather than replacing an existing tag or release.

`v0.2.0` was the failed first release attempt and remains an unpublished tag. The first corrected release is `v0.2.1`. Keep `v0.2.0` untouched; do not move, delete/recreate, or reuse it.

---

# Chronicle dataset structure

A populated Chronicle dataset may look like:

```text
chronicle/
├── AGENTS.md
├── .gitattributes
├── project.yaml
├── current.yaml
├── roadmap.yaml
├── branches/
├── milestones/
├── engineering-events/
├── revisions/
└── evidence/
    ├── records/
    └── artifacts/
```

Collection directories are optional when empty.

The authoritative field contract, ID rules, enums, relations, and invariants are documented in [the v1 public contract](docs/schema/v1-public-contract.md).

Canonical timestamps use exact ISO 8601 values with an explicit UTC offset.

`current.updated_at` records when the operational summary was updated and is distinct from a milestone's immutable `occurred_at`.

---

# History and milestone semantics

Milestones are admitted conservatively. They represent material changes to a human owner's understanding of project state, direction, capability, or validated knowledge.

Ordinary developer iterations, critic outcomes, test runs, and routine code changes normally remain subordinate engineering events and evidence.

Accepted history is not silently rewritten.

Later conclusions should be recorded as new milestones with explicit relations such as:

- `disproves`
- `supersedes`
- `reverts_to`

Visible guarded revisions are reserved for clerical corrections.

Chronicle branch IDs describe visualization lanes and development-history divergence; they are not Git branches.

---

# Evidence integrity and safety

Evidence artifacts may include logs, reports, benchmarks, screenshots, profiler output, and exact code patches.

Checksummed evidence is byte-exact. Do not normalize or rewrite an evidence artifact after hashing it, and do not change a declared SHA-256 merely to make validation succeed.

Chronicle treats evidence as untrusted:

- text and diffs are rendered as escaped data;
- HTML is never injected;
- SVG evidence is download-only;
- raster previews require signature validation;
- raw artifacts use attachment disposition;
- filesystem access enforces dataset-root containment and rejects symlink escape;
- the localhost server applies restrictive Content Security Policy headers and `X-Content-Type-Options: nosniff`.

---

# V1 operating limits

- Desktop-first History view with minimap, pan/zoom, rectangle zoom selection, fullscreen navigation, and jump-to-current.
- Characterized layout envelope: 250 milestones, 12 branches, and 30 projected roadmap items.
- Unified diffs up to 2 MB render inline; oversized, binary, invalid-UTF-8, or unparsable artifacts remain downloadable.
- No browser authoring, automatic Git ingestion, remote hosting, authentication, database, or schema-migration system in v1.

The difficult fixture under `examples/difficult` exercises complex branching, merges, rejected paths, a revert, later-disproved knowledge, revisions, blockers, subordinate critic iterations, multiple evidence types, and a ground-truth patch.

Human orientation remains an explicit release gate. The tracked study protocol is at [docs/usability/orientation-study.md](docs/usability/orientation-study.md).
