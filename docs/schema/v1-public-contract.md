# Project Chronicle v1 public data contract

Status: public contract for the first implementation. This document is normative for v1. Executable schemas, loaders, CLI behavior, and UI code are separate components.

## 1. Design rules

Chronicle data is the source of truth. The UI is a deterministic projection of ordinary UTF-8 YAML and referenced files. A Chronicle directory must remain useful without the web application and must not depend on a browser database.

The v1 directory is conventional rather than configurable:

```text
chronicle/
|-- project.yaml
|-- current.yaml
|-- roadmap.yaml
|-- branches/
|   `-- BR-MAIN.yaml
|-- milestones/
|   `-- CORE-001.yaml
|-- engineering-events/
|   `-- EVT-000001.yaml
|-- revisions/
|   `-- REV-000001.yaml
`-- evidence/
    |-- records/
    |   `-- EVD-0001.yaml
    `-- artifacts/
        |-- diffs/
        |-- logs/
        |-- reports/
        `-- screenshots/
```

`project.yaml`, `current.yaml`, and `roadmap.yaml` are present-oriented documents and may be replaced intentionally. Branch, milestone, engineering-event, revision, and evidence records are one file per stable ID and append-only after acceptance. Evidence artifacts are immutable byte sequences. Generated indexes and caches are never authoritative.

YAML is parsed as YAML 1.2 with duplicate keys, aliases, custom tags, and merge keys rejected. Timestamps and dates must be quoted strings. Unknown fields are validation errors in v1; adding a field requires a schema-version change or an explicitly backward-compatible contract revision.

## 2. Common scalar rules

### IDs

| Record | Form | Example | Rationale |
| --- | --- | --- | --- |
| Project | lowercase slug | `canonical-mock` | Portable directory/project key. |
| Milestone | `<DOMAIN>-<NNN>` | `CORE-006`, `UI-002` | Short owner-facing references; the domain is descriptive only. |
| Branch | `BR-<SLUG>` | `BR-MAIN`, `BR-TIMING` | Branch identity does not depend on color. |
| Roadmap item | `RM-<NNN>` | `RM-004` | Separate namespace prevents roadmap/history conflation. |
| Evidence | `EVD-<NNNN>` | `EVD-0008` | Stable citation independent of its artifact path. |
| Engineering event | `EVT-<NNNNNN>` | `EVT-000014` | Compact internal identity; not shown on the primary timeline. |
| Revision | `REV-<NNNNNN>` | `REV-000003` | Auditable amendment identity. |

The exact v1 lexical policies are:

```text
project            ^[a-z0-9]+(?:-[a-z0-9]+)*$
milestone          ^(?!(?:BR|RM|EVD|EVT|REV)-)[A-Z][A-Z0-9]*-[0-9]{3,}$
branch             ^BR-[A-Z0-9]+(?:-[A-Z0-9]+)*$
roadmap            ^RM-[0-9]{3,}$
evidence           ^EVD-[0-9]{4,}$
engineering event  ^EVT-[0-9]{6,}$
revision           ^REV-[0-9]{6,}$
```

The reserved prefixes keep typed namespaces disjoint. V1 sets minimum numeric widths for readability but no arbitrary maximum domain or numeric length.

IDs contain ASCII only, are compared case-sensitively, and must also be unique after ASCII case-folding for cross-platform portability. A record filename must equal its ID plus `.yaml`. Numeric sequences may have gaps but an accepted ID is never renamed or reused. Allocation under concurrent editing must use exclusive file creation; collisions are resolved before acceptance.

### Timestamps and ordering

Historical timestamps are RFC 3339/ISO 8601 instants with seconds and an explicit numeric offset or `Z`, for example `2026-08-19T18:32:00+02:00`. Offsetless values and date-only historical values are invalid. Fractional seconds are permitted.

All historical comparisons use parsed instants. Deterministic milestone order is `(instant, stable ID)`; filesystem order and screen coordinates are never inputs. Independent records may share an instant. A parent and child milestone may not: every parent must be strictly earlier than its child so ancestry never points backward or vertically on the chronological axis.

