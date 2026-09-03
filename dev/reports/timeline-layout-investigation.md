# Timeline layout investigation

Status: investigator recommendation for the future `timeline-layout` component. This report is local process material. Promote accepted decisions into tracked contracts, source, and tests before implementation acceptance.

## Recommendation

Implement the History layout as a pure TypeScript projection with no DOM, SVG, React, browser state, graph-layout engine, or persisted coordinates. The function consumes a semantically validated Chronicle snapshot plus an internal token set and returns complete geometry and accessibility metadata. The renderer draws that result without recomputing chronology, branch ownership, current state, projection membership, or month ranges.

Use a calendar-month baseline followed by deterministic constraint expansion:

1. Each calendar month receives the same nominal width.
2. Historical instants and dated roadmap items receive fractional positions within their project-local calendar month.
3. Month boundaries are first-class anchors.
4. Dense milestones and roadmap projection order add minimum-gap constraints.
5. When a constraint cannot fit, shift that anchor and every later anchor in display order by the exact missing distance.

This satisfies the public contract's compressed piecewise transform. It is chronological, calendar-aware, readable for dense periods, bounded for long gaps, and derived entirely from Chronicle data.

Do not add coordinates, colors, label angles, lane numbers, or month records to Chronicle YAML.

## Boundary and input contract

The layout must consume the output of the accepted revision/semantic validation layer, not raw YAML and not a merely shape-valid `ChronicleSnapshot`. Parent, branch, current, projection, revision, and timestamp semantics must already be valid.

Recommended interface:

```ts
export interface TimelineLayoutInput {
  displayTimeZone: string;
  branches: readonly TimelineBranchInput[];
  milestones: readonly TimelineMilestoneInput[];
  current?: TimelineCurrentInput;
  projection: readonly TimelineProjectionInput[];
}

export interface TimelineBranchInput {
  id: string;
  title: string;
}

export interface TimelineMilestoneInput {
  id: string;
  occurredAtIso: string;
  occurredAtEpochMs: number;
  title: string;
  summary: string;
  status: "accepted" | "rejected" | "abandoned" | "blocked" | "informational";
  branchId: string;
  parentIds: readonly string[];
  evidenceCount: number;
}

export interface TimelineCurrentInput {
  milestoneId: string;
  state: string;
}

export interface TimelineProjectionInput {
  id: string;
  title: string;
  status: "pending" | "active" | "blocked";
  branchId: string;
  plannedFor?: string; // authoritative YYYY-MM-DD, never rewritten
}

export type TimelineLayoutResult =
  | { ok: true; value: TimelineLayout }
  | { ok: false; diagnostics: readonly TimelineLayoutDiagnostic[] };
```

The accepted domain layer should preserve exact ISO text and parsed epoch milliseconds. Timeline code should not select between `occurred_at`, `recorded_at`, `updated_at`, or any other timestamp. Only `occurred_at` positions milestones. Current is the explicit pointer, never the rightmost accepted node.

The timezone/calendar helper is an internal dependency of the layout module. It must provide:

```ts
interface TimelineCalendar {
  monthKeyForInstant(epochMs: number, timeZone: string): string; // YYYY-MM
  monthStartEpochMs(monthKey: string, timeZone: string): number;
  nextMonthKey(monthKey: string): string;
  localNoonEpochMs(date: string, timeZone: string): number;
  formatMonth(monthKey: string): string;
}
```

Do not approximate IANA-local noon or month boundaries with the browser's timezone. The implementation may use a separately accepted timezone helper or library, but the layout algorithm depends only on this interface and remains deterministic in Node tests.

## Internal candidate tokens

These are application tokens, not data fields and not yet public API:

```ts
interface TimelineLayoutTokens {
  leftPadding: 56;
  rightPadding: 80;
  topPadding: 132;
  bottomPadding: 112;
  nominalMonthWidth: 144;
  minimumMilestoneGap: 176;
  minimumProjectionGap: 168;
  laneGap: 220;
  undatedSectionGap: 96;
  undatedItemGap: 168;
  labelTierGap: 28;
  labelAngleDegrees: -45;
  maximumVisibleTitleGraphemes: 36;
}
```

Keep tokens injectable in unit tests and centralized in application source. Do not accept them from Chronicle files. Visual gauntlet evidence may tune the candidate values without changing data semantics or the pure output contract.

## Anchor construction

### Historical anchors

- Parse milestones from the already validated epoch values.
- Sort historical milestones by `(occurredAtEpochMs, stable ID)`.
- Exact-instant ties remain independent nodes and use stable-ID order.
- Create one anchor per milestone. Current reuses its milestone anchor; it is not a second point.

### Dated projection anchors

