import type { PublicChronicleSnapshot } from "../app-shell/snapshot";

export type MilestoneNeighborhoodRecord = PublicChronicleSnapshot["milestones"][number];

export interface MilestoneNeighborhoodEdge {
  readonly sourceId: string;
  readonly targetId: string;
}

export interface MilestoneNeighborhoodModel {
  readonly center: MilestoneNeighborhoodRecord;
  readonly parents: readonly MilestoneNeighborhoodRecord[];
  readonly children: readonly MilestoneNeighborhoodRecord[];
  readonly edges: readonly MilestoneNeighborhoodEdge[];
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareChildren(
  left: MilestoneNeighborhoodRecord,
  right: MilestoneNeighborhoodRecord,
): number {
  return Date.parse(left.value.occurred_at) - Date.parse(right.value.occurred_at)
    || compareOrdinal(left.value.id, right.value.id);
}

/**
 * Builds the direct ancestry neighborhood for one milestone.
 *
 * Parent order is the center record's declared order. Child order is ascending
 * occurrence time with stable milestone ID as the tie-breaker. Semantic
 * relations are intentionally outside this presentation model.
 */
export function buildMilestoneNeighborhood(
  snapshot: PublicChronicleSnapshot,
  selectedMilestoneId: string,
): MilestoneNeighborhoodModel | undefined {
  const milestoneById = new Map<string, MilestoneNeighborhoodRecord>();
  const childrenByParentId = new Map<string, MilestoneNeighborhoodRecord[]>();
  for (const record of snapshot.milestones) {
    milestoneById.set(record.value.id, record);
    for (const parentId of record.value.parents) {
      const children = childrenByParentId.get(parentId);
      if (children === undefined) childrenByParentId.set(parentId, [record]);
      else children.push(record);
    }
  }
  const center = milestoneById.get(selectedMilestoneId);
  if (center === undefined) return undefined;

  const parents = Object.freeze(center.value.parents.flatMap((parentId) => {
    const parent = milestoneById.get(parentId);
    return parent === undefined ? [] : [parent];
  }));
  const children = Object.freeze(
    [...(childrenByParentId.get(selectedMilestoneId) ?? [])].sort(compareChildren),
  );
  const edges = Object.freeze([
    ...parents.map((parent) => Object.freeze({
      sourceId: parent.value.id,
      targetId: center.value.id,
    })),
    ...children.map((child) => Object.freeze({
      sourceId: center.value.id,
      targetId: child.value.id,
    })),
  ]);

  return Object.freeze({ center, parents, children, edges });
}