History uses one chronology-preserving compressed piecewise time transform, not a fully proportional scale and not milestone-only spacing. Its anchor sequence contains historical milestone instants, calendar-month boundaries, and dated items selected by `current.history_projection`. Historical anchors retain chronological order. Dated roadmap anchors retain projection order and their stored calendar-month membership. A constraint pass applies readable minimum gaps; when a projected node's nominal position is not after its preceding current/projected node, it is presentation-clamped immediately after that predecessor and all later affected anchors and month boundaries shift through the same piecewise transform. Thus milestones, projected nodes, and month bands share one aligned transform while visible long gaps remain distinguishable. A dated projected item may extend the month-band range beyond the last milestone.

`roadmap.items[].planned_for` remains an authoritative date-precision string. For History layout only, local noon on that date in the project's IANA display timezone is its nominal anchor. The presentation clamp never alters or writes back that date. Month membership comes from the stored local date, not from the clamped X coordinate. A selected date may equal, but not precede, the current milestone's local calendar date; selected dates are nondecreasing. Equal dates, including a same-date first item whose nominal noon precedes the current milestone's exact time, remain in `history_projection` order through the clamp. Selected items without `planned_for` follow the dated portion in declared projection order under a distinct `UNDATED PLAN` region; they do not create or extend month bands.

### Paths and untrusted content

Treat every Chronicle dataset, YAML value, evidence file, patch, log, URL, and Markdown-like string as untrusted input.

- Artifact paths use `/`, are relative to the Chronicle root, and may not be empty, absolute, drive-qualified, UNC, or contain `.`/`..` segments.
- A `repository_ref.path` is a non-empty repository-relative POSIX locator with the same absolute/traversal prohibitions. It is displayed as metadata but is not resolved by the Chronicle server.
- A resolved local artifact, including every symlink target, must remain under the Chronicle root and be a regular file.
- The server never executes evidence, applies patches, expands HTML, follows local-file URLs, or interpolates record content into a shell command.
- Declared `media_type` is metadata, never proof of content safety.
- Inline preview is allowlisted to escaped UTF-8 bytes declared as `text/plain` or `text/x-diff`, and signature-validated bytes declared as `image/png`, `image/jpeg`, or `image/webp`. Text never becomes markup.
- HTML, SVG, media-type/content mismatches, malformed images, and unknown or active formats are download-only.
- Artifact downloads use `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, a safe application/octet-stream fallback, and an escaped filename.
- External URLs permit only `https` and `http`; the server links to them but does not fetch them.
- Repository references are descriptive locators. They do not authorize the server to read outside the Chronicle root.
- Artifact hashes cover exact bytes; newline normalization is not allowed before hashing.

## 3. Project metadata

`project.yaml` identifies the dataset and controls human-facing time localization.

| Field | Required | Type | v1 rationale |
| --- | --- | --- | --- |
| `schema_version` | yes | integer, exactly `1` | Selects this contract. |
| `project.id` | yes | project ID | Stable portable identity. |
| `project.title` | yes | non-empty single-line string | Human navigation label. |
| `project.description` | no | string | Brief context outside individual milestones. |
| `display.timezone` | yes | IANA timezone name | Deterministic friendly timestamps and month bands. |

```yaml
schema_version: 1
project:
  id: "canonical-mock"
  title: "Canonical Chronicle Mock"
  description: "Synthetic history used to validate Chronicle."
display:
  timezone: "Europe/Paris"
