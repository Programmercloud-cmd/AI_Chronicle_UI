/** Generated from schema/v1. Do not edit manually. */

export interface RevisionRecord {
  schema_version: 1;
  id: string;
  target: BranchTarget | MilestoneTarget | EngineeringEventTarget;
  recorded_at: string;
  previous_revision: null | string;
  reason: "clerical_correction" | "clarification" | "late_attachment";
  summary: string;
  /**
   * @minItems 1
   */
  changes: [AddChange | ReplaceChange | RemoveChange, ...(AddChange | ReplaceChange | RemoveChange)[]];
}
export interface BranchTarget {
  type: "branch";
  id: string;
}
export interface MilestoneTarget {
  type: "milestone";
  id: string;
}
export interface EngineeringEventTarget {
  type: "engineering_event";
  id: string;
}
export interface AddChange {
  operation: "add";
  path: string;
  value: unknown;
}
export interface ReplaceChange {
  operation: "replace";
  path: string;
  from: unknown;
  value: unknown;
}
export interface RemoveChange {
  operation: "remove";
  path: string;
  from: unknown;
}
