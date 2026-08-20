import type { TimelineLayoutInput, TimelineMilestoneInput } from "../../../src/timeline";
import { canonicalHistoryInput } from "../../web/history/fixtures";

function milestone(
  id: string,
  day: number,
  branchId: string,
  parentIds: readonly string[],
): TimelineMilestoneInput {
  const occurredAtIso = `2026-05-${String(day).padStart(2, "0")}T10:00:00Z`;
  return {
    id,
    occurredAtIso,
    occurredAtEpochMs: Date.parse(occurredAtIso),
    title: `${branchId} milestone ${id}`,
    summary: `${id} demonstrates the larger branch fixture.`,
    status: id.endsWith("3") ? "rejected" : "accepted",
    branchId,
    parentIds,
    evidenceCount: 2,
  };
}

export function visualFixture(name: string): TimelineLayoutInput {
  const canonical = canonicalHistoryInput();
  if (name === "canonical") return canonical;
  if (name === "long-label") {
    return {
      ...canonical,
      milestones: canonical.milestones.map((item) => item.id === "TIM-002"
        ? {
            ...item,
            title: "Alternative timestamp synchronization strategy validated against the complete replay corpus",
          }
        : item),
    };
  }
  if (name === "linear") {
    return {
      ...canonical,
      branches: canonical.branches.slice(0, 1),
      milestones: canonical.milestones.slice(0, 4),
      current: { milestoneId: "CORE-004", state: "Linear fixture accepted" },
      projection: [],
    };
  }
  if (name === "multibranch") {
    return {
      displayTimeZone: "UTC",
      branches: [
        { id: "BR-01", title: "Main line" },
        { id: "BR-02", title: "Timing path" },
        { id: "BR-03", title: "Executor path" },
        { id: "BR-04", title: "Recovery path" },
        { id: "BR-05", title: "Validation path" },
      ],
      milestones: [
        milestone("M-001", 1, "BR-01", []),
        milestone("M-002", 2, "BR-01", ["M-001"]),
        milestone("M-003", 3, "BR-01", ["M-002"]),
        milestone("T-001", 5, "BR-02", ["M-002"]),
        milestone("T-002", 7, "BR-02", ["T-001"]),
        milestone("E-001", 8, "BR-03", ["M-003"]),
        milestone("E-002", 10, "BR-03", ["E-001"]),
        milestone("R-001", 12, "BR-04", ["T-001"]),
        milestone("R-002", 15, "BR-04", ["R-001", "E-002"]),
        milestone("V-001", 18, "BR-05", ["R-002"]),
        milestone("V-002", 22, "BR-05", ["V-001"]),
        milestone("V-003", 27, "BR-05", ["V-002"]),
      ],
      current: { milestoneId: "V-002", state: "Multi-branch recovery accepted" },
      projection: [
        { id: "RM-101", title: "Scale benchmark", status: "active", branchId: "BR-05", plannedFor: "2026-06-10" },
        { id: "RM-102", title: "Release review", status: "pending", branchId: "BR-05", plannedFor: "2026-06-24" },
      ],
    };
  }
  if (name === "scale") {
    const branches = Array.from({ length: 12 }, (_, index) => ({
      id: `BR-${String(index + 1).padStart(2, "0")}`,
      title: index === 0 ? "Scale main line" : `Scale branch ${index + 1}`,
    }));
    const milestones = Array.from({ length: 250 }, (_, index): TimelineMilestoneInput => {
      const branchIndex = index < 12 ? index : index % 12;
      const occurredAtEpochMs = Date.UTC(2020, 0, 1) + index * 3 * 86_400_000;
      const id = `S-${String(index).padStart(3, "0")}`;
      const parentIndex = index === 0 ? undefined : index < 12 ? 0 : index - 12;
      return {
        id,
        occurredAtIso: new Date(occurredAtEpochMs).toISOString(),
        occurredAtEpochMs,
        title: `Scale milestone ${index}`,
        summary: `Generated scale milestone ${index}.`,
        status: index % 31 === 0 ? "rejected" : "accepted",
        branchId: branches[branchIndex]!.id,
        parentIds: parentIndex === undefined ? [] : [`S-${String(parentIndex).padStart(3, "0")}`],
        evidenceCount: index % 4,
      };
    });
    return {
      displayTimeZone: "UTC",
      branches,
      milestones,
      current: { milestoneId: "S-249", state: "Scale fixture current state" },
      projection: Array.from({ length: 30 }, (_, index) => ({
        id: `RM-S${String(index).padStart(2, "0")}`,
        title: `Scale plan ${index}`,
        status: index === 0 ? "active" as const : "pending" as const,
        branchId: branches[9]!.id,
      })),
    };
  }
  throw new Error(`unknown visual fixture ${name}`);
}
