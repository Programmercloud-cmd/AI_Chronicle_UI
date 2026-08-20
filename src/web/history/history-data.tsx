import {
  layoutTimeline,
  type TimelineLayoutInput,
  type TimelineLayoutResult,
  type TimelineProjectionStatus,
} from "../../timeline";
import type { PublicChronicleSnapshot } from "../app-shell/snapshot";

function isProjectionStatus(status: string): status is TimelineProjectionStatus {
  return status === "pending" || status === "active" || status === "blocked";
}

export function historyInputFromSnapshot(
  snapshot: PublicChronicleSnapshot,
): TimelineLayoutInput {
  const roadmapById = new Map(
    snapshot.roadmap.value.items.map((item) => [item.id, item]),
  );
  const projection = (snapshot.current?.value.history_projection ?? []).map((id) => {
    const item = roadmapById.get(id);
    if (item === undefined || item.branch_id === undefined || !isProjectionStatus(item.status)) {
      throw new Error(`validated projection item ${id} is unavailable`);
    }
    return {
      id: item.id,
      title: item.title,
      status: item.status,
      branchId: item.branch_id,
      ...(item.planned_for === undefined ? {} : { plannedFor: item.planned_for }),
    };
  });

  return {
    displayTimeZone: snapshot.project.value.display.timezone,
    branches: snapshot.branches.map((record) => ({
      id: record.value.id,
      title: record.value.title,
    })),
    milestones: snapshot.milestones.map((record) => ({
      id: record.value.id,
      occurredAtIso: record.value.occurred_at,
      occurredAtEpochMs: Date.parse(record.value.occurred_at),
      title: record.value.title,
      summary: record.value.summary,
      status: record.value.status,
      branchId: record.value.branch_id,
      parentIds: record.value.parents,
      evidenceCount: record.value.evidence?.length ?? 0,
    })),
    ...(snapshot.current === undefined
      ? {}
      : {
          current: {
            milestoneId: snapshot.current.value.milestone_id,
            state: snapshot.current.value.state,
          },
        }),
    projection,
  };
}

export function historyLayoutFromSnapshot(
  snapshot: PublicChronicleSnapshot,
): TimelineLayoutResult {
  return layoutTimeline(historyInputFromSnapshot(snapshot));
}
