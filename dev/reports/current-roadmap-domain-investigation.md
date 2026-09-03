# Current and Roadmap presentation-domain investigation

Status: investigation support only. This is not an implementation contract or critic acceptance.

Normative sources are `docs/schema/v1-public-contract.md` sections 5-7 and the accepted revision/semantic-validator boundary. This component should be a pure presentation-domain adapter over an already validated normalized snapshot. It must not load files, apply revisions, resolve invalid graphs, localize dates, calculate History coordinates, or contain React/UI state.

## Minimal boundary

The smallest sufficient input is:

```ts
interface CurrentRoadmapDomainInput {
  current?: Readonly<CurrentRecord>;
  roadmap: Readonly<RoadmapRecord>;
  milestones: readonly Readonly<MilestoneRecord>[]; // projected records
}
```

The caller must supply projected milestone values from the accepted semantic validator, not loader originals. No branches, evidence, engineering events, revision records, filesystem handles, or layout data are needed. The semantic validator has already guaranteed unique IDs, resolving references, accepted current, roadmap DAGs, exact History projection, and valid timestamps.

A practical output remains plain framework-independent data:

```ts
interface CurrentRoadmapPresentation {
  current?: CurrentPresentation;
  roadmap: {
    updatedAt: string;
    outline: readonly RoadmapOutlineEntry[];
  };
  historyProjection: readonly ProjectedRoadmapItem[];
}

interface CurrentPresentation {
  updatedAt: string; // current.yaml freshness only
  milestone: {
    id: string;
    title: string;
    summary: string;
    status: MilestoneRecord["status"]; // remains recorded status
    branchId: string;
    occurredAt: string; // current-node/history timestamp
    recordedAt: string; // audit metadata, not graph position
    annotations: readonly HistoricalAnnotation[];
  };
  state: string;
  currentHypothesis?: string;
  activeWork: readonly string[];
  nextStep?: string;
  blocked: readonly ResolvedBlockerSummary[];
  relatedRoadmapItems: readonly RoadmapLink[];
}

interface RoadmapOutlineEntry {
  item: RoadmapItemPresentation;
  depth: number;
}

interface ProjectedRoadmapItem {
  item: RoadmapItemPresentation;
  projectionIndex: number;
  plannedFor?: string;
  occurredAt?: never;
}
```

`RoadmapItemPresentation` should retain the item's ID, title, status, order, optional parent ID, optional follows reference, optional branch ID, acceptance criteria, related milestone links, blocker summary and resolved blocker links, optional superseded target link, and authoritative `plannedFor` date. `RoadmapLink` and `MilestoneLink` need only ID, title, and recorded status. Preserve exact source strings; friendly formatting belongs to UI utilities.

Use `readonly` types and new arrays/objects so view code cannot mutate the normalized snapshot. Do not duplicate this output into a store: it is deterministic and cheap to recompute when a new snapshot arrives.

## Resolution algorithm

1. Index projected milestones and roadmap items by exact ID. This is lookup only, not validation.
2. Scan projected milestones once to build incoming historical annotations.
3. Convert roadmap items to presentation items, resolving only labels/status for typed links.
4. Build the deterministic roadmap outline from `parent_id`.
5. If `current` exists, resolve its explicitly named milestone and dashboard links.
6. Build the History future sequence solely by mapping `current.history_projection` in declared order. If current or the field is absent, return an empty sequence.

Complexity is linear apart from sibling sorting: `O(M + R log R)` time and `O(M + R)` space for `M` milestones and `R` roadmap items. No graph library or date library is warranted.

Because input is promised valid, an impossible missing ID or cycle indicates a programming/boundary violation. Fail fast with a clear invariant error; do not omit the item, choose a fallback, infer a current milestone, or repair ordering. Semantic diagnostics remain the validator's responsibility and should not be recreated here.

## Current timestamp semantics

Three values must remain distinct:

- `current.updated_at` is dashboard freshness and renders as "Last updated".
- The referenced milestone's `occurred_at` is the exact current-state node timestamp and History X-axis instant.
- The referenced milestone's `recorded_at` is audit metadata only.

`roadmap.updated_at` is the Roadmap plan's freshness and must not replace `current.updated_at`. A roadmap item's `planned_for` is date precision, never an occurrence timestamp. Projected roadmap items must not receive fabricated `occurredAt` values. Local-noon conversion and same-day presentation clamping belong to the later timeline-layout component.

The adapter must use `current.milestone_id` exactly. It must not choose the rightmost, latest accepted, relation-winning, or visually emphasized milestone. It also must not hide a valid current milestone merely because a later relation annotates it.

## Deterministic Roadmap outline and ordering

`parent_id` alone defines outline hierarchy. `follows` defines planned sequence and must never change indentation or parenthood.

For each parent bucket, including the root bucket, sort siblings by `(order ascending, ID ordinal ascending)`. Emit a depth-first pre-order flat outline so each item appears once and parents always precede descendants. A flat `{item, depth}` sequence is smaller and easier for accessible list/tree rendering than duplicating recursive item objects. If the UI later needs child counts, derive them without changing order.

Do not use YAML array order as a tie-break, and do not globally sort then lose hierarchy. Preserve declared ordering inside meaningful member arrays such as acceptance criteria, related milestones, and blockers. `order` is presentation order, not a dependency, completion sequence, or History projection selector.

All roadmap statuses remain visible: pending, active, completed, blocked, abandoned, and superseded. Do not prune abandoned/superseded items or derive roadmap status from linked milestones. A superseded roadmap item links to its declared `superseded_by` item; this is separate from milestone `supersedes` relations.