- Use only the ordered items selected by `current.history_projection`, already supplied as `projection`.
- Map each `plannedFor` date to local noon using the project IANA timezone.
- Keep both the nominal epoch and authoritative stored month key.
- Preserve projection array order for equal dates.
- Never synthesize an `occurred_at`, modify `plannedFor`, or turn a roadmap item into a milestone.

### Month-boundary anchors

- Determine the first month from the earliest historical milestone.
- Determine the last dated month from the later of the latest historical milestone and latest dated projection item.
- Generate every intervening month key, including empty months and year transitions.
- Add a boundary at the start of the first month through the start of the month after the last dated month.
- An undated projection does not extend the month range.

### Empty history

If there are no milestones, return a valid empty layout with no lanes, edges, current node, or month bands. Unselected roadmap work does not appear. Do not invent a root or current state.

## Nominal compressed-time transform

Use an equal-width month scale rather than fully proportional milliseconds:

```text
monthOrdinal = integer month distance from the first month
fraction = (instant - localMonthStartInstant)
           / (nextLocalMonthStartInstant - localMonthStartInstant)
nominalX = leftPadding
           + monthOrdinal * nominalMonthWidth
           + clamp(fraction, 0, 1) * nominalMonthWidth
```

This keeps each month recognizable, respects actual DST-adjusted month instants, and gives these useful bounds before density expansion:

- one week: roughly one quarter of a month width;
- one month: 144 px;
- six months: 864 px;
- two years: 3456 px.

The scale deliberately does not claim that pixel distance is a precise elapsed duration. Exact timestamps remain in node metadata and detail surfaces.

## Display ordering and same-date clamp

Start with month boundaries and historical milestones sorted by nominal instant. At an exact instant, order:

1. the month boundary;
2. historical milestones by stable ID;
3. dated projection items by declared projection order.

Insert dated projected items one at a time:

1. Find the insertion point implied by project-local noon.
2. Find the position immediately after its current/preceding projected item.
3. Insert at the later of those two positions.

This is the presentation clamp required by the public contract. Example: current occurred at `2026-05-05T14:30:52+02:00` and the first projected item is planned for `2026-05-05`, whose nominal local-noon instant is earlier. The projected anchor is inserted immediately after current, while its stored month membership remains May.

Because selected dates cannot precede the current local date and are nondecreasing, insertion is deterministic and acyclic. Historical milestone order never changes.

## Constraint expansion

Walk the final dated display order once from left to right. Maintain a cumulative suffix shift.

For each anchor:

```text
x = max(previousAnchorX, nominalX + cumulativeShift)
requiredX = x

if historical milestone:
  requiredX = max(requiredX, previousHistoricalMilestoneX + minimumMilestoneGap)

if projected item:
  requiredX = max(requiredX, precedingCurrentOrProjectionX + minimumProjectionGap)

if requiredX > x:
  delta = requiredX - x
  x = requiredX
  cumulativeShift += delta
```

The increased cumulative shift applies to every later display anchor, including later month boundaries. Therefore:

- dense historical nodes expand their occupied month instead of overlapping;
- month bands remain aligned to the same piecewise transform;
- equal-instant milestones remain ordered and individually interactive;
- a same-date roadmap node can be placed after current without rewriting its date;
- subsequent month boundaries move when the clamp needs additional room.

Never move a historical milestone backward, reorder historical milestones, or derive order from computed pixels.

## Undated plan region

After completing all dated anchors:

```text
undatedDividerX = datedLayoutRight + undatedSectionGap
firstUndatedX = undatedDividerX + undatedSectionGap
nextUndatedX = previousUndatedX + undatedItemGap
```

- Keep undated items in declared projection order.
- Place them on the current milestone's branch lane.
- Add an `UNDATED PLAN` zone and divider.
- Stop month bands at the last dated boundary; undated nodes have no month membership.
- If all projection items are undated, the gray projection edge leaves current and crosses the undated divider before the first item.

## Branch lanes

Derive branch order exactly as the public contract supports:

1. For each branch, find its first milestone by `(occurredAtEpochMs, milestone ID)`.
2. Sort branches by `(first milestone instant, branch ID)`.
3. Assign lane indices `0..n-1` in that order.
4. `laneY = topPadding + laneIndex * laneGap`.

Do not persist a lane, infer ownership from edges, or reuse a lane for another branch in v1. A branch keeps one lane for the entire graph. This gives the canonical original branch lane 0 and timing branch lane 1.

Return a style ordinal with the lane. The renderer can map ordinals to its internal palette and line-pattern sequence; branch ID and title remain the accessible identity. Current-state green treatment overlays node emphasis but does not change branch ownership or incoming historical edge style.

## Edge output

Create one edge for each declared milestone parent and one edge for each current/projection step.

