import { createHash } from "node:crypto";

import { readContainedArtifact, type ChronicleSnapshot, type SourcedRecord } from "../data";
import type { EvidenceRecord, MilestoneRecord, RoadmapItem } from "../schema";
import { errorDiagnostic, sortDomainDiagnostics, warningDiagnostic } from "./diagnostics";
import { cloneJson } from "./json-pointer";
import { compareOrdinal } from "./ordinal";
import { projectRevisions } from "./revision-projection";
import type {
  ArtifactReader,
  DomainDiagnostic,
  DomainValidationResult,
  ProjectedRecord,
  ValidatedChronicle,
} from "./types";

export interface ValidateChronicleOptions { artifactReader?: ArtifactReader }

const instant = (value: string): number => Date.parse(value);

function indexUnique<T extends { id: string }>(
  records: SourcedRecord<T>[], phase: DomainDiagnostic["phase"], diagnostics: DomainDiagnostic[],
): Map<string, SourcedRecord<T>> {
  const index = new Map<string, SourcedRecord<T>>();
  for (const record of records) {
    const prior = index.get(record.value.id);
    if (prior !== undefined) diagnostics.push(errorDiagnostic(phase, "duplicate-id", record.sourcePath,
      `duplicate ID ${record.value.id}`, { recordId: record.value.id, relatedSourcePath: prior.sourcePath }));
    else index.set(record.value.id, record);
  }
  return index;
}

function findCycles(
  nodes: Iterable<string>, edges: (id: string) => Iterable<string>, onCycle: (id: string) => void,
): void {
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): void => {
    if (state.get(id) === 1) { onCycle(id); return; }
    if (state.get(id) === 2) return;
    state.set(id, 1);
    for (const next of [...edges(id)].sort(compareOrdinal)) visit(next);
    state.set(id, 2);
  };
  for (const id of [...nodes].sort(compareOrdinal)) visit(id);
}

