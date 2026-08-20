import type { MilestoneRecord, RoadmapItem } from "../schema";
import type { ValidatedChronicle } from "../domain";
import type {
  CurrentRoadmapPresentation,
  EntityLink,
  HistoricalAnnotation,
  MilestoneLink,
  RoadmapItemPresentation,
  RoadmapLink,
  RoadmapOutlineEntry,
} from "./types";

export class PresentationInvariantError extends Error {
  public constructor(message: string) {
    super(`Invalid validated Chronicle boundary: ${message}`);
    this.name = "PresentationInvariantError";
  }
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new PresentationInvariantError(message);
  return value;
}

function buildAnnotationIndex(
  milestones: ReadonlyMap<string, MilestoneRecord>,
): ReadonlyMap<string, readonly HistoricalAnnotation[]> {
  const annotations = new Map<string, HistoricalAnnotation[]>();

  for (const source of milestones.values()) {
    for (const relation of source.relations ?? []) {
      if (relation.type !== "supersedes" && relation.type !== "disproves") continue;
      if (!milestones.has(relation.target)) {
        throw new PresentationInvariantError(
          `milestone ${source.id} relation targets missing milestone ${relation.target}`,
        );
      }
      const targetAnnotations = annotations.get(relation.target) ?? [];
      targetAnnotations.push({
        kind: relation.type === "supersedes" ? "superseded-by" : "disproved-by",
        sourceMilestoneId: source.id,
        sourceMilestoneTitle: source.title,
        sourceOccurredAt: source.occurred_at,
        explanation: relation.explanation,
      });
      annotations.set(relation.target, targetAnnotations);
    }
  }

  for (const targetAnnotations of annotations.values()) {
    targetAnnotations.sort((left, right) => {
      const instantDifference =
        Date.parse(left.sourceOccurredAt) - Date.parse(right.sourceOccurredAt);
      return (
        instantDifference ||
        compareOrdinal(left.sourceMilestoneId, right.sourceMilestoneId) ||
        compareOrdinal(left.kind, right.kind)
      );
    });
  }

  return annotations;
}

