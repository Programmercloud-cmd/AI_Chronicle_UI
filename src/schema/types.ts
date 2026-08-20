import type {
  BranchRecord,
  CurrentRecord,
  EngineeringEventRecord,
  EvidenceRecord,
  MilestoneRecord,
  ProjectRecord,
  RevisionRecord,
  RoadmapRecord,
} from "./generated";

export type ChronicleRecordKind =
  | "project"
  | "branch"
  | "milestone"
  | "current"
  | "roadmap"
  | "evidence"
  | "engineering-event"
  | "revision";

export interface ChronicleRecordByKind {
  project: ProjectRecord;
  branch: BranchRecord;
  milestone: MilestoneRecord;
  current: CurrentRecord;
  roadmap: RoadmapRecord;
  evidence: EvidenceRecord;
  "engineering-event": EngineeringEventRecord;
  revision: RevisionRecord;
}

export interface RecordValidationSource {
  sourcePath: string;
  recordId?: string;
}

export interface StructuralDiagnostic {
  sourcePath: string;
  recordKind: ChronicleRecordKind;
  recordId?: string;
  instancePath: string;
  keyword: string;
  message: string;
}

export type ShapeValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; diagnostics: StructuralDiagnostic[] };
