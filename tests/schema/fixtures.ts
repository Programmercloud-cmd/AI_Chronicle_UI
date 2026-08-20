import type { ChronicleRecordKind } from "../../src/schema";

export const validRecords: Record<ChronicleRecordKind, unknown> = {
  project: {
    schema_version: 1,
    project: {
      id: "canonical-mock",
      title: "Canonical Chronicle Mock",
      description: "Synthetic history used to validate Chronicle.",
    },
    display: { timezone: "Europe/Paris" },
  },
  branch: {
    schema_version: 1,
    id: "BR-TIMING",
    title: "Timing investigation",
    description: "Alternative development path.",
  },
  milestone: {
    schema_version: 1,
    id: "CORE-006",
    occurred_at: "2026-05-05T14:30:52+02:00",
    recorded_at: "2026-05-05T14:42:10+02:00",
    title: "Timestamp fix accepted",
    summary: "Replay continuity passed after timestamp normalization.",
    branch_id: "BR-TIMING",
    parents: ["CORE-005"],
    status: "accepted",
    relations: [
      {
        type: "disproves",
        target: "CORE-003",
        explanation: "Instrumented replay disproved the previous hypothesis.",
      },
    ],
    details: {
      context: "The canonical replay repeatedly lost continuity.",
      changed: ["Normalize timestamps before queue insertion."],
      unchanged: ["Registration behavior remains unchanged."],
      hypotheses: ["Clock-domain mismatch caused queue inversion."],
      acceptance_criteria: ["Ten canonical replays pass."],
      results: ["10/10 passed."],
      known_limitations: ["One sensor profile tested."],
      next_step: "Run the long-duration benchmark.",
    },
    evidence: ["EVD-0007", "EVD-0008"],
    code_changes: [
      {
        diff_evidence_id: "EVD-0008",
        why: "Clock domains differed.",
        previous_behavior: "Raw timestamps were compared.",
        new_behavior: "Timestamps are normalized.",
        risks: ["Bad metadata may select the wrong offset."],
      },
    ],
  },
  current: {
    schema_version: 1,
    updated_at: "2026-05-05T15:00:00+02:00",
    milestone_id: "CORE-006",
    state: "Stable timestamp handling accepted.",
    current_hypothesis: "Remaining drift is unrelated.",
    active_work: ["Run a benchmark."],
    next_step: "Compare against baseline.",
    blocked: [
      {
        summary: "Release waits for validation.",
        blocked_by: [{ type: "roadmap", id: "RM-004" }],
      },
    ],
    related_roadmap_items: ["RM-004"],
    history_projection: ["RM-004", "RM-005"],
  },
  roadmap: {
    schema_version: 1,
    updated_at: "2026-05-05T15:00:00+02:00",
    items: [
      {
        id: "RM-004",
        title: "Validate long-duration behavior",
        status: "active",
        order: 40,
        follows: { type: "milestone", id: "CORE-006" },
        branch_id: "BR-TIMING",
        acceptance_criteria: ["Three two-hour runs pass."],
        related_milestones: ["CORE-006"],
        planned_for: "2026-06-10",
      },
      {
        id: "RM-005",
        title: "Integrate benchmark reporting",
        status: "blocked",
        order: 50,
        follows: { type: "roadmap", id: "RM-004" },
        branch_id: "BR-TIMING",
        blocker_summary: "Validation is not accepted.",
      },
    ],
  },
  evidence: {
    schema_version: 1,
    id: "EVD-0008",
    captured_at: "2026-05-05T14:28:11+02:00",
    kind: "diff",
    title: "Timestamp normalization patch",
    description: "Exact accepted patch.",
    source: {
      kind: "artifact",
      path: "evidence/artifacts/diffs/CORE-006.patch",
      media_type: "text/x-diff",
      sha256: "53f3d9a6c2130000000000000000000000000000000000000000000000000000",
    },
    origin: {
      tool: "git",
      command: "git diff base..head",
      base_revision: "base",
      target_revision: "head",
    },
  },
  "engineering-event": {
    schema_version: 1,
    id: "EVT-000014",
    occurred_at: "2026-05-05T13:48:00+02:00",
    recorded_at: "2026-05-05T13:49:02+02:00",
    milestone_id: "CORE-006",
    kind: "review",
    actor: {
      type: "agent",
      role: "critic",
      label: "critic iteration 2",
    },
    outcome: "reject",
    summary: "Monotonic input was the only tested case.",
    details: "Add an out-of-order timestamp fixture.",
    evidence: ["EVD-0006"],
  },
  revision: {
    schema_version: 1,
    id: "REV-000003",
    target: { type: "milestone", id: "CORE-003" },
    recorded_at: "2026-05-07T09:12:00+02:00",
    previous_revision: null,
    reason: "clerical_correction",
    summary: "Correct the captured parent ID.",
    changes: [
      {
        operation: "replace",
        path: "/parents",
        from: ["CORE-001"],
        value: ["CORE-002"],
      },
    ],
  },
};

export function cloneFixture<K extends ChronicleRecordKind>(kind: K): unknown {
  return structuredClone(validRecords[kind]);
}
