import type {
  BranchRecord,
  CurrentRecord,
  EngineeringEventRecord,
  EvidenceRecord,
  MilestoneRecord,
  ProjectRecord,
  RevisionRecord,
  RoadmapRecord,
  StructuralDiagnostic,
} from "../schema";

export type DataDiagnosticCode =
  | "root-invalid"
  | "missing-required"
  | "unexpected-entry"
  | "unsafe-entry"
  | "read-failed"
  | "yaml-invalid"
  | "yaml-forbidden"
  | "shape-invalid"
  | "filename-id-mismatch"
  | "case-collision"
  | "path-invalid"
  | "path-escape"
  | "path-changed"
  | "not-regular-file";

export interface DataDiagnostic {
  code: DataDiagnosticCode;
  sourcePath: string;
  message: string;
  recordKind?: StructuralDiagnostic["recordKind"];
  recordId?: string;
  instancePath?: string;
  keyword?: string;
}

export interface SourcedRecord<T> {
  sourcePath: string;
  value: T;
}

export interface ChronicleSnapshot {
  rootPath: string;
  project: SourcedRecord<ProjectRecord>;
  current?: SourcedRecord<CurrentRecord>;
  roadmap: SourcedRecord<RoadmapRecord>;
  branches: SourcedRecord<BranchRecord>[];
  milestones: SourcedRecord<MilestoneRecord>[];
  engineeringEvents: SourcedRecord<EngineeringEventRecord>[];
  revisions: SourcedRecord<RevisionRecord>[];
  evidence: SourcedRecord<EvidenceRecord>[];
}

export type DataResult<T> =
  | { ok: true; value: T }
  | { ok: false; diagnostics: DataDiagnostic[] };

export interface ChronicleRoot {
  inputPath: string;
  realPath: string;
}

export interface ArtifactRead {
  locator: string;
  realPath: string;
  size: number;
  bytes: Buffer;
}
