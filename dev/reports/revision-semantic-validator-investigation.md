# Revision and semantic validator investigation

Status: investigation evidence only. This is not an implementation contract or critic acceptance.

Normative source: `docs/schema/v1-public-contract.md`, especially sections 4-11. The existing runtime-schema and safe-loader components should remain separate: structural validation happens per parsed record, the loader returns a complete source-aware collection and safe artifact access, and this component applies revisions plus cross-record semantics. It must not reparse YAML or reimplement filesystem containment.

## Recommended boundary

Input is one complete, structurally valid loader result containing original records, source metadata, and the loader's safe artifact locator/reader. Output is either:

- a complete validated projection containing projected historical records, immutable originals, ordered amendment metadata, and deterministic warnings; or
- deterministic diagnostics and no usable partial snapshot.

The validator must never mutate loader-owned values. Deep-copy only the three revisable target kinds (`branch`, `milestone`, `engineering_event`); `current`, `roadmap`, `evidence`, and `project` remain direct semantic inputs because v1 revisions cannot target them.

## Minimal deterministic projection algorithm

1. **Index originals.** Build exact typed indexes for every record namespace and an exact revision-ID index. Preserve source paths. Reject duplicate IDs before resolving any link. Do not use case-insensitive lookup or infer a target type from an ID.
2. **Build revision chains without applying them.** Resolve every target by the declared `{type,id}`. Resolve each non-null `previous_revision`; it must target the same typed record. For each target require one linear chain: exactly one null predecessor, every other revision has exactly one predecessor, no predecessor has two children, all revisions are reachable from the head, and no cycle exists. Derive order from links, never filenames, input order, or timestamps.
3. **Validate chain time.** For milestone/event targets, the head revision is no earlier than the original target `recorded_at`. Branch heads have no target-time comparison. Every child is strictly later than its declared predecessor. Equal instants fail even when their textual offsets differ.
4. **Stage one revision atomically.** Clone the preceding target projection, apply its changes in listed order with the guarded JSON Pointer rules below, then run `validateRecordShape(targetType, stagedValue)`. Commit the staged target only if every operation and the resulting record shape pass. Retain before/after values for amendment presentation. Never expose the staging value on failure.
5. **Project every target chain.** Independent target chains can be processed in deterministic `(target.type,target.id)` order because they do not write other targets. This processing order has no semantic meaning.
6. **Validate the complete projected dataset.** Run the post-projection phases below over projected branches/milestones/events and unchanged current/roadmap/evidence/project records. Errors fail the entire result; warnings accompany a valid result.
7. **Freeze or defensively copy the result.** Consumers receive the validated projection, not references through which they can mutate validator state.

The contract defines chain order within a target but no global order between different targets. Therefore v1 should validate each revision's resulting **record shape**, then validate cross-record/graph semantics once over the complete final projection. It should not invent a global revision replay order. The phrase "no revision creates an otherwise invalid ... graph" is best enforced as "the complete projected graph is valid"; if product intent is to make every historical cross-target prefix queryable, that needs a new explicit global ordering rule and is outside this minimal component.

## Guarded JSON Pointer behavior

Use a small RFC 6901 object-property resolver rather than a general JSON Patch library; the v1 operations intentionally differ from RFC 6902 and arrays are whole-value only.

- Require the structurally valid non-root pointer supplied by the revision schema. Split on `/`, then decode each token exactly: `~1` becomes `/` and `~0` becomes `~`. Reject every other `~` escape.
- Traverse own object properties only (`Object.hasOwn` semantics), never prototypes. An intermediate container must already exist and must be an object. Do not create missing parents.
- Reject traversal into an array and reject a final array index or `-` append token. A pointer may name an array-valued **property**, allowing guarded replacement/removal of the whole array.
- Protect `/id`, `/schema_version`, and the original `/recorded_at`. These root fields cannot be added, replaced, or removed. No identity-based exception or "same value" replacement is allowed.
- Treat absence distinctly from a present `null` or `undefined`-like value. Parsed Chronicle data should contain only JSON-compatible values, so an own-property presence check is sufficient.
- `add`: final property must be absent and `value` is deep-copied into it.
- `replace`: final property must be present and its current value must deep-equal `from`; replace it with a deep copy of `value`.
- `remove`: final property must be present and its current value must deep-equal `from`; delete the property so it is absent, not null.
- Deep equality is type-sensitive, array-order-sensitive, and object-key-order-insensitive. Never coerce dates, numbers, booleans, or strings. Missing and null differ.
- Values and paths such as `__proto__`, `prototype`, and `constructor` must not be able to mutate a prototype. Null-prototype staging objects plus own-property definition are the safest simple implementation. Final structural validation will reject unknown schema members, but that is too late to be the prototype-pollution defense.
- A failure in change `n` discards successful changes `0..n-1` for that revision. Later revisions are not attempted for that target.

