# Component contract: current-roadmap-domain

## Purpose

Provide small pure presentation models for Current and Roadmap from an accepted validated Chronicle snapshot.

## Inputs

- `ValidatedChronicle` only.

## Outputs

- Current model preserving milestone `occurred_at`/`recorded_at` separately from `current.updated_at`.
- Deterministic parent-first Roadmap outline and explicit History projection.
- Resolved links/blockers and incoming supersedes/disproves annotations without rewriting recorded status.

## Non-goals

- Loading, validation, graph layout, React, server, or mutation.

## Failure behavior and tests

- Treat invalid normalized input as a programmer-boundary failure; never fabricate missing records/dates.
- Test ordering `(order, ID)`, nesting, timestamp separation, explicit projection, blocker/link resolution, incoming annotations, empty optionals.

## Acceptance

- Pure deterministic models answer Current/Roadmap UI needs with no duplicate canonical state; full checks and independent critic ACCEPT.
