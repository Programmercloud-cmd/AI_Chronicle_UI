export interface HttpDiagnostic {
  code: string;
  sourcePath: string;
  message: string;
  severity?: "error" | "warning";
  phase?: string;
  recordKind?: string;
  recordId?: string;
  targetId?: string;
  relatedRecordId?: string;
  targetSourcePath?: string;
  relatedSourcePath?: string;
  instancePath?: string;
  keyword?: string;
  changeIndex?: number;
  pointer?: string;
}

type DiagnosticLike = Record<string, unknown>;

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9-]*$/u.test(value) && value.length <= 64
    ? value : undefined;
}

function safeIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9-]*$/u.test(value) && value.length <= 128
    ? value : undefined;
}

function safeRelativeSourcePath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return ".";
  if (value.includes("\\") || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:/u.test(value)) return ".";
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "..")) return ".";
  return value;
}

function safeInstancePath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 512) return undefined;
  if (value === "") return "";
  return /^\/(?:[A-Za-z0-9_~-]+(?:\/[A-Za-z0-9_~-]+)*)?$/u.test(value) ? value : undefined;
}

function genericMessage(code: string, phase: string | undefined): string {
  switch (code) {
    case "root-invalid": return "The Chronicle root is unavailable or is not a directory.";
    case "missing-required": return "Required Chronicle content is missing.";
    case "read-failed": return "Chronicle content could not be read.";
    case "unsafe-entry": return "A Chronicle entry is not a permitted regular file or directory.";
    case "unexpected-entry": return "The Chronicle directory contains an unsupported entry.";
    case "path-invalid": return "A declared artifact path is not a portable relative path.";
    case "path-escape": return "A declared artifact resolves outside the Chronicle root.";
    case "path-changed": return "An artifact path changed while it was being read.";
    case "not-regular-file": return "A declared artifact is not a regular file.";
    case "shape-invalid": return "A Chronicle record does not match the v1 schema.";
    case "filename-id-mismatch": return "A record filename does not match its stable ID.";
    case "case-collision": return "Chronicle paths collide when compared by portable ASCII case.";
    case "artifact-sha256-mismatch": return "Artifact bytes do not match the declared SHA-256 digest.";
    default: return phase === undefined
      ? "Chronicle validation failed; inspect this code and source path locally."
      : `Chronicle ${phase} validation failed; inspect this code and source path locally.`;
  }
}

export function projectHttpDiagnostics(diagnostics: readonly unknown[]): HttpDiagnostic[] {
  return diagnostics.map((input) => {
    const diagnostic: DiagnosticLike = typeof input === "object" && input !== null
      ? input as DiagnosticLike : {};
    const code = safeToken(diagnostic.code) ?? "validation-error";
    const phase = safeToken(diagnostic.phase);
    const projected: HttpDiagnostic = {
      code,
      sourcePath: safeRelativeSourcePath(diagnostic.sourcePath),
      message: genericMessage(code, phase),
    };
    const severity = diagnostic.severity === "error" || diagnostic.severity === "warning"
      ? diagnostic.severity : undefined;
    if (severity !== undefined) projected.severity = severity;
    if (phase !== undefined) projected.phase = phase;
    const recordKind = safeToken(diagnostic.recordKind);
    if (recordKind !== undefined) projected.recordKind = recordKind;
    for (const field of ["recordId", "targetId", "relatedRecordId"] as const) {
      const value = safeIdentifier(diagnostic[field]);
      if (value !== undefined) projected[field] = value;
    }
    for (const field of ["targetSourcePath", "relatedSourcePath"] as const) {
      if (diagnostic[field] !== undefined) projected[field] = safeRelativeSourcePath(diagnostic[field]);
    }
    const instancePath = safeInstancePath(diagnostic.instancePath);
    if (instancePath !== undefined) projected.instancePath = instancePath;
    const pointer = safeInstancePath(diagnostic.pointer);
    if (pointer !== undefined) projected.pointer = pointer;
    const keyword = safeToken(diagnostic.keyword);
    if (keyword !== undefined) projected.keyword = keyword;
    if (Number.isInteger(diagnostic.changeIndex) && Number(diagnostic.changeIndex) >= 0 && Number(diagnostic.changeIndex) <= 10_000) {
      projected.changeIndex = Number(diagnostic.changeIndex);
    }
    return projected;
  });
}
