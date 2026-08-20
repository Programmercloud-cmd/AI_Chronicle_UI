import type { DomainDiagnostic } from "./types";

const phaseOrder = [
  "identity", "revision-chain", "revision-apply", "time", "milestone-graph",
  "branch", "relation", "current", "roadmap", "engineering-event", "evidence", "projection",
] as const;

export function sortDomainDiagnostics(input: DomainDiagnostic[]): DomainDiagnostic[] {
  const rank = new Map(phaseOrder.map((phase, index) => [phase, index]));
  const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
  return [...input].sort((a, b) =>
    (rank.get(a.phase) ?? 99) - (rank.get(b.phase) ?? 99) ||
    compare(a.sourcePath, b.sourcePath) || compare(a.recordId ?? "", b.recordId ?? "") ||
    compare(a.instancePath ?? "", b.instancePath ?? "") ||
    (a.changeIndex ?? -1) - (b.changeIndex ?? -1) || compare(a.code, b.code) || compare(a.message, b.message));
}

export function errorDiagnostic(
  phase: DomainDiagnostic["phase"], code: string, sourcePath: string, message: string,
  fields: Partial<Omit<DomainDiagnostic, "severity" | "phase" | "code" | "sourcePath" | "message">> = {},
): DomainDiagnostic {
  return { severity: "error", phase, code, sourcePath, message, ...fields };
}

export function warningDiagnostic(
  phase: DomainDiagnostic["phase"], code: string, sourcePath: string, message: string,
  fields: Partial<Omit<DomainDiagnostic, "severity" | "phase" | "code" | "sourcePath" | "message">> = {},
): DomainDiagnostic {
  return { severity: "warning", phase, code, sourcePath, message, ...fields };
}
