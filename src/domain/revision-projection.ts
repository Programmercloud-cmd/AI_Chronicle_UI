import type { ChronicleSnapshot, SourcedRecord } from "../data";
import {
  validateRecordShape,
  type BranchRecord,
  type ChronicleRecordKind,
  type EngineeringEventRecord,
  type MilestoneRecord,
  type RevisionRecord,
} from "../schema";
import { errorDiagnostic } from "./diagnostics";
import { applyGuardedChange, cloneJson } from "./json-pointer";
import { compareOrdinal } from "./ordinal";
import type {
  DomainDiagnostic,
  ProjectedRecord,
  RevisableRecord,
  RevisionProjectionResult,
} from "./types";

type RevisionTargetType = RevisionRecord["target"]["type"];

interface AnyTarget {
  type: RevisionTargetType;
  kind: ChronicleRecordKind;
  source: SourcedRecord<RevisableRecord>;
}

const targetKey = (type: RevisionTargetType, id: string): string => `${type}:${id}`;

function targetIndex(snapshot: ChronicleSnapshot): Map<string, AnyTarget> {
  const index = new Map<string, AnyTarget>();
  for (const source of snapshot.branches) index.set(targetKey("branch", source.value.id), { type: "branch", kind: "branch", source });
  for (const source of snapshot.milestones) index.set(targetKey("milestone", source.value.id), { type: "milestone", kind: "milestone", source });
  for (const source of snapshot.engineeringEvents) index.set(targetKey("engineering_event", source.value.id), { type: "engineering_event", kind: "engineering-event", source });
  return index;
}

function projected<T extends RevisableRecord>(source: SourcedRecord<T>): ProjectedRecord<T> {
  return { sourcePath: source.sourcePath, original: cloneJson(source.value), value: cloneJson(source.value), amendments: [] };
}

function epoch(timestamp: string): number {
  return Date.parse(timestamp);
}

