# Component contract: revision-semantic-validator

## Purpose

Project guarded append-only revisions and validate a loaded Chronicle snapshot as one coherent historical graph.

## Inputs

- Structurally valid sourced snapshot from `src/data`.
- Accepted public contract and structural record types.

## Outputs

- Immutable normalized snapshot containing projected historical records, original records, and visible amendment metadata.
- Deterministic source-aware semantic diagnostics; no usable snapshot on error.

## Interfaces

- Build one linear revision chain per target from `previous_revision`; apply guarded add/replace/remove atomically to cloned parsed values; revalidate each projected shape.
- Validate IDs/filenames/references, times, milestone DAG, branch origins/ownership, relations, current pointer, explicit roadmap projection, roadmap graphs/supersession/blockers, evidence references, artifact existence/containment/hash, and diff evidence type/source.
- Stable ordering never depends on filesystem enumeration.

## Assumptions

- Loader already established root and safe artifact reading.
- No global cross-target revision replay order exists; validate each final projected target and the complete final graph.

## Non-goals

- UI layout, current/roadmap presentation resolution, server/CLI behavior, artifact rendering, mutation, or migrations.

## Failure behavior

- Reject broken/forked/cyclic revision chains, failed guards/pointers, prohibited immutable-field changes, invalid projected shapes, unresolved refs, cycles, chronology violations, contradictory branches/projections, unsafe/missing/hash-mismatched artifacts.
- Return sorted actionable diagnostics and no partial normalized snapshot.

## Tests

- Guarded operation/JSON Pointer unit matrix and atomic failure.
- Every cross-record invariant plus self/cycle/chronology/branch merge/revert/projection/supersession/blocker/evidence adversaries.
- Canonical and difficult examples pass, revision remains visible, actual hashes verified.

## Acceptance criteria

- Both example datasets normalize successfully and all adversarial fixtures fail for intended reasons.
- Historical conclusions cannot be silently rewritten; revisions are visible and limited to permitted capture corrections.
- Graph and branch semantics exactly follow the public contract.
- No presentation/server/CLI logic leaks in.
- Full checks pass and independent critic returns ACCEPT.
