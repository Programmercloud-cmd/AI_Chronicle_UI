/** Generated from schema/v1. Do not edit manually. */

export type StringArray = string[];

export interface MilestoneRecord {
  schema_version: 1;
  id: string;
  occurred_at: string;
  recorded_at: string;
  title: string;
  summary: string;
  branch_id: string;
  parents: string[];
  status: "accepted" | "rejected" | "abandoned" | "blocked" | "informational";
  relations?: {
    type: "supersedes" | "disproves" | "reverts_to" | "related_to";
    target: string;
    explanation: string;
  }[];
  details?: {
    context?: string;
    changed?: StringArray;
    unchanged?: StringArray;
    hypotheses?: StringArray;
    acceptance_criteria?: StringArray;
    results?: StringArray;
    known_limitations?: StringArray;
    next_step?: string;
  };
  evidence?: string[];
  code_changes?: {
    diff_evidence_id: string;
    why: string;
    previous_behavior: string;
    new_behavior: string;
    risks?: StringArray;
  }[];
}
