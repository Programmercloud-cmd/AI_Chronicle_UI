import path from "node:path";

import { loadChronicle } from "../../src/data";
import { validateChronicle } from "../../src/domain";
import type {
  TimelineLayoutInput,
  TimelineProjectionStatus,
} from "../../src/timeline";

export async function exampleTimelineInput(
  name: "canonical" | "difficult",
): Promise<TimelineLayoutInput> {
  const loaded = await loadChronicle(path.resolve(`examples/${name}`));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics, null, 2));
  const validated = await validateChronicle(loaded.value);
  if (!validated.ok) throw new Error(JSON.stringify(validated.diagnostics, null, 2));

  const chronicle = validated.value;
  const evidenceCounts = new Map(
    chronicle.milestones.map((record) => [record.value.id, record.value.evidence?.length ?? 0]),
  );
  const roadmap = new Map(chronicle.roadmap.value.items.map((item) => [item.id, item]));
  const projection = (chronicle.current?.value.history_projection ?? []).map((id) => {
    const item = roadmap.get(id);
    if (item === undefined || item.branch_id === undefined) {
      throw new Error(`validated projection item ${id} is unavailable`);
    }
    return {
      id: item.id,
      title: item.title,
      status: item.status as TimelineProjectionStatus,
      branchId: item.branch_id,
      ...(item.planned_for === undefined ? {} : { plannedFor: item.planned_for }),
    };
  });

  return {
    displayTimeZone: chronicle.project.value.display.timezone,
    branches: chronicle.branches.map((record) => ({
      id: record.value.id,
      title: record.value.title,
    })),
    milestones: chronicle.milestones.map((record) => ({
      id: record.value.id,
      occurredAtIso: record.value.occurred_at,
      occurredAtEpochMs: Date.parse(record.value.occurred_at),
      title: record.value.title,
      summary: record.value.summary,
      status: record.value.status,
      branchId: record.value.branch_id,
      parentIds: [...record.value.parents],
      evidenceCount: evidenceCounts.get(record.value.id)!,
    })),
    ...(chronicle.current === undefined
      ? {}
      : {
          current: {
            milestoneId: chronicle.current.value.milestone_id,
            state: chronicle.current.value.state,
          },
        }),
    projection,
  };
}