export function projectRevisions(snapshot: ChronicleSnapshot): RevisionProjectionResult {
  const diagnostics: DomainDiagnostic[] = [];
  const targets = targetIndex(snapshot);
  const branchMap = new Map(snapshot.branches.map((source) => [source.value.id, projected(source)]));
  const milestoneMap = new Map(snapshot.milestones.map((source) => [source.value.id, projected(source)]));
  const eventMap = new Map(snapshot.engineeringEvents.map((source) => [source.value.id, projected(source)]));
  const revisionsById = new Map(snapshot.revisions.map((revision) => [revision.value.id, revision]));
  const grouped = new Map<string, SourcedRecord<RevisionRecord>[]>();

  for (const revision of snapshot.revisions) {
    const key = targetKey(revision.value.target.type, revision.value.target.id);
    const target = targets.get(key);
    if (target === undefined) {
      diagnostics.push(errorDiagnostic("revision-chain", "revision-target-missing", revision.sourcePath,
        `revision target ${key} does not exist`, { recordId: revision.value.id, targetId: revision.value.target.id }));
      continue;
    }
    const group = grouped.get(key) ?? [];
    group.push(revision);
    grouped.set(key, group);
  }

  for (const [key, group] of [...grouped].sort(([left], [right]) => compareOrdinal(left, right))) {
    const target = targets.get(key)!;
    const groupIds = new Set(group.map((item) => item.value.id));
    const heads = group.filter((item) => item.value.previous_revision === null);
    const childByPrevious = new Map<string, SourcedRecord<RevisionRecord>[]>();
    for (const revision of group) {
      const previous = revision.value.previous_revision;
      if (previous === null) continue;
      const previousRecord = revisionsById.get(previous);
      if (previousRecord === undefined) {
        diagnostics.push(errorDiagnostic("revision-chain", "revision-predecessor-missing", revision.sourcePath,
          `previous revision ${previous} does not exist`, { recordId: revision.value.id, targetId: target.source.value.id, relatedRecordId: previous }));
      } else if (!groupIds.has(previous)) {
        diagnostics.push(errorDiagnostic("revision-chain", "revision-predecessor-wrong-target", revision.sourcePath,
          `previous revision ${previous} targets another record`, { recordId: revision.value.id, targetId: target.source.value.id, relatedRecordId: previous, relatedSourcePath: previousRecord.sourcePath }));
      }
      const children = childByPrevious.get(previous) ?? [];
      children.push(revision);
      childByPrevious.set(previous, children);
    }
    if (heads.length !== 1) {
      for (const revision of group) diagnostics.push(errorDiagnostic("revision-chain", "revision-head-count", revision.sourcePath,
        `target must have exactly one revision-chain head; found ${heads.length}`, { recordId: revision.value.id, targetId: target.source.value.id }));
      continue;
    }
    for (const [previous, children] of childByPrevious) {
      if (children.length > 1) for (const child of children) diagnostics.push(errorDiagnostic("revision-chain", "revision-chain-fork", child.sourcePath,
        `revision ${previous} has more than one successor`, { recordId: child.value.id, targetId: target.source.value.id, relatedRecordId: previous }));
    }
    const ordered: SourcedRecord<RevisionRecord>[] = [];
    const seen = new Set<string>();
    let cursor: SourcedRecord<RevisionRecord> | undefined = heads[0];
    while (cursor !== undefined && !seen.has(cursor.value.id)) {
      ordered.push(cursor);
      seen.add(cursor.value.id);
      cursor = childByPrevious.get(cursor.value.id)?.[0];
    }
    if (cursor !== undefined) diagnostics.push(errorDiagnostic("revision-chain", "revision-chain-cycle", cursor.sourcePath,
      "revision chain contains a cycle", { recordId: cursor.value.id, targetId: target.source.value.id }));
    if (seen.size !== group.length) {
      for (const revision of group.filter((item) => !seen.has(item.value.id))) diagnostics.push(errorDiagnostic("revision-chain", "revision-unreachable", revision.sourcePath,
        "revision is not reachable from the chain head", { recordId: revision.value.id, targetId: target.source.value.id }));
    }
    if (diagnostics.some((item) => item.phase === "revision-chain" && item.targetId === target.source.value.id)) continue;

    const targetRecordedAt = "recorded_at" in target.source.value ? epoch(target.source.value.recorded_at) : undefined;
    if (targetRecordedAt !== undefined && epoch(ordered[0]!.value.recorded_at) < targetRecordedAt) {
      diagnostics.push(errorDiagnostic("revision-chain", "revision-before-target", ordered[0]!.sourcePath,
        "first revision predates the target recorded_at", { recordId: ordered[0]!.value.id, targetId: target.source.value.id, targetSourcePath: target.source.sourcePath }));
      continue;
    }
    let timesValid = true;
    for (let index = 1; index < ordered.length; index += 1) {
      if (epoch(ordered[index]!.value.recorded_at) <= epoch(ordered[index - 1]!.value.recorded_at)) {
        diagnostics.push(errorDiagnostic("revision-chain", "revision-time-not-increasing", ordered[index]!.sourcePath,
          "revision recorded_at must be strictly later than its predecessor", { recordId: ordered[index]!.value.id, targetId: target.source.value.id, relatedRecordId: ordered[index - 1]!.value.id }));
        timesValid = false;
      }
    }
    if (!timesValid) continue;

    const destination = target.type === "branch" ? branchMap.get(target.source.value.id)! :
      target.type === "milestone" ? milestoneMap.get(target.source.value.id)! : eventMap.get(target.source.value.id)!;
    let current: RevisableRecord = destination.value;
    for (const revision of ordered) {
      const before = cloneJson(current);
      let staged = cloneJson(current);
      let failed = false;
      for (let changeIndex = 0; changeIndex < revision.value.changes.length; changeIndex += 1) {
        const change = revision.value.changes[changeIndex]!;
        const result = applyGuardedChange(staged, change);
        if (!result.ok) {
          diagnostics.push(errorDiagnostic("revision-apply", result.failure.code, revision.sourcePath,
            result.failure.message, { recordId: revision.value.id, targetId: target.source.value.id, targetSourcePath: target.source.sourcePath, changeIndex, pointer: result.failure.pointer }));
          failed = true;
          break;
        }
        staged = result.value;
      }
      if (failed) break;
      const shape = validateRecordShape(target.kind, staged, { sourcePath: revision.sourcePath, recordId: target.source.value.id });
      if (!shape.ok) {
        for (const issue of shape.diagnostics) diagnostics.push(errorDiagnostic("revision-apply", "projected-shape-invalid", revision.sourcePath,
          issue.message, { recordId: revision.value.id, targetId: target.source.value.id, targetSourcePath: target.source.sourcePath, instancePath: issue.instancePath }));
        break;
      }
      current = staged;
      destination.value = staged as never;
      destination.amendments.push({ revisionId: revision.value.id, sourcePath: revision.sourcePath, recordedAt: revision.value.recorded_at, before: before as never, after: cloneJson(staged) as never });
    }
  }

  return {
    ...(diagnostics.some((item) => item.severity === "error") ? {} : {
      projection: {
        branches: [...branchMap.values()].sort((a, b) => compareOrdinal(a.value.id, b.value.id)),
        milestones: [...milestoneMap.values()].sort((a, b) => compareOrdinal(a.value.id, b.value.id)),
        engineeringEvents: [...eventMap.values()].sort((a, b) => compareOrdinal(a.value.id, b.value.id)),
      },
    }),
    diagnostics,
  };
}
