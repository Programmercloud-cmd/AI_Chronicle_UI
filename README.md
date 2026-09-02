# Project Chronicle

Project Chronicle is a reusable local viewer for portable software-project history. A Chronicle directory contains inspectable YAML records and evidence artifacts; the web UI is a deterministic, read-only projection of that data.

## Requirements

- Node.js 20.19 or newer
- Linux or Windows development machine
- Google Chrome for the tracked visual and packaged-browser release checks

## Developing Chronicle itself

From a Chronicle source checkout, install the already-locked dependencies, build, and create the tested local package:

```text
npm ci
npm run build
npm pack
```

This creates `project-chronicle-<version>.tgz` in the repository root. It is a generated local package artifact, is ignored by Git, and should not be committed. The v1 package is intentionally marked private and is not published to the public npm registry.

For repository development and release verification:

```text
npm ci
npm run build
npm run check
npm run release:check
```

`release:check` runs schema/type drift checks, the clean production build, unit/component/integration tests, the reviewed History screenshot suite plus geometry/accessibility checks, a runtime-only tarball inspection, an unrelated-directory production install, installed CLI/HTTP smoke tests, and the packaged-browser CSP/accessibility flow.

## Installing Chronicle for use across projects

Install the packed CLI globally once on the machine:

```text
npm install -g /path/to/project-chronicle-0.1.0.tgz
```

After that, `chronicle` is available from arbitrary directories:

```text
chronicle init ./dev/chronicle
chronicle validate ./dev/chronicle
chronicle serve ./dev/chronicle
```

This keeps Chronicle out of each consuming project's npm dependency tree. A project does not need to create or modify its own `package.json`, `package-lock.json`, or `node_modules/` merely to maintain Chronicle documentation. Conceptually, one globally installed Chronicle package serves datasets such as `Project A/dev/chronicle/`, `Project B/dev/chronicle/`, and `Project C/dev/chronicle/`; each project contains only its Chronicle dataset.

`serve` binds only to `127.0.0.1` and defaults to port `4317`. Open the printed URL to view Current, History, Roadmap, and milestone details. The server reloads and validates the complete dataset for each snapshot request; it exposes no mutation API.

## Using Chronicle in another project

With Chronicle globally installed, adoption is one initialization command inside the project:

```text
# one-time machine installation
npm install -g /path/to/project-chronicle-0.1.0.tgz

# inside any project
chronicle init ./dev/chronicle
chronicle validate ./dev/chronicle
chronicle serve ./dev/chronicle
```

`chronicle init` creates the data scaffold plus a dataset-local `AGENTS.md` containing Chronicle authoring guidance for AI coding agents. You can then tell an agent, “Maintain the project's Chronicle documentation.” An agent that discovers `dev/chronicle/AGENTS.md` can follow those rules while editing Chronicle records. The guide is optional, noncanonical authoring help: existing datasets without it remain valid, and Chronicle itself does not depend on AI.

## Chronicle directory

```text
chronicle/
├── AGENTS.md
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

The normative field contract, ID rules, enums, relations, and invariants are documented in [the v1 public contract](docs/schema/v1-public-contract.md). Canonical timestamps are exact ISO 8601 instants with an explicit UTC offset. `current.updated_at` records operational-summary freshness and remains distinct from a milestone's immutable `occurred_at`.

Milestones are admitted conservatively: they represent material changes to a human owner's understanding of project state, direction, capability, or validated knowledge. Developer iterations, critic outcomes, test runs, and ordinary code changes normally remain subordinate engineering events and evidence.

Accepted historical records are append-only. Later conclusions use new milestones and explicit relations such as `disproves`, `supersedes`, or `reverts_to`; guarded visible revision records are reserved for clerical corrections. Branch IDs define Chronicle visualization lanes, not Git branches.

## Evidence safety

Evidence is untrusted. Text and diffs are escaped and rendered as data; HTML is never injected, SVG evidence is download-only, raster previews require signature validation, raw artifacts use attachment disposition, and filesystem reads enforce root containment and reject symlink escape. The localhost server applies restrictive route-specific Content Security Policies and `X-Content-Type-Options: nosniff`.

## V1 operating limits

- Desktop-first History view with a minimap, bounded pan/zoom, rectangle selection, fullscreen navigation, responsive framing, and jump-to-current.
- Characterized layout envelope: 250 milestones, 12 branches, and 30 projected roadmap items. Larger browser histories may become difficult before the pure layout becomes slow.
- Unified diffs up to 2 MB render inline. Oversized, binary, invalid-UTF-8, or unparsable artifacts remain downloadable.
- Escaped text/diff and signature-validated PNG/JPEG/WebP have dedicated previews; other evidence formats are download-only.
- No browser authoring, automatic Git ingestion, remote hosting, authentication, search/filtering, schema migrations, or database.

The difficult fixture under `examples/difficult` exercises branches, a merge with data-owned lane identity, rejected and abandoned paths, a revert, later-disproved knowledge, revisions, blockers, subordinate critic iterations, multiple evidence types, and a ground-truth patch.

Human orientation remains an explicit release gate. Run the tracked [five-participant orientation study](docs/usability/orientation-study.md); it has not yet been executed for this initial implementation, and automated browser checks must not be reported as human-study results.
