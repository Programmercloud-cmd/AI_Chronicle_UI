import {
  layoutTimeline,
  type TimelineLayout,
  type TimelineLayoutInput,
  type TimelineMilestoneInput,
} from "../../../src/timeline";

function milestone(
  id: string,
  occurredAtIso: string,
  branchId: string,
  parentIds: readonly string[],
  title: string,
): TimelineMilestoneInput {
  return {
    id,
    occurredAtIso,
    occurredAtEpochMs: Date.parse(occurredAtIso),
    title,
    summary: `${title} summary`,
    status: "accepted",
    branchId,
    parentIds,
    evidenceCount: id === "TIM-004" ? 3 : 1,
  };
}

export function canonicalHistoryInput(): TimelineLayoutInput {
  return {
    displayTimeZone: "Europe/Paris",
    branches: [
      { id: "BR-MAIN", title: "Original path" },
      { id: "BR-TIMING", title: "Timing recovery" },
    ],
    milestones: [
      milestone("CORE-001", "2026-04-06T09:15:42+02:00", "BR-MAIN", [], "Initial Architecture"),
      milestone("CORE-002", "2026-04-12T11:08:33+02:00", "BR-MAIN", ["CORE-001"], "Baseline Working"),
      milestone("CORE-003", "2026-04-20T16:47:21+02:00", "BR-MAIN", ["CORE-002"], "Regression Introduced"),
      milestone("CORE-004", "2026-04-24T10:22:14+02:00", "BR-MAIN", ["CORE-003"], "First Fix Attempt"),
      milestone("TIM-001", "2026-04-26T13:35:09+02:00", "BR-TIMING", ["CORE-003"], "Root Cause Found"),
      milestone("TIM-002", "2026-04-28T15:42:31+02:00", "BR-TIMING", ["TIM-001"], "Alternative Fix"),
      milestone("TIM-003", "2026-05-02T09:18:07+02:00", "BR-TIMING", ["TIM-002"], "Validation Passed"),
      milestone("TIM-004", "2026-05-05T14:30:52+02:00", "BR-TIMING", ["TIM-003"], "Stable Implementation"),
    ],
    current: { milestoneId: "TIM-004", state: "Stable implementation accepted" },
    projection: [
      { id: "RM-001", title: "Performance Benchmark", status: "active", branchId: "BR-TIMING", plannedFor: "2026-05-18" },
      { id: "RM-002", title: "Integration Validation", status: "pending", branchId: "BR-TIMING", plannedFor: "2026-06-08" },
      { id: "RM-003", title: "Production Release", status: "pending", branchId: "BR-TIMING", plannedFor: "2026-06-22" },
    ],
  };
}

export function canonicalHistoryLayout(): TimelineLayout {
  const result = layoutTimeline(canonicalHistoryInput());
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}