The difficult fixture exercises a valid nested add: `REV-000001` adds `/details/known_limitations` to `CORE-002`, whose `details` object already exists. Adding the same nested path when `details` is absent must fail; callers must add `/details` as a whole instead.

## Chain and operation diagnostics

Diagnostics should carry stable machine fields plus an actionable message:

- phase/code;
- revision ID and revision source path;
- typed target ID and target source path when resolved;
- related revision ID/source for predecessor, fork, or time errors;
- zero-based change index and JSON Pointer for operation errors;
- structural `instancePath` or semantic relation path;
- bounded expected/actual values for guard failures.

Report all safely discoverable independent errors, but do not apply a chain whose topology or timestamp order is invalid. Sort diagnostics deterministically by phase, source path, record ID, instance path/change index, then code. Do not silently choose a head, discard a fork, reorder by timestamp, or continue from a failed revision.

Useful chain codes include missing/wrong-type target, missing predecessor, predecessor targets another record, multiple heads, fork, cycle, unreachable revision, head-before-target, and non-increasing timestamp. Useful operation codes include malformed pointer, protected path, array addressing, missing parent, add-present, replace/remove-absent, guard mismatch, unsafe property, and projected-shape-invalid.

## Post-projection invariant phases

Run these in the public contract's order so downstream diagnostics do not depend on invalid upstream assumptions.

### 1. Identity, namespace, and references

- IDs remain protected and match loader filenames; all namespace-specific references resolve exactly.
- Historical, current, roadmap, evidence, code-diff, blocker, and revision targets use the declared namespace.
- Revisions can change ordinary reference fields, so resolution must use projected records.

### 2. Historical and revision time

- Each projected milestone/event has `recorded_at >= occurred_at` by instant.
- Revision head/child timestamp rules remain valid as described above.

### 3. Milestone ancestry

- Parent IDs are unique, resolve, are not self, and are strictly earlier than the child by `occurred_at` instant.
- The parent graph is acyclic. Equal occurrence instants cannot be parent/child even when IDs provide a stable display tie-break.

### 4. Branch ownership and derived origins

- Every milestone owns exactly one resolving `branch_id`; every accepted branch record owns at least one projected milestone.
- Determine each branch's first milestone by `(occurred_at instant, milestone ID)`.
- A first milestone with no parents is a root. Otherwise it has a cross-branch parent, and the first such entry in its preserved parent-array order is the derived origin. There is no `forked_from` metadata.
- A non-first continuation/merge remains on its explicit branch. A merge into an existing branch has at least one same-branch parent; incoming parents never transfer ownership.

Disconnected historical roots are a warning, not an error.

### 5. Historical relations

- Relation targets resolve, are not self, and strictly predate the declaring milestone.
- Reject duplicate `(type,target)` pairs within a milestone. Relations explain meaning and never satisfy ancestry requirements.

### 6. Current state

- If present, `current.milestone_id` resolves to a projected milestone whose recorded status is `accepted`.
- The milestone occurred no later than `current.updated_at`. Current is explicit; never derive it from the rightmost node.

### 7. History projection

- IDs are unique and selected only by `current.history_projection`; unselected roadmap items never appear on History.
- First selected item follows the current milestone; each later item follows the immediately preceding selected roadmap item with the correct typed reference.
- Selected status is pending/active/blocked, `branch_id` exists and equals the current milestone's branch.
- Dated selected items precede undated items; dates are nondecreasing and not before the current milestone's project-local calendar date.

### 8-9. Roadmap

- Item IDs are unique. `parent_id`, typed `follows`, `blocked_by`, related milestones, and `superseded_by` resolve.
- Parent, follows, and roadmap-to-roadmap blocker graphs are independently acyclic. A milestone blocker is a leaf reference, not a roadmap graph edge.
- A blocked item has a non-empty `blocker_summary`; `blocked_by`, if present, is non-empty.
- `superseded_by` exists if and only if status is `superseded`, is not self, and the supersession graph is acyclic.
- `(order, ID)` is display ordering only and must not be mistaken for any dependency edge.

