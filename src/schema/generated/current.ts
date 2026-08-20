/** Generated from schema/v1. Do not edit manually. */

export interface CurrentRecord {
  schema_version: 1;
  updated_at: string;
  milestone_id: string;
  state: string;
  current_hypothesis?: string;
  active_work?: string[];
  next_step?: string;
  blocked?: {
    summary: string;
    /**
     * @minItems 1
     */
    blocked_by?: [
      (
        | {
            type: "milestone";
            id: string;
          }
        | {
            type: "roadmap";
            id: string;
          }
      ),
      ...(
        | {
            type: "milestone";
            id: string;
          }
        | {
            type: "roadmap";
            id: string;
          }
      )[],
    ];
  }[];
  related_roadmap_items?: string[];
  history_projection?: string[];
}
