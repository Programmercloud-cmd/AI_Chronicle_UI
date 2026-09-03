# Component contract: loader-safe-filesystem

## Purpose

Load a conventional Chronicle directory into structurally validated records while making filesystem and YAML trust boundaries explicit and safe.

## Inputs

- Chronicle root path.
- Accepted structural schemas and `validateRecordShape(...)`.
- Conventional v1 directory/file names.

## Outputs

- Source-aware collection of project, optional current, roadmap, branches, milestones, engineering events, revisions, and evidence records.
- Safe artifact locator/reader metadata for later hashing/preview layers.
- Deterministic diagnostics rather than partial snapshots.

## Interfaces

- YAML 1.2 parsing rejects duplicate keys, aliases, merge keys, and custom tags.
- One-file-per-record directories accept `.yaml` only and filenames must equal record IDs.
- Path utilities reject empty, absolute, drive, UNC, backslash, dot-segment, traversal, case-collision, symlink/junction escape, and non-regular files.
- The loader performs structural validation only; unresolved references and graph semantics are later.

## Assumptions

- Root itself exists and is a directory.
- Residual TOCTOU risk on local filesystems is documented; reads re-check real containment and regular-file state as closely as Node permits.

## Non-goals

- Revision projection, cross-record validation, hashing policy enforcement, server response behavior, CLI, or UI.

## Failure behavior

- Fail closed with stable, source-aware diagnostics; never silently skip malformed files or select fallbacks.
- Do not return a usable partial snapshot when any load/shape/path error exists.

## Tests

- Complete valid fixture loading and deterministic ordering.
- Missing required files/directories, malformed YAML, duplicates/aliases/tags/merge keys, wrong extension/name, case collision.
- Absolute/drive/UNC/backslash/dot/traversal paths; symlink/junction escape and non-regular files where platform supports them.
- Source/path diagnostic assertions and no cross-record semantic checks.

## Acceptance criteria

- Canonical and difficult examples load structurally.
- All adversarial filesystem/YAML cases fail for the intended reason.
- Root containment uses resolved real paths and rejects escape.
- No semantic graph, revision, server, or UI logic leaks in.
- Full repository check passes and an independent critic returns ACCEPT.