### 10-11. Evidence and actual diffs

- Every milestone/event evidence ID and every code-change diff ID resolves.
- Delegate artifact opening to the loader's safe locator/reader so containment, symlink resolution, regular-file checks, content-signature checks, and race-aware behavior stay in one boundary. Verify the bytes delivered by that boundary against the declared SHA-256; never hash a separately reopened raw path.
- Inline media must pass the explicit media-type allowlist and content-signature checks; other evidence is attachment-only.
- External URL/repository evidence is never fetched by this validator. Unavailable or unpinned external evidence produces the contract warning where applicable.
- Every `code_changes.diff_evidence_id` is kind `diff` and artifact-backed. Commentary cannot make a URL-only or synthesized diff valid.

### 12. Projection closure

- Each target has the single valid guarded chain described above.
- Every projected target passes its runtime shape and the complete dataset passes all semantic phases. Original values and revision metadata remain available for audit.

## Adversarial test matrix

### Chain topology and time

- Shuffled loader order projects identically; filenames and timestamps do not override predecessor links.
- Missing target, target ID in the wrong namespace, missing predecessor, predecessor from another target.
- Two null heads, forked predecessor, pure cycle with no head, cycle after a head, and disconnected/unreachable chain member.
- Milestone/event head before target `recorded_at`; branch head accepted without that comparison; equal or decreasing child timestamp rejected.
- Same instant expressed with different timezone offsets compares as equal and fails strict child ordering.

### Pointer and guard behavior

- Add existing property; replace/remove absent property; missing intermediate container.
- Guard differs only by scalar type, array order, nested object value, or null-versus-absent.
- Earlier operation changes a value used by a later guard, proving listed-order evaluation.
- First operation succeeds and second fails, proving atomic rollback and no leaked partial projection.
- Whole-array replacement succeeds; `/parents/0`, `/parents/-`, and traversal through any array fail.
- Escaped property tokens (`~0`, `~1`) decode correctly; malformed escapes fail.
- Root/protected-field changes fail even if replacement is identical.
- `__proto__`/`constructor` payloads cannot pollute global or staged prototypes.
- A revision adding an unknown member or wrong-shaped allowed member fails projected structural validation.

### Final semantic closure

- A revision creates a missing parent, self-parent, equal/later parent, or ancestry cycle.
- A revision changes occurrence time and thereby invalidates a parent or relation that was previously valid.
- A revision changes branch ownership so a branch becomes empty, a derived origin disappears, or a non-first merge has no same-branch parent.
- A revision introduces duplicate/self/non-predating relations.
- A revised accepted current milestone becomes non-accepted or occurs after `current.updated_at`.
- Projection has wrong first/next `follows`, wrong status/branch, dated-after-undated, decreasing date, or pre-current local date.
- Roadmap parent/follows/blocker/supersession cycles and invalid superseded iff semantics.
- Revised evidence references do not resolve; code commentary points to non-diff or URL-only evidence; artifact hash/content signature fails.
- Engineering-event evidence/milestone links resolve; a later-than-linked event produces the specified warning, not an error.
- Completed roadmap item without a related milestone and disconnected roots produce warnings while preserving a valid snapshot.

### Positive regression

- Project the difficult dataset's `REV-000001`; `CORE-002.details.known_limitations` appears in the projection, the original remains byte-for-byte/value-equivalent to its loaded form, amendment metadata identifies the revision and before/after state, and the whole difficult dataset remains semantically valid.
- A dataset with no revisions produces semantically equal historical records without sharing mutable validator state.

## Risks and decisions to keep explicit

- **No cross-target replay history in v1.** Only per-target chains and the final global projection are defined. Do not make acceptance depend on an arbitrary target-processing order.
- **No partial recovery.** Returning a "mostly valid" graph creates hidden fallbacks and can misstate current/history. Fail closed.
- **No duplicate filesystem logic.** Semantic code consumes the loader's safe artifact capability; otherwise path and symlink rules will drift.
- **No generic patch semantics.** JSON Patch array insertion, move/copy/test, automatic parent creation, or loose equality would violate the public contract.
- **Bound diagnostic values.** Guard values may include large content; diagnostics should identify the mismatch without dumping artifacts or untrusted payloads.