## Explicit History projection

History future nodes are exactly the ordered IDs in `current.history_projection`:

- preserve projection order even when `roadmap.order`, input array order, or `planned_for` would sort differently;
- include no item merely because it has `follows` or the current branch;
- retain item status and branch; do not reinterpret it as a milestone;
- expose `plannedFor` only when stored; undated items remain undated;
- do not calculate month bands, local-noon instants, clamped X positions, labels, or colors here.

The semantic validator guarantees the first selected item follows current, subsequent items follow their predecessor, selected statuses are pending/active/blocked, branches match current, and dated items precede undated items with nondecreasing dates. The domain adapter must preserve, not rediscover, that exact sequence.

## Incoming supersedes/disproves annotations

Recorded milestone status is historical truth and never changes to `superseded` or `disproved`. Present-day annotation is derived by scanning every projected milestone's relations:

- a source relation `{type: "supersedes", target}` adds `superseded-by` to the target;
- `{type: "disproves", target}` adds `disproved-by` to the target;
- `reverts_to` and `related_to` do not create either annotation.

Each annotation should carry `kind`, source milestone ID/title, source `occurredAt`, and the relation's explanation. Sort a target's annotations by `(source occurred_at instant, source milestone ID, relation kind)` so shuffled input cannot change output. Semantic validation already makes source later than target and rejects duplicate `(type,target)` relations from one source. Preserve multiple independent incoming annotations; do not collapse them to a boolean or invent precedence between superseded and disproved.

The Current milestone and milestone links from Roadmap may expose the same derived annotations when owner context benefits. A single shared annotation index prevents inconsistent derivation across views. The original milestone `status` remains alongside annotations so UI wording can say, for example, "Accepted at the time; disproved later."

## Link and blocker presentation

- Preserve `current.blocked` array order. Resolve each optional typed `blocked_by` entry to a small milestone/roadmap link while preserving its order.
- An absent `blocked_by` is a legitimate external blocker. Render the summary with an empty link list; never fabricate a Chronicle entity.
- Preserve `current.related_roadmap_items` order and resolve to small links.
- Preserve roadmap acceptance-criteria, related-milestone, and blocked-by order.
- `blocker_summary` belongs only to the roadmap item/current blocker that declares it; do not synthesize summaries from dependency titles.

## Adversarial unit cases

### Current

- `current` absent yields no Current presentation and an empty History projection while Roadmap still renders.
- `current.updated_at`, milestone `occurred_at`, milestone `recorded_at`, and `roadmap.updated_at` are four distinct values and appear in only their intended fields.
- The rightmost accepted milestone differs from `current.milestone_id`; the explicit pointer wins.
- Current has no optional arrays/strings: output uses empty arrays only where the presentation interface promises them and does not invent prose.
- Current has two blockers: one typed internal blocker and one summary-only external blocker; order and the empty external link list are preserved.
- `related_roadmap_items` order differs from roadmap order and remains declared order.

### Roadmap outline

- Input items are shuffled, children precede parents, and siblings share `order`; output is stable parent-first pre-order with ID tie-breaks.
- Three nesting levels produce depths 0/1/2 and every item appears exactly once.
- `follows` points to an item that is not `parent_id`; indentation follows only `parent_id`.
- A child's `order` is lower than its parent's; parent still appears before the child within the outline.
- Completed, abandoned, blocked, and superseded items all remain visible with their original status.
- Acceptance criteria, related milestones, and blocker arrays are not alphabetized or otherwise reordered.

### Projection

- Roadmap order is RM-001/RM-002/RM-003 but `history_projection` is RM-003/RM-001/RM-002; declared projection order wins.
- Several unselected items have a valid `follows` chain or matching branch; none leak into History.
- Dated and undated selected items retain exact date/absence and receive no occurrence timestamp.
- Empty or omitted `history_projection` yields an empty future sequence.

### Derived historical annotations

- An accepted target receives later `disproved-by` and `superseded-by` annotations while status remains `accepted`.
- Two later milestones annotate the same target; shuffled milestone input yields chronological/ID-stable annotations.
- A source with `reverts_to` or `related_to` does not add superseded/disproved state.
- A milestone that declares `supersedes` is not itself annotated; the relation direction is source to target.
- Projected revision changes to relations are reflected because input uses projected milestones, while loader originals are never consulted.

### Boundary behavior

- Inputs and nested arrays are unchanged after derivation; mutating returned arrays cannot mutate the normalized snapshot.
- Bypassing the semantic boundary with a missing referenced ID triggers an invariant failure, not silent omission or guessed content.
- Repeated calls with value-equivalent inputs return deeply equal presentation data independent of object identity and filesystem/YAML ordering.

## MVP non-goals and risks

- No date localization, relative-time wording, theme, icons, status colors, branch palette, timeline geometry, month bands, pan/scroll, or routing.
- No roadmap mutation, drag/drop ordering, persistence, or browser-state source of truth.
- No revalidation of references, projection eligibility, cycles, supersession rules, or chronology; duplicating validator semantics would drift.
- No synthetic "overall project status" derived from counts. Current state is author-authored and explicitly linked.
- Avoid returning whole milestone records inside every link; that duplicates large detail/evidence structures and encourages UI coupling. Small links plus stable IDs are sufficient.
- A recursive outline object is attractive but can duplicate or encourage mutation. The flat pre-order form with depth is the minimal v1 representation.
