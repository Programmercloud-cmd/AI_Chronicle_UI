import type { StructuralDiagnostic } from "../schema";
import type { DataDiagnostic } from "./types";

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export function sortDiagnostics(diagnostics: DataDiagnostic[]): DataDiagnostic[] {
  return [...diagnostics].sort(
    (left, right) =>
      compareText(left.sourcePath, right.sourcePath) ||
      compareText(left.instancePath ?? "", right.instancePath ?? "") ||
      compareText(left.code, right.code) ||
      compareText(left.message, right.message),
  );
}

export function fromStructuralDiagnostic(
  diagnostic: StructuralDiagnostic,
): DataDiagnostic {
  return {
    code: "shape-invalid",
    sourcePath: diagnostic.sourcePath,
    message: diagnostic.message,
    recordKind: diagnostic.recordKind,
    ...(diagnostic.recordId === undefined ? {} : { recordId: diagnostic.recordId }),
    instancePath: diagnostic.instancePath,
    keyword: diagnostic.keyword,
  };
}