export function createCurrentRoadmapPresentation(
  chronicle: Readonly<ValidatedChronicle>,
): CurrentRoadmapPresentation {
  const milestones = new Map<string, MilestoneRecord>();
  for (const record of chronicle.milestones) {
    if (milestones.has(record.value.id)) {
      throw new PresentationInvariantError(`duplicate milestone ${record.value.id}`);
    }
    milestones.set(record.value.id, record.value);
  }

  const roadmapItems = new Map<string, RoadmapItem>();
  for (const item of chronicle.roadmap.value.items) {
    if (roadmapItems.has(item.id)) {
      throw new PresentationInvariantError(`duplicate roadmap item ${item.id}`);
    }
    roadmapItems.set(item.id, item);
  }

  const annotationIndex = buildAnnotationIndex(milestones);

  const milestoneLink = (id: string): MilestoneLink => {
    const milestone = required(milestones.get(id), `missing milestone ${id}`);
    return {
      type: "milestone",
      id: milestone.id,
      title: milestone.title,
      status: milestone.status,
      annotations: [...(annotationIndex.get(id) ?? [])].map((annotation) => ({ ...annotation })),
    };
  };

  const roadmapLink = (id: string): RoadmapLink => {
    const item = required(roadmapItems.get(id), `missing roadmap item ${id}`);
    return { type: "roadmap", id: item.id, title: item.title, status: item.status };
  };

  const entityLink = (reference: { type: "milestone" | "roadmap"; id: string }): EntityLink =>
    reference.type === "milestone" ? milestoneLink(reference.id) : roadmapLink(reference.id);

  const presentations = new Map<string, RoadmapItemPresentation>();
  for (const item of roadmapItems.values()) {
    const presentation: RoadmapItemPresentation = {
      id: item.id,
      title: item.title,
      status: item.status,
      order: item.order,
      ...(item.parent_id === undefined ? {} : { parentId: item.parent_id }),
      ...(item.follows === undefined ? {} : { follows: entityLink(item.follows) }),
      ...(item.branch_id === undefined ? {} : { branchId: item.branch_id }),
      acceptanceCriteria: [...(item.acceptance_criteria ?? [])],
      relatedMilestones: (item.related_milestones ?? []).map(milestoneLink),
      ...(item.blocker_summary === undefined ? {} : { blockerSummary: item.blocker_summary }),
      blockedBy: (item.blocked_by ?? []).map(entityLink),
      ...(item.status === "superseded" ? { supersededBy: roadmapLink(item.superseded_by) } : {}),
      ...(item.planned_for === undefined ? {} : { plannedFor: item.planned_for }),
    };
    presentations.set(item.id, presentation);
  }

  const childrenByParent = new Map<string | undefined, RoadmapItem[]>();
  for (const item of roadmapItems.values()) {
    if (item.parent_id !== undefined && !roadmapItems.has(item.parent_id)) {
      throw new PresentationInvariantError(
        `roadmap item ${item.id} has missing parent ${item.parent_id}`,
      );
    }
    const siblings = childrenByParent.get(item.parent_id) ?? [];
    siblings.push(item);
    childrenByParent.set(item.parent_id, siblings);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((left, right) => left.order - right.order || compareOrdinal(left.id, right.id));
  }

  const outline: RoadmapOutlineEntry[] = [];
  const visiting = new Set<string>();
  const emitted = new Set<string>();
  const appendChildren = (parentId: string | undefined, depth: number): void => {
    for (const child of childrenByParent.get(parentId) ?? []) {
      if (visiting.has(child.id) || emitted.has(child.id)) {
        throw new PresentationInvariantError(`roadmap hierarchy repeats or cycles at ${child.id}`);
      }
      visiting.add(child.id);
      outline.push({ item: required(presentations.get(child.id), `missing presentation ${child.id}`), depth });
      appendChildren(child.id, depth + 1);
      visiting.delete(child.id);
      emitted.add(child.id);
    }
  };
  appendChildren(undefined, 0);
  if (emitted.size !== roadmapItems.size) {
    throw new PresentationInvariantError("roadmap hierarchy contains an unreachable cycle");
  }

  const currentRecord = chronicle.current?.value;
  const current = currentRecord === undefined
    ? undefined
    : (() => {
        const milestone = required(
          milestones.get(currentRecord.milestone_id),
          `current references missing milestone ${currentRecord.milestone_id}`,
        );
        return {
          updatedAt: currentRecord.updated_at,
          milestone: {
            id: milestone.id,
            title: milestone.title,
            summary: milestone.summary,
            status: milestone.status,
            branchId: milestone.branch_id,
            occurredAt: milestone.occurred_at,
            recordedAt: milestone.recorded_at,
            annotations: [...(annotationIndex.get(milestone.id) ?? [])].map((annotation) => ({ ...annotation })),
          },
          state: currentRecord.state,
          ...(currentRecord.current_hypothesis === undefined
            ? {}
            : { currentHypothesis: currentRecord.current_hypothesis }),
          activeWork: [...(currentRecord.active_work ?? [])],
          ...(currentRecord.next_step === undefined ? {} : { nextStep: currentRecord.next_step }),
          blocked: (currentRecord.blocked ?? []).map((blocker) => ({
            summary: blocker.summary,
            blockedBy: (blocker.blocked_by ?? []).map(entityLink),
          })),
          relatedRoadmapItems: (currentRecord.related_roadmap_items ?? []).map(roadmapLink),
        };
      })();

  const historyProjection = (currentRecord?.history_projection ?? []).map((id, projectionIndex) => {
    const item = required(presentations.get(id), `history projection references missing roadmap item ${id}`);
    return {
      item,
      projectionIndex,
      ...(item.plannedFor === undefined ? {} : { plannedFor: item.plannedFor }),
    };
  });

  return {
    ...(current === undefined ? {} : { current }),
    roadmap: { updatedAt: chronicle.roadmap.value.updated_at, outline },
    historyProjection,
  };
}