```

Locale, theme, branch colors, layout coordinates, and server settings are intentionally absent. They are application preferences, not history.

## 4. Branch records and ownership

Each file in `branches/` declares a human-readable development lineage.

| Field | Required | Type | v1 rationale |
| --- | --- | --- | --- |
| `schema_version` | yes | integer `1` | Contract version. |
| `id` | yes | branch ID | Accessible identity independent of color. |
| `title` | yes | non-empty single-line string | Human branch label. |
| `description` | no | string | Explains the intent of a non-obvious branch. |

```yaml
schema_version: 1
id: "BR-TIMING"
title: "Timing investigation"
description: "Alternative path forked from the regression milestone."
```

Branch origin is derived from milestones, not duplicated in a branch record. Every accepted branch record owns at least one milestone; a branch with zero milestones is invalid. For each branch, sort its milestones by `(occurred_at instant, milestone ID)`; the first is the branch's first milestone. If that milestone has no parents, the branch is a root. Otherwise, at least one listed parent must belong to another branch, and the first such parent in the `parents` array is the derived branch origin. Parent array order is therefore preserved and is significant only when choosing among multiple valid cross-branch origin candidates.

Branch color is assigned by the UI from deterministic branch order `(first milestone instant, branch ID)`. The palette starts orange, blue, red, green and repeats or adapts; color is never persisted as identity.

Every milestone owns exactly one `branch_id`. Ownership is explicit and is not guessed from parents:

- The first milestone on a root branch has no parents.
- The first milestone on a non-root branch has at least one cross-branch parent; the first listed cross-branch parent is its derived origin.
- A normal continuation keeps the declared branch even when it has additional causal parents.
- A merge milestone has two or more parents but still owns exactly one declared branch. A merge into an existing branch has a parent on that branch. A merge that is also the first milestone of a new branch derives that branch's origin from its first listed cross-branch parent.
- Incoming merge edges do not transfer branch ownership. Children independently declare their own branch.

These rules make merge rendering deterministic without inventing a "winning" parent. Branch abandonment or success is recorded by milestones; a mutable branch-status field is deliberately omitted.

## 5. Human milestones

One file in `milestones/` is one node on the primary History graph.

### Milestone admission policy

Only events that materially change a human's understanding of project state, direction, or validated knowledge belong on primary History. Create a milestone when at least one of these is true:

- a meaningful capability or component is accepted;
- a significant hypothesis is confirmed or disproved;
- a meaningful failure or root cause is discovered;
- an approach is rejected, abandoned, superseded, or reverted;
- development changes direction or creates a branch;
- an architectural or interface decision with downstream consequences is accepted;
- a benchmark or experiment changes what the project should do next;
- a major acceptance gate or roadmap phase completes; or
- the accepted project state materially changes.

Do not create a milestone merely because code or files changed, a commit was made, a developer iteration completed, a critic accepted or rejected an intermediate implementation, tests were added or run, refactoring or formatting occurred, or another experiment repeated an existing conclusion. Those activities normally become engineering events with related evidence. Evidence, critic iterations, test runs, and diffs remain subordinate detail. Only roadmap items explicitly selected by `current.history_projection` appear as future History nodes.

The orchestrator owns milestone promotion and asks: "Would a technical project owner need this event on the main timeline to understand where the project is, why it changed direction, or what important knowledge was gained?" If not, keep the event subordinate.

| Field | Required | Type | v1 rationale |
| --- | --- | --- | --- |
| `schema_version` | yes | integer `1` | Contract version. |
| `id` | yes | milestone ID | Stable owner-facing link. |
| `occurred_at` | yes | exact timestamp | Sole X-axis coordinate: when the milestone's claim became true. |
| `recorded_at` | yes | exact timestamp | Audit time; may be later than occurrence. |
| `title` | yes | single-line string | Sparse graph label. |
| `summary` | yes | single-line string | Hover/focus summary. |
| `branch_id` | yes | branch ID | Explicit visual and lineage ownership. |
| `parents` | yes | unique milestone-ID array | Development ancestry; empty only for roots. |
| `status` | yes | milestone status | Outcome as believed at recording time. |
| `relations` | no | relation array | Later semantic statements about older milestones. |
| `details` | no | milestone-detail object | Structured owner-oriented explanation. |
| `evidence` | no | unique evidence-ID array | Discoverable supporting material. |
| `code_changes` | no | code-commentary array | Explanation adjacent to actual diff evidence. |

Milestone statuses are `accepted`, `rejected`, `abandoned`, `blocked`, and `informational`. They describe the conclusion at that time and are never rewritten to `superseded`. The UI derives a present-day "superseded" or "disproved later" annotation from incoming later relations while retaining the original status.

Allowed relations are:

| Type | Direction and meaning |
| --- | --- |
| `supersedes` | This milestone replaces the target's approach or conclusion. |
| `disproves` | This milestone provides evidence against a belief recorded by the target. |
| `reverts_to` | This later milestone restores behavior/state represented by the older target. |
| `related_to` | Non-ancestral association with no stronger v1 semantic. |

Relation targets must predate the declaring milestone. Relations never substitute for `parents`: parents encode ancestry; relations explain meaning.

Every relation member requires exactly `type`, `target`, and a non-empty `explanation`. The explanation records what was replaced, disproved, restored, or associated instead of asking the UI to infer meaning from the edge alone.

`details` may contain `context` (string), and arrays of strings named `changed`, `unchanged`, `hypotheses`, `acceptance_criteria`, `results`, and `known_limitations`, plus `next_step` (string). Every member is optional. This finite vocabulary directly supports the milestone detail page without creating a generic document framework.

Each `code_changes` member requires `diff_evidence_id`, `why`, `previous_behavior`, and `new_behavior`; `risks` is an optional string array. Its evidence must be kind `diff` and contain an actual artifact. Commentary supplements, never replaces, the diff.

```yaml
schema_version: 1
id: "CORE-006"
occurred_at: "2026-05-05T14:30:52+02:00"
recorded_at: "2026-05-05T14:42:10+02:00"
title: "Timestamp fix accepted"
summary: "Replay continuity passed after timestamp normalization."
branch_id: "BR-TIMING"
parents:
  - "CORE-005"
