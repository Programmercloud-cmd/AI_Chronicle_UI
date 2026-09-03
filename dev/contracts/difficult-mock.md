# Component contract: difficult-mock

## Purpose

Provide portable data-only canonical and adversarial Chronicle histories that expose schema, layout, evidence, and comprehension defects before use on a real project.

## Inputs

- `docs/schema/v1-public-contract.md`
- Canonical topology and difficult-scenario requirements in the approved implementation plan.

## Outputs

- `examples/canonical/`
- `examples/difficult/`
- Exact local artifacts and matching SHA-256 values.

## Interfaces

- Each directory is a standalone Chronicle dataset using only public v1 files.
- No fixture-specific application configuration or hard-coded UI coordinates.

## Assumptions

- Structural validation is available before component acceptance.
- Full semantic validation is required before final integration acceptance.

## Non-goals

- Production source, schemas, tests, application logic, or generated UI.

## Failure behavior

- Missing references, hash mismatches, invalid topology, or a patch that does not apply block acceptance.

## Tests and evidence

- Structural/runtime validation when available.
- Hash verification and clean application of the substantial patch to its included base.
- Topology inventory proving canonical and difficult requirements.

## Acceptance criteria

- Canonical upper/lower/current/future topology is data-driven across April-June 2026.
- Difficult history includes all required branch, merge, reject, abandon, revert, disproval, engineering-event, blocker, supersession, and evidence cases.
- Artifacts are real local bytes with correct hashes; the substantial diff applies to the included base.
- Independent critic returns ACCEPT after runtime and semantic validators are available.
