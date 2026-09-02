# Project Chronicle

Project Chronicle is a reusable local viewer for portable software-project history. A Chronicle directory contains inspectable YAML records and evidence artifacts; the web UI is a deterministic, read-only projection of that data.

## Requirements

- Node.js 20.19 or newer
- Linux or Windows development machine
- Google Chrome for the tracked visual and packaged-browser release checks

## Install and run

Build and install the tested local tarball:

```text
npm install
npm run build
npm pack
npm install /path/to/project-chronicle-0.1.0.tgz
npx chronicle init /path/to/project/chronicle
npx chronicle validate /path/to/project/chronicle
npx chronicle serve /path/to/project/chronicle
```

The v1 package is intentionally marked private and is not published to the public npm registry. The tarball workflow above is the supported portable installation path.

`serve` binds only to `127.0.0.1` and defaults to port `4317`. Open the printed URL to view Current, History, Roadmap, and milestone details. The server reloads and validates the complete dataset for each snapshot request; it exposes no mutation API.

For repository development:

```text
npm install
npm run build
npm run check
npm run release:check
```

`release:check` runs schema/type drift checks, the clean production build, unit/component/integration tests, the reviewed History screenshot suite plus geometry/accessibility checks, a runtime-only tarball inspection, an unrelated-directory production install, installed CLI/HTTP smoke tests, and the packaged-browser CSP/accessibility flow.

## Chronicle directory

```text
chronicle/
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