status: "accepted"
relations:
  - type: "disproves"
    target: "CORE-003"
    explanation: "Instrumented replay showed executor pressure was not causal."
  - type: "supersedes"
    target: "CORE-004"
    explanation: "The prior fix treated a symptom rather than the source."
details:
  context: "The canonical replay repeatedly lost odometry continuity."
  changed:
    - "Normalize sensor timestamps before queue insertion."
  unchanged:
    - "Registration and map update behavior remain unchanged."
  hypotheses:
    - "LiDAR/IMU clock-domain mismatch caused queue inversion."
  acceptance_criteria:
    - "Ten canonical replays complete without timestamp inversion."
  results:
    - "10/10 replay runs passed."
  known_limitations:
    - "Only the canonical sensor profile has been tested."
  next_step: "Run the long-duration benchmark."
evidence:
  - "EVD-0007"
  - "EVD-0008"
code_changes:
  - diff_evidence_id: "EVD-0008"
    why: "Queue order depended on timestamps from different clock domains."
    previous_behavior: "Raw source timestamps were compared directly."
    new_behavior: "Timestamps are normalized before ordering."
    risks:
      - "Incorrect clock metadata could still select the wrong offset."
```

A revert is a new later milestone. Its parent is the state immediately preceding the revert and `reverts_to` points to the older restored state. Its timestamp and X position remain later; no record or coordinate moves backward.

## 6. Current state

`current.yaml` is a concise mutable projection. Its single pointer is the only current-state designation.

| Field | Required | Type | v1 rationale |
| --- | --- | --- | --- |
| `schema_version` | yes | integer `1` | Contract version. |
| `updated_at` | yes | exact timestamp | Freshness of this present-oriented summary. |
| `milestone_id` | yes | accepted milestone ID | Explicit current accepted state, not "rightmost node." |
| `state` | yes | string | Immediate answer to "where are we now?" |
| `current_hypothesis` | no | string | Current leading explanation, if any. |
| `active_work` | no | string array | Concise work in progress. |
| `next_step` | no | string | Immediate intended action. |
| `blocked` | no | blocker-summary array | Human-readable blockers with typed references. |
| `related_roadmap_items` | no | unique roadmap-ID array | Links the dashboard to forward work. |
| `history_projection` | no | ordered unique roadmap-ID array | Explicitly selects the muted future sequence shown on History. |

```yaml
schema_version: 1
updated_at: "2026-05-05T15:00:00+02:00"
milestone_id: "CORE-006"
state: "Stable timestamp handling accepted on canonical replay."
current_hypothesis: "Remaining long-run drift is unrelated to queue ordering."
active_work:
  - "Run the long-duration benchmark."
next_step: "Compare drift against the captured baseline."
blocked:
  - summary: "Release packaging waits for benchmark acceptance."
    blocked_by:
      - type: "roadmap"
        id: "RM-004"
related_roadmap_items:
  - "RM-004"
history_projection:
  - "RM-004"
  - "RM-005"
