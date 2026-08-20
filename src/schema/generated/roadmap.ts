/** Generated from schema/v1. Do not edit manually. */

export type RoadmapItem = StandardItem | BlockedItem | SupersededItem;
export type RoadmapStringArray = string[];
export type RoadmapMilestoneIdArray = string[];
/**
 * @minItems 1
 */
export type RoadmapBlockerArray = [
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

export interface RoadmapRecord {
  schema_version: 1;
  updated_at: string;
  items: RoadmapItem[];
}
export interface StandardItem {
  id: string;
  title: string;
  status: "pending" | "active" | "completed" | "abandoned";
  order: number;
  parent_id?: string;
  follows?:
    | {
        type: "milestone";
        id: string;
      }
    | {
        type: "roadmap";
        id: string;
      };
  branch_id?: string;
  acceptance_criteria?: RoadmapStringArray;
  related_milestones?: RoadmapMilestoneIdArray;
  blocker_summary?: string;
  blocked_by?: RoadmapBlockerArray;
  planned_for?: string;
}
export interface BlockedItem {
  id: string;
  title: string;
  status: "blocked";
  order: number;
  parent_id?: string;
  follows?:
    | {
        type: "milestone";
        id: string;
      }
    | {
        type: "roadmap";
        id: string;
      };
  branch_id?: string;
  acceptance_criteria?: RoadmapStringArray;
  related_milestones?: RoadmapMilestoneIdArray;
  blocker_summary: string;
  blocked_by?: RoadmapBlockerArray;
  planned_for?: string;
}
export interface SupersededItem {
  id: string;
  title: string;
  status: "superseded";
  order: number;
  parent_id?: string;
  follows?:
    | {
        type: "milestone";
        id: string;
      }
    | {
        type: "roadmap";
        id: string;
      };
  branch_id?: string;
  acceptance_criteria?: RoadmapStringArray;
  related_milestones?: RoadmapMilestoneIdArray;
  blocker_summary?: string;
  blocked_by?: RoadmapBlockerArray;
  superseded_by: string;
  planned_for?: string;
}
