/** Generated from schema/v1. Do not edit manually. */

export interface EngineeringEventRecord {
  schema_version: 1;
  id: string;
  occurred_at: string;
  recorded_at: string;
  milestone_id?: string;
  kind: "implementation" | "test" | "review" | "investigation" | "decision" | "integration" | "roadmap_change";
  actor: {
    type: "human" | "agent" | "tool";
    role?: string;
    label?: string;
  };
  outcome: "completed" | "passed" | "failed" | "accept" | "reject" | "informational";
  summary: string;
  details?: string;
  evidence?: string[];
}