```

`updated_at` is not a milestone timestamp and is not plotted. The green current-state node uses the referenced milestone's `occurred_at`; the dashboard uses `updated_at` as its "last updated" value. Do not store `is_current` on milestones. A newly initialized empty dataset may omit `current.yaml`; a release-quality populated dataset has exactly one valid current pointer.

Current emphasis does not replace branch identity: the incoming/outgoing historical line keeps its deterministic branch styling, while the node adds a distinct green ring, `CURRENT STATE` text, and accessible state label.

Each `blocked` member requires `summary`. Its `blocked_by` array is optional so an external blocker does not require a fabricated Chronicle record; when present it is non-empty. Current and roadmap blocker references use `{type, id}`, where type is `milestone` or `roadmap` and the ID must match that namespace.

`history_projection` is the sole selection mechanism for future nodes on History. Its IDs are unique and ordered. The first selected item must `follow` the current `milestone_id`; every subsequent item must `follow` the immediately preceding selected roadmap item. Every selected item has status `pending`, `active`, or `blocked`, requires `branch_id`, and that branch must equal the current milestone's branch. Roadmap items not selected here remain Roadmap-only even if they have a `follows` relation.

## 7. Roadmap

`roadmap.yaml` is a mutable forward plan, not historical events.

| Field | Required | Type | v1 rationale |
| --- | --- | --- | --- |
| `schema_version` | yes | integer `1` | Contract version. |
| `updated_at` | yes | exact timestamp | Freshness of the plan. |
| `items` | yes | roadmap-item array | Ordered forward work. |
| `items[].id` | yes | roadmap ID | Stable links from current/history. |
| `items[].title` | yes | single-line string | Scannable plan label. |
| `items[].status` | yes | roadmap status | Current plan state. |
| `items[].order` | yes | integer | Primary deterministic sibling/default ordering key. |
| `items[].parent_id` | no | roadmap ID | Outline hierarchy only. |
| `items[].follows` | no | typed milestone/roadmap reference | Planned sequence shown after current on History. |
| `items[].branch_id` | no | branch ID | Intended branch when a future sequence is visualized. |
| `items[].acceptance_criteria` | no | string array | Defines completion before work begins. |
| `items[].related_milestones` | no | milestone-ID array | Connects completed or informed work to history. |
| `items[].blocker_summary` | no | non-empty string | Names a blocker, including one external to Chronicle. |
| `items[].blocked_by` | no | typed reference array | Explicit roadmap/milestone blockers. |
| `items[].superseded_by` | conditional | roadmap ID | Required exactly when status is `superseded`; absent otherwise. |
| `items[].planned_for` | no | quoted ISO date | Authoritative date precision; mapped to project-local noon for layout only. |

Statuses are `pending`, `active`, `completed`, `blocked`, `abandoned`, and `superseded`. `superseded_by` is present if and only if status is `superseded`; it is absent for every other status. `parent_id` expresses outline nesting; `follows` expresses planned sequence. They are deliberately separate. Default and sibling ordering is `(order, stable ID)`, so equal order values remain deterministic.

Only the pending, active, or blocked items explicitly selected by `current.history_projection` appear in the muted future continuation on History. They remain roadmap entities, use outlined/muted nodes, and never receive `occurred_at`. Selected items require a branch matching the current milestone. All unselected items are Roadmap-only. `planned_for` is not used as historical evidence or substituted for an exact milestone timestamp.

```yaml
schema_version: 1
updated_at: "2026-05-05T15:00:00+02:00"
items:
  - id: "RM-004"
    title: "Validate long-duration behavior"
    status: "active"
    order: 40
    follows:
      type: "milestone"
      id: "CORE-006"
    branch_id: "BR-TIMING"
    acceptance_criteria:
      - "Three two-hour runs complete within the drift budget."
    related_milestones:
      - "CORE-006"
    planned_for: "2026-06-10"
  - id: "RM-005"
    title: "Integrate benchmark reporting"
    status: "blocked"
    order: 50
    follows:
      type: "roadmap"
      id: "RM-004"
    branch_id: "BR-TIMING"
    acceptance_criteria:
      - "Benchmark output is linked as Chronicle evidence."
    blocker_summary: "Long-duration validation is not accepted."
    blocked_by:
      - type: "roadmap"
        id: "RM-004"
