import type {
  MilestoneRecord,
  RoadmapItem,
  RoadmapRecord,
} from "../schema";

export type HistoricalAnnotationKind = "superseded-by" | "disproved-by";

export interface HistoricalAnnotation {
  readonly kind: HistoricalAnnotationKind;
  readonly sourceMilestoneId: string;
  readonly sourceMilestoneTitle: string;
  readonly sourceOccurredAt: string;
  readonly explanation: string;
}

export interface MilestoneLink {
  readonly type: "milestone";
  readonly id: string;
  readonly title: string;
  readonly status: MilestoneRecord["status"];
  readonly annotations: readonly HistoricalAnnotation[];
}

export interface RoadmapLink {
  readonly type: "roadmap";
  readonly id: string;
  readonly title: string;
  readonly status: RoadmapItem["status"];
}

export type EntityLink = MilestoneLink | RoadmapLink;

export interface RoadmapItemPresentation {
  readonly id: string;
  readonly title: string;
  readonly status: RoadmapItem["status"];
  readonly order: number;
  readonly parentId?: string;
  readonly follows?: EntityLink;
  readonly branchId?: string;
  readonly acceptanceCriteria: readonly string[];
  readonly relatedMilestones: readonly MilestoneLink[];
  readonly blockerSummary?: string;
  readonly blockedBy: readonly EntityLink[];
  readonly supersededBy?: RoadmapLink;
  readonly plannedFor?: string;
}

export interface RoadmapOutlineEntry {
  readonly item: RoadmapItemPresentation;
  readonly depth: number;
}

export interface ProjectedRoadmapItem {
  readonly item: RoadmapItemPresentation;
  readonly projectionIndex: number;
  readonly plannedFor?: string;
}

export interface ResolvedCurrentBlocker {
  readonly summary: string;
  readonly blockedBy: readonly EntityLink[];
}

export interface CurrentPresentation {
  /** Freshness of the operational project summary, not milestone chronology. */
  readonly updatedAt: string;
  readonly milestone: {
    readonly id: string;
    readonly title: string;
    readonly summary: string;
    readonly status: MilestoneRecord["status"];
    readonly branchId: string;
    readonly occurredAt: string;
    readonly recordedAt: string;
    readonly annotations: readonly HistoricalAnnotation[];
  };
  readonly state: string;
  readonly currentHypothesis?: string;
  readonly activeWork: readonly string[];
  readonly nextStep?: string;
  readonly blocked: readonly ResolvedCurrentBlocker[];
  readonly relatedRoadmapItems: readonly RoadmapLink[];
}

export interface CurrentRoadmapPresentation {
  readonly current?: CurrentPresentation;
  readonly roadmap: {
    readonly updatedAt: RoadmapRecord["updated_at"];
    readonly outline: readonly RoadmapOutlineEntry[];
  };
  readonly historyProjection: readonly ProjectedRoadmapItem[];
}

