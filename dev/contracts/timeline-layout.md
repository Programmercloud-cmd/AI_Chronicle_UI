# Component contract: timeline-layout

## Purpose

Produce a pure DOM-independent History layout from a validated snapshot using a chronology-preserving compressed time scale and explicit branch lanes.

## Inputs and outputs

- Input: milestones, branches, current pointer, explicit projected roadmap chain, timezone, internal presentation tokens.
- Output: node/edge/lane coordinates, month bands, label tiers/truncation metadata, current/future/undated regions, full accessible labels, and extents.

## Invariants

- X order follows authoritative chronology; distance is readability-adjusted and never claimed proportional.
- One shared piecewise transform maps historical timestamps, month boundaries, and dated projections; same-date future nodes clamp after predecessors while retain date month membership.
- `branch_id` alone selects lanes; parent edges express ancestry; merges never move nodes or create branches.
- Undated projected items follow an `UNDATED PLAN` boundary and do not extend month bands.

## Non-goals

- DOM/SVG/React, input validation, zoom/pan, persistence, or public layout data.

## Tests and acceptance

- Canonical topology plus dense week/month, 6-month/2-year gaps, older-parent fork, merges, abandoned path, multiple years, long labels, same/undated future items.
- Deterministic, accessible output; semantic critic confirms no false proportional implication; full checks and independent ACCEPT.