```

Significant roadmap decisions are also captured as a human milestone or `roadmap_change` engineering event, optionally with snapshot/diff evidence. This preserves the reason for a plan change even when `roadmap.yaml` is later replaced.

## 8. Evidence and diffs

Each evidence record describes one discoverable source. V1 supports three source forms.

| Source kind | Required fields | Behavior |
| --- | --- | --- |
| `artifact` | relative `path`, `media_type`, SHA-256 | Portable content under the Chronicle root; the only source the server reads/renders. |
| `url` | HTTP(S) `url` | External link; never fetched by the server. |
| `repository_ref` | repository-relative `path`, pinned `revision` | Descriptive source locator; never grants filesystem access. |

Common evidence fields are:

| Field | Required | Type | v1 rationale |
| --- | --- | --- | --- |
| `schema_version` | yes | integer `1` | Contract version. |
| `id` | yes | evidence ID | Stable milestone/event citation. |
| `captured_at` | yes | exact timestamp | When this evidence was produced or recorded. |
| `kind` | yes | evidence kind | Minimal rendering/discovery hint. |
| `title` | yes | single-line string | Human link label. |
| `description` | no | string | Explains relevance. |
| `source` | yes | exactly one source object | Location and trust boundary. |
| `origin` | no | exact provenance object | Non-executable tool/command/revision metadata. |

Evidence kinds are `test_output`, `benchmark`, `critic_report`, `screenshot`, `log`, `profile`, `experiment_report`, `diff`, `file`, and `other`.

When present, `origin` requires `tool` as a non-empty string. `command`, `base_revision`, and `target_revision` are optional non-empty strings; no other properties are allowed. Every value is display-only provenance. In particular, `command` is never executed or passed to a shell.

```yaml
schema_version: 1
id: "EVD-0008"
captured_at: "2026-05-05T14:28:11+02:00"
kind: "diff"
title: "Timestamp normalization patch"
description: "Exact patch reviewed and accepted for CORE-006."
source:
  kind: "artifact"
  path: "evidence/artifacts/diffs/CORE-006.patch"
  media_type: "text/x-diff"
  sha256: "53f3d9a6c2130000000000000000000000000000000000000000000000000000"
origin:
  tool: "git"
  command: "git diff --binary --full-index <base>..<head>"
  base_revision: "1111111111111111111111111111111111111111"
  target_revision: "2222222222222222222222222222222222222222"
```

The other evidence source shapes are deliberately small:

```yaml
source:
  kind: "url"
  url: "https://example.test/report/42"
```

```yaml
source:
  kind: "repository_ref"
  path: "src/timestamps/normalize.ts"
  revision: "2222222222222222222222222222222222222222"
```

For a significant code milestone, `code_changes` must reference an evidence record of kind `diff` whose source is an artifact. A captured patch is the portable ground truth; Git object IDs and the generating command are provenance. Git refs or an AI summary alone do not satisfy this requirement. Binary patches remain downloadable even when the text diff viewer cannot render them.

## 9. Engineering events

Engineering events preserve developer, critic, test, integration, and investigation activity without flooding the human timeline.

| Field | Required | Type | v1 rationale |
| --- | --- | --- | --- |
| `schema_version` | yes | integer `1` | Contract version. |
| `id` | yes | engineering-event ID | Stable supporting-detail identity. |
| `occurred_at` | yes | exact timestamp | Orders the underlying activity. |
| `recorded_at` | yes | exact timestamp | Audit time. |
| `milestone_id` | no | milestone ID | Groups iterations beneath one human milestone. |
| `kind` | yes | engineering-event kind | Concise activity classification. |
| `actor.type` | yes | `human`, `agent`, or `tool` | Identifies the source class without persona proliferation. |
| `actor.role` | no | string | Examples include developer, critic, integration, integration_critic, investigator. |
| `actor.label` | no | string | Human-readable run/iteration label. |
| `outcome` | yes | engineering outcome | Observable result. |
| `summary` | yes | string | Concise conclusion. |
| `details` | no | string | Actionable supporting explanation. |
| `evidence` | no | evidence-ID array | Tests, reports, logs, or patches. |

Kinds are `implementation`, `test`, `review`, `investigation`, `decision`, `integration`, and `roadmap_change`. Outcomes are `completed`, `passed`, `failed`, `accept`, `reject`, and `informational`.

```yaml
schema_version: 1
id: "EVT-000014"
occurred_at: "2026-05-05T13:48:00+02:00"
recorded_at: "2026-05-05T13:49:02+02:00"
milestone_id: "CORE-006"
kind: "review"
actor:
  type: "agent"
  role: "critic"
  label: "critic iteration 2"