```ts
interface TimelineEdgeLayout {
  id: string; // deterministic `${from}->${to}` plus duplicate-safe ordinal
  fromId: string;
  toId: string;
  kind: "continuation" | "branch-origin" | "merge" | "projection";
  owningBranchId: string;
  points: readonly [{ x: number; y: number }, { x: number; y: number }];
  accessibleLabel: string;
}
```

Historical edge rules:

- Parent and child on the same branch: `continuation`, straight horizontal segment.
- First milestone on a non-root branch and its first listed cross-branch parent: `branch-origin`, direct diagonal from the exact parent center to the exact child center.
- Any additional parent or cross-branch parent on a later branch milestone: `merge`, direct line from parent to child.
- A merge milestone stays on its declared branch lane. Incoming edges never transfer ownership.
- All edges render behind nodes. Parent timestamps are strictly earlier, so every historical edge moves rightward.

Projection edge rules:

- Current to first selected item and each selected item to the next are `projection` edges.
- They occupy the current branch lane and use a future-plan style key.
- A dated-to-undated transition crosses the `UNDATED PLAN` divider but remains the same semantic chain.

The reference's branch grammar is produced naturally: a direct diagonal leaves the older parent, then later same-branch continuation edges are horizontal.

## Labels and current-state callout

Layout uses deterministic text policy rather than DOM measurement:

- Segment by Unicode grapheme clusters.
- Display at most `maximumVisibleTitleGraphemes`; append an ellipsis when longer.
- Always return the full title separately.
- Use the reference's diagonal label angle.
- Resolve title/timestamp crowding by fixed label tiers and sides only; never move the node's X coordinate for measured browser text.
- Candidate lane policy: lane 0 historical titles above; subsequent lanes alternate below/above; projection titles above; current callout uses the side with the outermost free space.
- Timestamps use the friendly localized text supplied/formatted by the UI, while exact stored ISO text remains in accessibility metadata.

Recommended output fields:

```ts
interface TimelineNodeLayout {
  id: string;
  sourceKind: "milestone" | "roadmap";
  x: number;
  y: number;
  laneIndex: number;
  branchId: string;
  treatment: "historical" | "current" | "planned-dated" | "planned-undated";
  status: string;
  fullTitle: string;
  visibleTitle: string;
  titleWasTruncated: boolean;
  label: {
    side: "above" | "below";
    tier: number;
    angleDegrees: number;
  };
  exactTimestampIso?: string;
  plannedFor?: string;
  monthKey?: string;
  target: { kind: "milestone" | "roadmap"; id: string };
  accessibility: TimelineNodeAccessibility;
}
```

Current is the same milestone node with `treatment: "current"`, a stronger node size/style key, the literal `CURRENT STATE` label, exact milestone timestamp, and current-state summary. No `is_current` data field is needed.

Assign label tiers with a DOM-independent conservative interval calculation:

1. Estimate visible title width as `visible grapheme count * internal averageGraphemeWidth`.
2. Project that width onto X with `abs(cos(labelAngle))`, then add the internal label clearance.
3. Bucket labels by `(laneIndex, side)` and process them by `(x, source-kind order, stable ID)`.
4. Place each label in the lowest non-negative tier whose occupied X interval does not overlap that tier's previous interval plus clearance.
5. Increase layout bounds to include every emitted tier.

This does not claim typographic precision; the renderer still uses CSS overflow safeguards. It does guarantee stable placement, keeps long titles retrievable through full metadata, and prevents input order or browser font measurement from changing layout coordinates.

## Output contract

```ts
interface TimelineLayout {
  width: number;
  height: number;
  lanes: readonly TimelineLaneLayout[];
  nodes: readonly TimelineNodeLayout[];
  edges: readonly TimelineEdgeLayout[];
  monthBands: readonly TimelineMonthBand[];
  zones: readonly TimelineZone[];
  navigation: {
    startX?: number;
    currentX?: number;
    historyEndX?: number;
    fullEndX?: number;
  };
  readingOrder: readonly string[];
}

interface TimelineLaneLayout {
  branchId: string;
  branchTitle: string;
  laneIndex: number;
  y: number;
  styleOrdinal: number;
}

interface TimelineMonthBand {
  monthKey: string;
  label: string;
  xStart: number;
  xEnd: number;
  historicalNodeIds: readonly string[];
  datedProjectionIds: readonly string[];
}

interface TimelineZone {
  kind: "undated-plan";
  xStart: number;
  xEnd: number;
  label: "UNDATED PLAN";
}
```

Bounds include rotated-label tiers, the current callout, month bands, and padding. Width is not the viewport width. The view preserves this computed width and uses native horizontal overflow.

## Accessibility metadata

The layout should make the renderer mechanical:

