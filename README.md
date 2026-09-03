# Project Chronicle

Project Chronicle is a local, read-only viewer for portable software-project history.

A project keeps its Chronicle data in a normal directory such as:

```text
my-project/
└── chronicle/
```

Chronicle itself is installed separately as a CLI application. The project directory contains the history; the globally installed Chronicle package validates and displays it.

---

## Quick start

### 1. Install Chronicle once on your machine

From a packaged Chronicle tarball:

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
├── current.yaml
└── roadmap.yaml
```

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
npm install -g /path/to/project-chronicle-0.2.0.tgz

cd /path/to/my-project
chronicle validate ./chronicle
chronicle serve ./chronicle
```

Do **not** run `chronicle init` again after upgrading the application.

If a future release introduces an incompatible dataset-schema change, that release must provide an explicit compatibility or migration path.

---

# Developing and packaging Chronicle

This section is for contributors working on Chronicle itself, not consumers using Chronicle in another project.

## Requirements

- Node.js 20.19 or newer
- Linux or Windows development machine
- Google Chrome for tracked visual and packaged-browser release checks

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

`release:check` covers schema/type drift, production build, automated tests, reviewed History visual checks, package inspection, installed CLI/HTTP smoke tests, and packaged-browser security/accessibility checks.

## Create a distributable package

```bash
npm pack --dry-run
npm pack
```

This produces:

```text
project-chronicle-<version>.tgz
```

The tarball is generated package output, is ignored by Git, and should not be committed.

The package contains the runtime and initialization assets needed by consumers. Chronicle's own tracked project history, examples, tests, and development scratch state are not part of the consumer package.

## Versioning and release flow

`main` is the single authoritative Chronicle source branch.

The intended development and distribution flow is:

```text
feature branch
    ↓
review / tests
    ↓
main
    ↓
version tag / release
    ↓
npm pack
    ↓
project-chronicle-<version>.tgz
    ↓
consumer installs globally
```

For example:

```bash
git checkout main
git pull

npm ci
npm run release:check

# update the version deliberately as appropriate

npm run build
npm pack
```

A bug fix normally receives a patch version; a backward-compatible feature normally receives a minor version.

Be aware that `npm version` can create a commit and tag, so use it deliberately as part of the chosen release process.

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
