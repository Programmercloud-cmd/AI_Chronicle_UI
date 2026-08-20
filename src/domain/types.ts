import type {
  BranchRecord,
  CurrentRecord,
  EngineeringEventRecord,
  EvidenceRecord,
  MilestoneRecord,
  ProjectRecord,
  RevisionRecord,
  RoadmapRecord,
} from "../schema";
import type { ChronicleSnapshot, SourcedRecord } from "../data";

export type DomainPhase =
  | "identity"
  | "revision-chain"
  | "revision-apply"
  | "time"
  | "milestone-graph"
  | "branch"
  | "relation"
  | "current"
  | "roadmap"
  | "engineering-event"
  | "evidence"
  | "projection";

export interface DomainDiagnostic {
  severity: "error" | "warning";
  phase: DomainPhase;
  code: string;
  sourcePath: string;
  message: string;
  recordId?: string;
  targetId?: string;
  targetSourcePath?: string;
  relatedRecordId?: string;
  relatedSourcePath?: string;
  instancePath?: string;
  changeIndex?: number;
  pointer?: string;
}

export interface Amendment<T> {
  revisionId: string;
  sourcePath: string;
  recordedAt: string;
  before: T;
  after: T;
}

export interface ProjectedRecord<T> extends SourcedRecord<T> {
  original: T;
  amendments: Amendment<T>[];
}

export interface ValidatedChronicle {
  rootPath: string;
  project: SourcedRecord<ProjectRecord>;
  current?: SourcedRecord<CurrentRecord>;
  roadmap: SourcedRecord<RoadmapRecord>;
  branches: ProjectedRecord<BranchRecord>[];
  milestones: ProjectedRecord<MilestoneRecord>[];
  engineeringEvents: ProjectedRecord<EngineeringEventRecord>[];
  revisions: SourcedRecord<RevisionRecord>[];
  evidence: SourcedRecord<EvidenceRecord>[];
  warnings: DomainDiagnostic[];
}

export type DomainValidationResult =
  | { ok: true; value: ValidatedChronicle }
  | { ok: false; diagnostics: DomainDiagnostic[] };

export type RevisableRecord =
  | BranchRecord
  | MilestoneRecord
  | EngineeringEventRecord;

export interface RevisionProjection {
  branches: ProjectedRecord<BranchRecord>[];
  milestones: ProjectedRecord<MilestoneRecord>[];
  engineeringEvents: ProjectedRecord<EngineeringEventRecord>[];
}

export interface RevisionProjectionResult {
  projection?: RevisionProjection;
  diagnostics: DomainDiagnostic[];
}

export type ArtifactReader = (
  snapshot: ChronicleSnapshot,
  evidence: SourcedRecord<EvidenceRecord>,
) => Promise<{ ok: true; bytes: Buffer } | { ok: false; diagnostics: DomainDiagnostic[] }>;