outcome: "reject"
summary: "Rejected because the test covered only monotonic input."
details: "Add an out-of-order timestamp fixture and demonstrate stable queue order."
evidence:
  - "EVD-0006"
```

The primary History query loads milestones only. Engineering events are obtained through a reverse index on `milestone_id` for detail pages. Milestones do not duplicate an event-ID list. Events may be unlinked when an investigation never produces a milestone. Store conclusions and evidence, not private reasoning traces or raw chain-of-thought.

Milestone `occurred_at` is not derived mechanically from an event. It is the moment the human-facing milestone claim became true. For an acceptance milestone that will usually equal the accepting review event; implementation and test times remain separate engineering-event instants.

## 10. Revisions and historical integrity

Supported tooling creates historical files and artifacts with exclusive create semantics and refuses to overwrite them. Changed understanding is always a later milestone or engineering event, never a rewrite: an accepted hypothesis remains accepted-at-that-time even after a later `disproves` relation.

A revision is reserved for correcting or clarifying how a record was captured. It preserves the original file and makes the amendment visible.

| Field | Required | Type | v1 rationale |
| --- | --- | --- | --- |
| `schema_version` | yes | integer `1` | Contract version. |
| `id` | yes | revision ID | Stable audit entry. |
| `target.type` | yes | `branch`, `milestone`, or `engineering_event` | Restricts revisions to append-only historical records. |
| `target.id` | yes | matching target ID | Record being amended. |
| `recorded_at` | yes | exact timestamp | Amendment time. |
| `previous_revision` | yes | revision ID or `null` | Creates one deterministic chain per target. |
| `reason` | yes | revision reason | Distinguishes correction, clarification, late attachment. |
| `summary` | yes | string | Human explanation shown with the amendment. |
| `changes` | yes | non-empty guarded-change array | Auditable parsed-value changes. |

Reasons are `clerical_correction`, `clarification`, and `late_attachment`. Each change has a JSON Pointer `path` and one of three exact operations:

- `add` requires the path to be absent and supplies `value`; it fails if the path already exists.
- `replace` requires the path to be present, requires parsed `from` to equal its current value, and supplies the replacement `value`.
- `remove` requires the path to be present and requires parsed `from` to equal its current value; the resulting path is absent, which is distinct from a present `null` value.

Array elements are not addressed individually in v1; replace an array as a whole with a guarded `replace`. Operations run in listed order against the projection from the preceding revision. `id`, `schema_version`, and the original `recorded_at` cannot be revised.

```yaml
schema_version: 1
id: "REV-000003"
target:
  type: "milestone"
  id: "CORE-003"
recorded_at: "2026-05-07T09:12:00+02:00"
previous_revision: null
reason: "clerical_correction"
summary: "Correct the captured parent ID; the underlying event is unchanged."
changes:
  - operation: "replace"
    path: "/parents"
    from:
      - "CORE-001"
    value:
      - "CORE-002"