function localDate(timestamp: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const defaultArtifactReader: ArtifactReader = async (snapshot, evidence) => {
  if (evidence.value.source.kind !== "artifact") return { ok: true, bytes: Buffer.alloc(0) };
  const read = await readContainedArtifact(
    { inputPath: snapshot.rootPath, realPath: snapshot.rootPath }, evidence.value.source.path, evidence.sourcePath,
  );
  if (read.ok) return { ok: true, bytes: read.value.bytes };
  return {
    ok: false,
    diagnostics: read.diagnostics.map((issue) => errorDiagnostic("evidence", `artifact-${issue.code}`, issue.sourcePath, issue.message,
      { recordId: evidence.value.id })),
  };
};

function referenceError(
  diagnostics: DomainDiagnostic[], phase: DomainDiagnostic["phase"], source: SourcedRecord<unknown>,
  code: string, target: string, instancePath: string,
): void {
  const value = source.value;
  const recordId = typeof value === "object" && value !== null && "id" in value && typeof value.id === "string"
    ? value.id : undefined;
  diagnostics.push(errorDiagnostic(phase, code, source.sourcePath, `referenced record ${target} does not exist`,
    { ...(recordId === undefined ? {} : { recordId }), relatedRecordId: target, instancePath }));
}

export async function validateChronicle(
  snapshot: ChronicleSnapshot, options: ValidateChronicleOptions = {},
): Promise<DomainValidationResult> {
  const diagnostics: DomainDiagnostic[] = [];

  // Identity is checked before revisions so every later lookup is unambiguous.
  indexUnique(snapshot.branches, "identity", diagnostics);
  indexUnique(snapshot.milestones, "identity", diagnostics);
  indexUnique(snapshot.engineeringEvents, "identity", diagnostics);
  indexUnique(snapshot.evidence, "identity", diagnostics);
  indexUnique(snapshot.revisions, "identity", diagnostics);
  const roadmapItems = snapshot.roadmap.value.items.map((value) => ({ sourcePath: snapshot.roadmap.sourcePath, value }));
  indexUnique(roadmapItems, "identity", diagnostics);
  if (diagnostics.some((item) => item.severity === "error")) return { ok: false, diagnostics: sortDomainDiagnostics(diagnostics) };

  const revisionResult = projectRevisions(snapshot);
  diagnostics.push(...revisionResult.diagnostics);
  if (revisionResult.projection === undefined) return { ok: false, diagnostics: sortDomainDiagnostics(diagnostics) };
  const branches = revisionResult.projection.branches;
  const milestones = revisionResult.projection.milestones;
  const events = revisionResult.projection.engineeringEvents;
  const branchIndex = new Map(branches.map((record) => [record.value.id, record]));
  const milestoneIndex = new Map(milestones.map((record) => [record.value.id, record]));
  const eventIndex = new Map(events.map((record) => [record.value.id, record]));
  const evidenceIndex = new Map(snapshot.evidence.map((record) => [record.value.id, record]));
  const roadmapIndex = new Map(roadmapItems.map((record) => [record.value.id, record]));

  for (const record of [...milestones, ...events]) {
    if (instant(record.value.recorded_at) < instant(record.value.occurred_at)) diagnostics.push(errorDiagnostic("time", "recorded-before-occurred", record.sourcePath,
      "recorded_at must not predate occurred_at", { recordId: record.value.id, instancePath: "/recorded_at" }));
  }

  for (const record of milestones) {
    const seenParents = new Set<string>();
    for (let index = 0; index < record.value.parents.length; index += 1) {
      const parentId = record.value.parents[index]!;
      if (seenParents.has(parentId)) diagnostics.push(errorDiagnostic("milestone-graph", "duplicate-parent", record.sourcePath,
        `parent ${parentId} is listed more than once`, { recordId: record.value.id, relatedRecordId: parentId, instancePath: `/parents/${index}` }));
      seenParents.add(parentId);
      const parent = milestoneIndex.get(parentId);
      if (parent === undefined) referenceError(diagnostics, "milestone-graph", record, "parent-missing", parentId, `/parents/${index}`);
      else if (parentId === record.value.id) diagnostics.push(errorDiagnostic("milestone-graph", "self-parent", record.sourcePath,
        "milestone cannot parent itself", { recordId: record.value.id, instancePath: `/parents/${index}` }));
      else if (instant(parent.value.occurred_at) >= instant(record.value.occurred_at)) diagnostics.push(errorDiagnostic("milestone-graph", "parent-not-earlier", record.sourcePath,
        `parent ${parentId} must occur strictly earlier`, { recordId: record.value.id, relatedRecordId: parentId, relatedSourcePath: parent.sourcePath, instancePath: `/parents/${index}` }));
    }
  }
  findCycles(milestoneIndex.keys(), (id) => milestoneIndex.get(id)?.value.parents ?? [], (id) => {
    const record = milestoneIndex.get(id)!;
    diagnostics.push(errorDiagnostic("milestone-graph", "milestone-cycle", record.sourcePath, "milestone ancestry contains a cycle", { recordId: id }));
  });

  const milestonesByBranch = new Map<string, ProjectedRecord<MilestoneRecord>[]>();
  for (const record of milestones) {
    if (!branchIndex.has(record.value.branch_id)) referenceError(diagnostics, "branch", record, "branch-missing", record.value.branch_id, "/branch_id");
    const owned = milestonesByBranch.get(record.value.branch_id) ?? [];
    owned.push(record);
    milestonesByBranch.set(record.value.branch_id, owned);
  }
  for (const branch of branches) {
    const owned = (milestonesByBranch.get(branch.value.id) ?? []).sort((left, right) =>
      instant(left.value.occurred_at) - instant(right.value.occurred_at) || compareOrdinal(left.value.id, right.value.id));
    if (owned.length === 0) {
      diagnostics.push(errorDiagnostic("branch", "branch-empty", branch.sourcePath, "every branch must own at least one milestone", { recordId: branch.value.id }));
      continue;
    }
    const first = owned[0]!;
    if (first.value.parents.length > 0 && !first.value.parents.some((id) => {
      const parent = milestoneIndex.get(id);
      return parent !== undefined && parent.value.branch_id !== branch.value.id;
    })) {
      diagnostics.push(errorDiagnostic("branch", "branch-origin-missing-cross-parent", first.sourcePath,
        "first milestone on a non-root branch requires a cross-branch parent", { recordId: first.value.id }));
    }
    if (first.value.parents.length === 0 && first !== [...milestones].sort((a, b) => instant(a.value.occurred_at) - instant(b.value.occurred_at) || compareOrdinal(a.value.id, b.value.id))[0]) {
      diagnostics.push(warningDiagnostic("branch", "disconnected-root", first.sourcePath,
        "branch begins as an additional disconnected root", { recordId: first.value.id }));
    }
    for (const continuation of owned.slice(1)) {
      if (!continuation.value.parents.some((id) => milestoneIndex.get(id)?.value.branch_id === branch.value.id)) {
        diagnostics.push(errorDiagnostic("branch", "branch-continuation-missing-parent", continuation.sourcePath,
          "non-first milestone requires a same-branch parent; incoming merge parents do not transfer ownership", { recordId: continuation.value.id }));
      }
    }
  }

  for (const record of milestones) {
    const seenRelations = new Set<string>();
    for (let index = 0; index < (record.value.relations?.length ?? 0); index += 1) {
      const relation = record.value.relations![index]!;
      const key = `${relation.type}:${relation.target}`;
      if (seenRelations.has(key)) diagnostics.push(errorDiagnostic("relation", "duplicate-relation", record.sourcePath,
        "duplicate relation type and target", { recordId: record.value.id, relatedRecordId: relation.target, instancePath: `/relations/${index}` }));
      seenRelations.add(key);
      const target = milestoneIndex.get(relation.target);
      if (target === undefined) referenceError(diagnostics, "relation", record, "relation-target-missing", relation.target, `/relations/${index}/target`);
      else if (target.value.id === record.value.id) diagnostics.push(errorDiagnostic("relation", "self-relation", record.sourcePath,
        "milestone relation cannot target itself", { recordId: record.value.id, instancePath: `/relations/${index}/target` }));
      else if (instant(target.value.occurred_at) >= instant(record.value.occurred_at)) diagnostics.push(errorDiagnostic("relation", "relation-target-not-earlier", record.sourcePath,
        "relation target must occur strictly earlier", { recordId: record.value.id, relatedRecordId: relation.target, relatedSourcePath: target.sourcePath, instancePath: `/relations/${index}/target` }));
    }
  }

  const current = snapshot.current;
  if (current !== undefined) {
    const currentMilestone = milestoneIndex.get(current.value.milestone_id);
    if (currentMilestone === undefined) referenceError(diagnostics, "current", current, "current-milestone-missing", current.value.milestone_id, "/milestone_id");
    else {
      if (currentMilestone.value.status !== "accepted") diagnostics.push(errorDiagnostic("current", "current-milestone-not-accepted", current.sourcePath,
        "current milestone must have accepted status", { relatedRecordId: currentMilestone.value.id, relatedSourcePath: currentMilestone.sourcePath, instancePath: "/milestone_id" }));
      if (instant(currentMilestone.value.occurred_at) > instant(current.value.updated_at)) diagnostics.push(errorDiagnostic("current", "current-before-milestone", current.sourcePath,
        "current updated_at must not predate its milestone", { relatedRecordId: currentMilestone.value.id, instancePath: "/updated_at" }));
    }
    for (const id of current.value.related_roadmap_items ?? []) if (!roadmapIndex.has(id)) referenceError(diagnostics, "current", current, "current-roadmap-missing", id, "/related_roadmap_items");
    for (const blocked of current.value.blocked ?? []) for (const ref of blocked.blocked_by ?? []) {
      if (ref.type === "milestone" ? !milestoneIndex.has(ref.id) : !roadmapIndex.has(ref.id)) referenceError(diagnostics, "current", current, "current-blocker-missing", ref.id, "/blocked/blocked_by");
    }
  }

  const projection = current?.value.history_projection ?? [];
  if (projection.length > 0 && current === undefined) throw new Error("unreachable current projection state");
  const projectionSeen = new Set<string>();
  let priorDate: string | undefined;
  let sawUndated = false;
  for (let index = 0; index < projection.length; index += 1) {
    const id = projection[index]!;
    const item = roadmapIndex.get(id);
    if (projectionSeen.has(id)) diagnostics.push(errorDiagnostic("roadmap", "projection-duplicate", current!.sourcePath,
      `history projection repeats ${id}`, { relatedRecordId: id, instancePath: `/history_projection/${index}` }));
    projectionSeen.add(id);
    if (item === undefined) { referenceError(diagnostics, "roadmap", current!, "projection-item-missing", id, `/history_projection/${index}`); continue; }
    if (!(["pending", "active", "blocked"] as string[]).includes(item.value.status)) diagnostics.push(errorDiagnostic("roadmap", "projection-status-invalid", snapshot.roadmap.sourcePath,
      "projected roadmap items must be pending, active, or blocked", { recordId: id }));
    const currentMilestone = milestoneIndex.get(current!.value.milestone_id);
    if (currentMilestone !== undefined && item.value.branch_id !== currentMilestone.value.branch_id) diagnostics.push(errorDiagnostic("roadmap", "projection-branch-mismatch", snapshot.roadmap.sourcePath,
      "projected roadmap item branch must match the current milestone branch", { recordId: id, relatedRecordId: currentMilestone.value.id }));
    const expected = index === 0 ? { type: "milestone", id: current!.value.milestone_id } : { type: "roadmap", id: projection[index - 1]! };
    if (item.value.follows?.type !== expected.type || item.value.follows.id !== expected.id) diagnostics.push(errorDiagnostic("roadmap", "projection-chain-invalid", snapshot.roadmap.sourcePath,
      `projected item must follow ${expected.type} ${expected.id}`, { recordId: id }));
    const date = item.value.planned_for;
    if (date === undefined) sawUndated = true;
    else if (date !== undefined) {
      if (sawUndated) diagnostics.push(errorDiagnostic("roadmap", "projection-dated-after-undated", snapshot.roadmap.sourcePath,
        "dated projected items must precede undated items", { recordId: id }));
      if (priorDate !== undefined && date < priorDate) diagnostics.push(errorDiagnostic("roadmap", "projection-date-decreases", snapshot.roadmap.sourcePath,
        "projected planned dates must be nondecreasing", { recordId: id }));
      if (currentMilestone !== undefined && date < localDate(currentMilestone.value.occurred_at, snapshot.project.value.display.timezone)) diagnostics.push(errorDiagnostic("roadmap", "projection-date-before-current", snapshot.roadmap.sourcePath,
        "projected planned date must not predate current local date", { recordId: id }));
      priorDate = date;
    }
  }

  const graphKinds: { name: string; targets: (item: RoadmapItem) => string[] }[] = [
    { name: "parent", targets: (item) => item.parent_id === undefined ? [] : [item.parent_id] },
    { name: "follows", targets: (item) => item.follows?.type === "roadmap" ? [item.follows.id] : [] },
    { name: "blocker", targets: (item) => item.blocked_by?.filter((ref) => ref.type === "roadmap").map((ref) => ref.id) ?? [] },
    { name: "supersession", targets: (item) => item.status === "superseded" ? [item.superseded_by] : [] },
  ];
  for (const record of roadmapItems) {
    const item = record.value;
    if (item.parent_id !== undefined && !roadmapIndex.has(item.parent_id)) referenceError(diagnostics, "roadmap", record, "roadmap-parent-missing", item.parent_id, "/parent_id");
    if (item.branch_id !== undefined && !branchIndex.has(item.branch_id)) referenceError(diagnostics, "roadmap", record, "roadmap-branch-missing", item.branch_id, "/branch_id");
    if (item.follows !== undefined && (item.follows.type === "milestone" ? !milestoneIndex.has(item.follows.id) : !roadmapIndex.has(item.follows.id))) referenceError(diagnostics, "roadmap", record, "roadmap-follows-missing", item.follows.id, "/follows/id");
    for (const id of item.related_milestones ?? []) if (!milestoneIndex.has(id)) referenceError(diagnostics, "roadmap", record, "roadmap-milestone-missing", id, "/related_milestones");
    for (const ref of item.blocked_by ?? []) if (ref.type === "milestone" ? !milestoneIndex.has(ref.id) : !roadmapIndex.has(ref.id)) referenceError(diagnostics, "roadmap", record, "roadmap-blocker-missing", ref.id, "/blocked_by");
    if (item.status === "superseded") {
      if (!roadmapIndex.has(item.superseded_by)) referenceError(diagnostics, "roadmap", record, "superseded-target-missing", item.superseded_by, "/superseded_by");
      if (item.superseded_by === item.id) diagnostics.push(errorDiagnostic("roadmap", "superseded-self", record.sourcePath, "roadmap item cannot supersede itself", { recordId: item.id }));
    }
    if (item.status === "completed" && (item.related_milestones?.length ?? 0) === 0) diagnostics.push(warningDiagnostic("roadmap", "completed-without-milestone", record.sourcePath,
      "completed roadmap item has no related milestone", { recordId: item.id }));
  }
  for (const graph of graphKinds) findCycles(roadmapIndex.keys(), (id) => graph.targets(roadmapIndex.get(id)!.value).filter((target) => roadmapIndex.has(target)), (id) => {
    const record = roadmapIndex.get(id)!;
    diagnostics.push(errorDiagnostic("roadmap", `roadmap-${graph.name}-cycle`, record.sourcePath, `${graph.name} relationships contain a cycle`, { recordId: id }));
  });

  for (const record of events) {
    if (record.value.milestone_id !== undefined) {
      const milestone = milestoneIndex.get(record.value.milestone_id);
      if (milestone === undefined) referenceError(diagnostics, "engineering-event", record, "event-milestone-missing", record.value.milestone_id, "/milestone_id");
      else if (instant(record.value.occurred_at) > instant(milestone.value.occurred_at)) diagnostics.push(warningDiagnostic("engineering-event", "event-after-milestone", record.sourcePath,
        "engineering event occurred after its linked human milestone", { recordId: record.value.id, relatedRecordId: milestone.value.id, relatedSourcePath: milestone.sourcePath }));
    }
    for (const id of record.value.evidence ?? []) if (!evidenceIndex.has(id)) referenceError(diagnostics, "engineering-event", record, "event-evidence-missing", id, "/evidence");
  }
  for (const record of milestones) {
    for (const id of record.value.evidence ?? []) if (!evidenceIndex.has(id)) referenceError(diagnostics, "evidence", record, "milestone-evidence-missing", id, "/evidence");
    for (const change of record.value.code_changes ?? []) {
      const evidence = evidenceIndex.get(change.diff_evidence_id);
      if (evidence === undefined) referenceError(diagnostics, "evidence", record, "diff-evidence-missing", change.diff_evidence_id, "/code_changes/diff_evidence_id");
      else if (evidence.value.kind !== "diff" || evidence.value.source.kind !== "artifact") diagnostics.push(errorDiagnostic("evidence", "diff-evidence-invalid", record.sourcePath,
        "code change diff evidence must be artifact-backed evidence of kind diff", { recordId: record.value.id, relatedRecordId: evidence.value.id, relatedSourcePath: evidence.sourcePath }));
    }
  }

  const readArtifact = options.artifactReader ?? defaultArtifactReader;
  for (const evidence of snapshot.evidence) {
    if (evidence.value.source.kind === "url") {
      diagnostics.push(warningDiagnostic("evidence", "external-url-unverified", evidence.sourcePath,
        "external URL evidence is retained but not fetched or verified", { recordId: evidence.value.id }));
    } else if (evidence.value.source.kind === "artifact") {
      const read = await readArtifact(snapshot, evidence);
      if (!read.ok) diagnostics.push(...read.diagnostics);
      else {
        const actual = createHash("sha256").update(read.bytes).digest("hex");
        if (actual !== evidence.value.source.sha256) diagnostics.push(errorDiagnostic("evidence", "artifact-sha256-mismatch", evidence.sourcePath,
          `artifact SHA-256 does not match declared digest (actual ${actual})`, { recordId: evidence.value.id, instancePath: "/source/sha256" }));
      }
    }
  }

  const sorted = sortDomainDiagnostics(diagnostics);
  if (sorted.some((item) => item.severity === "error")) return { ok: false, diagnostics: sorted };
  const output: ValidatedChronicle = {
    rootPath: snapshot.rootPath,
    project: cloneJson(snapshot.project),
    ...(snapshot.current === undefined ? {} : { current: cloneJson(snapshot.current) }),
    roadmap: cloneJson(snapshot.roadmap),
    branches: cloneJson(branches), milestones: cloneJson(milestones), engineeringEvents: cloneJson(events),
    revisions: cloneJson([...snapshot.revisions].sort((a, b) => compareOrdinal(a.value.id, b.value.id))),
    evidence: cloneJson([...snapshot.evidence].sort((a, b) => compareOrdinal(a.value.id, b.value.id))),
    warnings: sorted.filter((item) => item.severity === "warning"),
  };
  return { ok: true, value: deepFreeze(output) };
}
