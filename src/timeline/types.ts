export type TimelineMilestoneStatus =
  | "accepted"
  | "rejected"
  | "abandoned"
  | "blocked"
  | "informational";

export type TimelineProjectionStatus = "pending" | "active" | "blocked";

export interface TimelineBranchInput {
  id: string;
  title: string;
}

export interface TimelineMilestoneInput {
  id: string;
  occurredAtIso: string;
  occurredAtEpochMs: number;
  title: string;
  summary: string;
  status: TimelineMilestoneStatus;
  branchId: string;
  parentIds: readonly string[];
  evidenceCount: number;
}

export interface TimelineCurrentInput {
  milestoneId: string;
  state: string;
}

export interface TimelineProjectionInput {
  id: string;
  title: string;
  status: TimelineProjectionStatus;
  branchId: string;
  plannedFor?: string;
}

export interface TimelineLayoutInput {
  displayTimeZone: string;
  branches: readonly TimelineBranchInput[];
  milestones: readonly TimelineMilestoneInput[];
  current?: TimelineCurrentInput;
  projection: readonly TimelineProjectionInput[];
}

export interface TimelineLayoutTokens {
  leftPadding: number;
  rightPadding: number;
  topPadding: number;
  bottomPadding: number;
  nominalMonthWidth: number;
  minimumMilestoneGap: number;
  minimumProjectionGap: number;
  laneGap: number;
  undatedSectionGap: number;
  undatedItemGap: number;
  labelTierGap: number;
  labelAngleDegrees: number;
  maximumVisibleTitleGraphemes: number;
  averageGraphemeWidth: number;
  labelClearance: number;
  labelBaseExtent: number;
  monthAxisGap: number;
}

export interface TimelineCalendar {
  monthKeyForInstant(epochMs: number, timeZone: string): string;
  monthStartEpochMs(monthKey: string, timeZone: string): number;
  nextMonthKey(monthKey: string): string;
  localNoonEpochMs(date: string, timeZone: string): number;
  formatMonth(monthKey: string): string;
}

export interface TimelineNodeAccessibility {
  fullLabel: string;
  description: string;
  branchId: string;
  branchTitle: string;
  parentIds: readonly string[];
  childIds: readonly string[];
  evidenceCount?: number;
  exactTimestampIso?: string;
  plannedFor?: string;
  currentState?: string;
  positionInSet: number;
  setSize: number;
}

export interface TimelineNodeLayout {
  id: string;
  sourceKind: "milestone" | "roadmap";
  x: number;
  y: number;
  laneIndex: number;
  branchId: string;
  treatment: "historical" | "current" | "planned-dated" | "planned-undated";
  status: TimelineMilestoneStatus | TimelineProjectionStatus;
  fullTitle: string;
  visibleTitle: string;
  titleWasTruncated: boolean;
  label: {
    side: "above" | "below";
    tier: number;
    angleDegrees: number;
  };
  exactTimestampIso?: string;
  plannedFor?: string;
  monthKey?: string;
  currentState?: string;
  calloutLabel?: "CURRENT STATE";
  target: { kind: "milestone" | "roadmap"; id: string };
  accessibility: TimelineNodeAccessibility;
}

export interface TimelinePoint {
  x: number;
  y: number;
}

export interface TimelineEdgeLayout {
  id: string;
  fromId: string;
  toId: string;
  kind: "continuation" | "branch-origin" | "merge" | "projection";
  owningBranchId: string;
  points: readonly [TimelinePoint, TimelinePoint];
  accessibleLabel: string;
}

export interface TimelineLaneLayout {
  branchId: string;
  branchTitle: string;
  laneIndex: number;
  y: number;
  styleOrdinal: number;
}

export interface TimelineMonthBand {
  monthKey: string;
  label: string;
  xStart: number;
  xEnd: number;
  y: number;
  historicalNodeIds: readonly string[];
  datedProjectionIds: readonly string[];
}

export interface TimelineZone {
  kind: "undated-plan";
  xStart: number;
  xEnd: number;
  y: number;
  label: "UNDATED PLAN";
}

export interface TimelineLayout {
  timeScale: {
    kind: "compressed-calendar";
    proportional: false;
  };
  width: number;
  height: number;
  lanes: readonly TimelineLaneLayout[];
  nodes: readonly TimelineNodeLayout[];
  edges: readonly TimelineEdgeLayout[];
  monthBands: readonly TimelineMonthBand[];
  zones: readonly TimelineZone[];
  navigation: {
    startX?: number;
    currentX?: number;
    historyEndX?: number;
    fullEndX?: number;
  };
  readingOrder: readonly string[];
}

export interface TimelineLayoutDiagnostic {
  code:
    | "invalid-time"
    | "calendar-error"
    | "missing-branch"
    | "empty-branch"
    | "missing-parent"
    | "missing-current"
    | "projection-without-current"
    | "projection-branch-mismatch"
    | "projection-order-invalid"
    | "non-finite-coordinate";
  message: string;
  recordId?: string;
}

export type TimelineLayoutResult =
  | { ok: true; value: TimelineLayout }
  | { ok: false; diagnostics: readonly TimelineLayoutDiagnostic[] };