```ts
interface TimelineNodeAccessibility {
  fullLabel: string;
  description: string;
  branchId: string;
  branchTitle: string;
  parentIds: readonly string[];
  childIds: readonly string[];
  evidenceCount?: number;
  exactTimestampIso?: string;
  plannedFor?: string;
  currentState?: string;
  positionInSet: number;
  setSize: number;
}
```

- Historical reading order is `(instant, stable ID)`; projections follow in declared order after the historical set, even when their dated X position visually interleaves.
- Every node's full title is available even when its visible label is shortened.
- Current is announced by text and metadata, not green alone.
- Planned nodes are announced as planned and dated/undated, not merely gray.
- Branch ID/title, parents, children, and status are available without interpreting color or geometry.
- Edges need not be separate focus targets because their relationships are present on the connected node metadata.
- Renderer behavior remains responsible for focusable links, focus/hover parity, Escape dismissal, visible focus rings, and contrast.

## Failure behavior

Return deterministic diagnostics and no partial graph when internal preconditions fail:

- non-finite epoch or computed coordinate;
- missing branch for a node;
- missing parent geometry;
- missing current node;
- projection branch differs from current branch;
- projection sequence cannot locate its predecessor;
- timezone helper cannot resolve a month boundary or local noon;
- impossible output such as `xEnd < xStart`.

Do not silently drop a node, edge, month, or plan item. Semantic-invalid datasets should normally be rejected before this function is called; layout diagnostics are a defensive boundary, not a second divergent validator.

## Required test vectors

### Canonical reference

- Eight milestone nodes: four `BR-MAIN`, four `BR-TIMING`.
- `TIM-001` derives its branch origin from `CORE-003` and has a diagonal branch-origin edge.
- `TIM-004` is current regardless of rightmost inference.
- Three selected roadmap nodes follow current on `BR-TIMING`.
- Bands include April, May, and June 2026 from data only.
- No coordinates, colors, or month labels come from fixture YAML.

### Same-date projection clamp

- Current occurs after local noon.
- First selected item has the same `planned_for` date.
- Projected X is at least `minimumProjectionGap` after current.
- The roadmap date remains unchanged and its month membership remains the stored month.
- A later month boundary shifts if necessary to contain the node.

### Dense week and dense month

- At least twelve milestones inside seven days, including same-instant independent IDs.
- All historical nodes remain in `(instant, ID)` order.
- Every adjacent historical node has at least `minimumMilestoneGap`.
- The occupied month expands; subsequent month boundaries remain aligned.
- No node is omitted or clustered.

### Six-month and two-year gaps

- Generate every empty month band.
- Six nominal months consume `6 * nominalMonthWidth` before constraints.
- Two nominal years consume `24 * nominalMonthWidth` before constraints.
- Long gaps remain visibly longer than adjacent days but do not use millisecond-proportional width.

### Merge ownership

- Use difficult fixture `REC-002` with parents `REC-001` and `CORE-005`.
- Node remains on `BR-RECOVERY` lane.
- Same-branch parent edge is a continuation.
- Cross-branch parent edge is a merge.
- Incoming mainline ancestry does not change subsequent lane ownership.

### Long labels

- Include ASCII, combining marks, and emoji beyond the visible grapheme limit.
- Visible title shortens deterministically at a grapheme boundary.
- Full title remains in accessibility metadata.
- Label tier changes never alter node coordinates.

### Undated plan

- Dated selected items appear first.
- Undated items follow in declared order after the divider.
- Month bands stop at the final dated boundary.
- Undated items expose no fake date or timestamp.

### Current not rightmost

- A later rejected historical milestone lies to the right of the explicit current milestone.
- Current treatment remains on the referenced node.
- Projection remains chained from current; no rightmost-node inference occurs.

### Determinism

- Shuffle input branch and milestone arrays repeatedly.
- Serialized layout output remains byte-identical.
- Changing viewport width does not change graph geometry; only the renderer's scroll/fit behavior changes.

## Library decision

Do not use ELK, Dagre, React Flow, or a force layout for v1. Those tools solve topology placement and can violate the required chronological X axis. The branch geometry here is a stable lane assignment plus straight segments.

A focused time/calendar dependency may be justified for correct IANA timezone conversion, but rendering and coordinate generation need no graph library and no D3 dependency. If D3 utilities are already selected elsewhere, they may format labels, but they must not become a second source of coordinates or state.

## Acceptance evidence for the future component

- Pure unit tests for every vector above.
- Serialized canonical and difficult coordinate fixtures.
- Proven parent-right-of-child impossibility after layout.
- Proven exact month-band/node transform alignment.
- Determinism under shuffled input arrays.
- Performance characterization at 250 milestones, 12 branches, five years, and 30 projected items.
- Independent critic confirmation that implementation contains no DOM access, persisted layout state, hidden fallbacks, or fixture-specific coordinates.