```

For milestone and engineering-event targets, the first revision's `recorded_at` must be no earlier than the target's `recorded_at`. Branch records intentionally have no timestamp, so their first revision has no target-time comparison. For every target type, each later revision must have `recorded_at` strictly after its `previous_revision`.

The core reader/validator, not the UI, applies a target's linear revision chain and validates the resulting projection. UI consumers receive the validated projected record plus amendment metadata sufficient to show original and revised values. A revision that changes a parent, timestamp, branch, status, or relation is allowed only for a genuine recording error and must still pass full graph validation. Later evidence that changes a conclusion requires a new event and semantic relation, even if a revision would be shorter.

V1 deliberately has no signed ledger or proprietary append-only database. Source control, create-only tooling, immutable artifact hashes, guarded revisions, and visible amendment history provide effective immutability without a custom integrity system. Manual in-place tampering outside source control remains a documented limitation.

## 11. Cross-record validation

A conforming validator reports structural errors first, then applies revisions and checks the complete projected dataset:

1. All IDs and filenames match, namespaces are correct, and references resolve.
2. Historical `recorded_at` is not earlier than `occurred_at`. Revision timestamp rules follow the target-specific rules above, including no target-time comparison for an untimestamped branch.
3. Parent IDs are unique, not self, strictly earlier, and form an acyclic directed graph.
4. Each milestone has exactly one valid `branch_id`, and every accepted branch owns at least one milestone. Each branch's first milestone is derived by `(occurred_at, ID)`; it is either a parentless root or has a first listed cross-branch parent that becomes its derived origin. Merge ownership follows the declared-branch rules above.
5. Relation targets resolve, are not self, predate the declaring milestone, and duplicate `(type, target)` pairs are rejected.
6. `current.milestone_id` resolves to a milestone whose recorded status is `accepted`, and that milestone occurred no later than `current.updated_at`.
7. `current.history_projection` has unique IDs and forms the exact follows-chain from current. Selected statuses and branches satisfy the projection rules; dated items precede undated items and have nondecreasing planned dates. Unselected items never enter History.
8. Roadmap `parent_id`, `follows`, `blocked_by`, and `superseded_by` references resolve. Parent, follows, and roadmap-to-roadmap blocker graphs are acyclic; default ordering is `(order, ID)`.
9. A blocked roadmap item has a non-empty `blocker_summary`; `blocked_by` is optional but non-empty if present. `superseded_by` is present if and only if status is `superseded`; that reference is not self and the supersession graph is acyclic.
10. Every evidence reference resolves; artifact files exist, remain inside the root after symlink resolution, and match SHA-256. Inline previews also pass the explicit media allowlist and content-signature checks; everything else is attachment-only.
11. Every `code_changes.diff_evidence_id` resolves to artifact-backed evidence of kind `diff`.
12. Each target has one revision chain; operation presence/absence guards match in order; no revision creates an otherwise invalid record or graph.

Warnings, rather than hard errors, cover an unusually long timeline title, completed roadmap work with no related milestone, an engineering event later than its linked milestone, unavailable/unpinned external evidence, and disconnected historical roots.

## 12. Canonical and difficult-scenario mapping

| Scenario | Contract representation |
| --- | --- |
| Four original milestones | Four milestones on `BR-MAIN`, each after the previous. |
| Branch from milestone 3 | The first `BR-TIMING` milestone has `CORE-003` as its first cross-branch parent and a later timestamp; origin is derived. |
| Four lower milestones | Four `BR-TIMING` milestones linked sequentially; branch ownership determines the parallel lane. |
| Fourth lower node is current | `current.milestone_id` points to that accepted milestone; no milestone flag or rightmost-node inference. |
| Three future nodes | Three roadmap items are named in ordered `current.history_projection` and form a valid `follows` chain beginning at current, with no `occurred_at`. |
| April/May/June bands | The shared compressed piecewise scale maps milestone instants, month boundaries, and dated projected items in the project timezone; undated plan nodes do not extend bands. |
| Rejected approach | A milestone with status `rejected`; its branch and descendants remain visible. |
| Abandoned approach | An `abandoned` milestone and optional explanatory relation; history is retained. |
| Revert | A later milestone with the previous active state as parent and `reverts_to` pointing at the older restored state. |
| Accepted hypothesis later disproved | Original accepted milestone remains unchanged; later milestone has `disproves` with evidence. |
| Substantial code diff | Artifact-backed diff evidence plus milestone `code_changes` commentary. |
| Several developer/critic iterations | Multiple `EVT-*` records share one `milestone_id`; only the milestone appears in primary History. |
| Roadmap change | Current `roadmap.yaml` changes; a milestone or `roadmap_change` event preserves the reason and optional snapshot evidence. |
| Blocked work | Roadmap `blocked` status plus `blocker_summary`; optional typed `blocked_by` links are used only for blockers represented in Chronicle. |
| Superseded milestone | A later milestone declares `supersedes`; original status and content remain available. |
| Multiple evidence types | Milestone/events reference separate evidence records for logs, reports, screenshots, benchmarks, and diffs. |
| Merge | Multi-parent milestone declares one explicit branch; incoming parent branches remain identifiable. |
| Long gaps/multiple years | Exact timestamps retain order on the chronology-preserving compressed scale, with month/year boundaries mapped by the same function. |

## 13. Explicit v1 exclusions

The public contract does not define UI coordinates, branch colors, month records, theme, hover state, generated indexes, database tables, authentication, remote synchronization, automatic Git mining, automatic diff reconstruction, arbitrary evidence plugins, or cryptographic signing. Those additions require demonstrated need and must not change the meaning of v1 records silently.
