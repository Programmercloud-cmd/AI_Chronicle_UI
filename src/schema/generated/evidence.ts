/** Generated from schema/v1. Do not edit manually. */

export interface EvidenceRecord {
  schema_version: 1;
  id: string;
  captured_at: string;
  kind:
    | "test_output"
    | "benchmark"
    | "critic_report"
    | "screenshot"
    | "log"
    | "profile"
    | "experiment_report"
    | "diff"
    | "file"
    | "other";
  title: string;
  description?: string;
  source: ArtifactSource | UrlSource | RepositorySource;
  origin?: Origin;
}
export interface ArtifactSource {
  kind: "artifact";
  path: string;
  media_type: string;
  sha256: string;
}
export interface UrlSource {
  kind: "url";
  url: string;
}
export interface RepositorySource {
  kind: "repository_ref";
  path: string;
  revision: string;
}
export interface Origin {
  tool: string;
  command?: string;
  base_revision?: string;
  target_revision?: string;
}
