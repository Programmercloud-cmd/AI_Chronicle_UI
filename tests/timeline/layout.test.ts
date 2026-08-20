import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIMELINE_LAYOUT_TOKENS,
  layoutTimeline,
  type TimelineLayout,
  type TimelineLayoutInput,
  type TimelineMilestoneInput,
} from "../../src/timeline";
import { exampleTimelineInput } from "./example-input";

function expectLayout(input: TimelineLayoutInput): TimelineLayout {
  const result = layoutTimeline(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}

function milestone(
  id: string,
  occurredAtIso: string,
  options: Partial<TimelineMilestoneInput> = {},
): TimelineMilestoneInput {
  return {
    id,
    occurredAtIso,
    occurredAtEpochMs: Date.parse(occurredAtIso),
    title: id,
    summary: `${id} summary`,
    status: "accepted",
    branchId: "BR-MAIN",
    parentIds: [],
    evidenceCount: 0,
    ...options,
  };
}

describe("timeline layout", () => {
  it("returns an explicit empty state without inventing lanes or month bands", () => {
    const layout = expectLayout({
      displayTimeZone: "UTC",
      branches: [],
      milestones: [],
      projection: [],
    });
    expect(layout.nodes).toEqual([]);
    expect(layout.lanes).toEqual([]);
    expect(layout.monthBands).toEqual([]);
    expect(layout.navigation).toEqual({});
  });

  it("produces the canonical data-driven topology and month projection", async () => {
    const layout = expectLayout(await exampleTimelineInput("canonical"));

    expect(layout.timeScale).toEqual({ kind: "compressed-calendar", proportional: false });
    expect(layout.lanes.map((lane) => [lane.branchId, lane.laneIndex])).toEqual([
      ["BR-MAIN", 0],
      ["BR-TIMING", 1],
    ]);
    expect(layout.readingOrder).toEqual([
      "CORE-001",
      "CORE-002",
      "CORE-003",
      "CORE-004",
      "TIM-001",
      "TIM-002",
      "TIM-003",
      "TIM-004",
      "RM-003",
      "RM-004",
      "RM-005",
    ]);
    expect(layout.edges.find((edge) => edge.id === "historical:CORE-003->TIM-001")?.kind).toBe(
      "branch-origin",
    );
    const current = layout.nodes.find((node) => node.id === "TIM-004")!;
    expect(current.treatment).toBe("current");
    expect(current.calloutLabel).toBe("CURRENT STATE");
    expect(current.currentState).toContain("Stable timestamp handling");
    expect(current.exactTimestampIso).toBe("2026-05-05T14:30:52+02:00");
    expect(layout.nodes.filter((node) => node.sourceKind === "roadmap").map((node) => node.id)).toEqual([
      "RM-003",
      "RM-004",
      "RM-005",
    ]);
    expect(layout.monthBands.map((band) => band.monthKey)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
    expect(layout.monthBands.find((band) => band.monthKey === "2026-05")?.datedProjectionIds).toEqual([
      "RM-003",
    ]);
    expect(layout.monthBands.find((band) => band.monthKey === "2026-06")?.datedProjectionIds).toEqual([
      "RM-004",
      "RM-005",
    ]);
    expect(layout.nodes.every((node) => node.accessibility.fullLabel.includes(node.fullTitle))).toBe(true);
    for (const edge of layout.edges.filter((candidate) => candidate.kind !== "projection")) {
      expect(edge.points[1].x).toBeGreaterThan(edge.points[0].x);
    }
  });

  it("clamps a same-date local-noon plan after an afternoon current node", () => {
    const input: TimelineLayoutInput = {
      displayTimeZone: "Europe/Paris",
      branches: [{ id: "BR-MAIN", title: "Main" }],
      milestones: [milestone("CORE-001", "2026-05-05T14:30:52+02:00")],
      current: { milestoneId: "CORE-001", state: "Accepted state" },
      projection: [
        {
          id: "RM-001",
          title: "Same day plan",
          status: "active",
          branchId: "BR-MAIN",
          plannedFor: "2026-05-05",
        },
      ],
    };
    const layout = expectLayout(input);
    const current = layout.nodes.find((node) => node.id === "CORE-001")!;
    const planned = layout.nodes.find((node) => node.id === "RM-001")!;
    expect(planned.x - current.x).toBeGreaterThanOrEqual(
      DEFAULT_TIMELINE_LAYOUT_TOKENS.minimumProjectionGap,
    );
    expect(planned.plannedFor).toBe("2026-05-05");
    expect(planned.monthKey).toBe("2026-05");
    const may = layout.monthBands.find((band) => band.monthKey === "2026-05")!;
    expect(may.xStart).toBeLessThan(planned.x);
    expect(may.xEnd).toBeGreaterThan(planned.x);
  });

  it("separates a dated projection from an unrelated milestone at the same instant", () => {
    const layout = expectLayout({
      displayTimeZone: "UTC",
      branches: [{ id: "BR-MAIN", title: "Main" }],
      milestones: [
        milestone("CORE-001", "2026-05-01T12:00:00Z"),
        milestone("CORE-002", "2026-05-10T12:00:00Z", {
          parentIds: ["CORE-001"],
        }),
      ],
      current: { milestoneId: "CORE-001", state: "Accepted state" },
      projection: [
        {
          id: "RM-001",
          title: "Plan at occupied instant",
          status: "pending",
          branchId: "BR-MAIN",
          plannedFor: "2026-05-10",
        },
      ],
    });
    const unrelated = layout.nodes.find((node) => node.id === "CORE-002")!;
    const projected = layout.nodes.find((node) => node.id === "RM-001")!;
    expect(projected.x - unrelated.x).toBeGreaterThanOrEqual(
      DEFAULT_TIMELINE_LAYOUT_TOKENS.minimumProjectionGap,
    );
    expect(projected.plannedFor).toBe("2026-05-10");
  });

  it("moves a later historical node clear of a nominally earlier projection", () => {
    const layout = expectLayout({
      displayTimeZone: "UTC",
      branches: [{ id: "BR-MAIN", title: "Main" }],
      milestones: [
        milestone("CORE-001", "2026-05-01T12:00:00Z"),
        milestone("CORE-002", "2026-05-20T12:00:00Z", {
          parentIds: ["CORE-001"],
        }),
      ],
      current: { milestoneId: "CORE-001", state: "Accepted state" },
      projection: [
        {
          id: "RM-001",
          title: "Plan before later history",
          status: "pending",
          branchId: "BR-MAIN",
          plannedFor: "2026-05-10",
        },
      ],
    });
    const current = layout.nodes.find((node) => node.id === "CORE-001")!;
    const projected = layout.nodes.find((node) => node.id === "RM-001")!;
    const laterHistory = layout.nodes.find((node) => node.id === "CORE-002")!;
    expect(projected.x - current.x).toBeGreaterThanOrEqual(
      DEFAULT_TIMELINE_LAYOUT_TOKENS.minimumProjectionGap,
    );
    expect(laterHistory.x - projected.x).toBeGreaterThanOrEqual(
      DEFAULT_TIMELINE_LAYOUT_TOKENS.minimumProjectionGap,
    );
    const may = layout.monthBands.find((band) => band.monthKey === "2026-05")!;
    expect(may.xEnd).toBeGreaterThan(laterHistory.x);
  });

  it("expands a dense week and preserves exact-instant stable-ID order", () => {
    const dense: TimelineMilestoneInput[] = [];
    for (let index = 0; index < 10; index += 1) {
      const id = `CORE-${String(index + 1).padStart(3, "0")}`;
      dense.push(
        milestone(id, `2026-04-${String(index + 1).padStart(2, "0")}T09:00:00+02:00`, {
          parentIds: index === 0 ? [] : [dense[index - 1]!.id],
        }),
      );
    }
    dense.push(milestone("TEST-001", "2026-04-11T09:00:00+02:00", { parentIds: ["CORE-010"] }));
    dense.push(milestone("UI-001", "2026-04-11T09:00:00+02:00", { parentIds: ["CORE-010"] }));
    const layout = expectLayout({
      displayTimeZone: "Europe/Paris",
      branches: [{ id: "BR-MAIN", title: "Main" }],
      milestones: dense.reverse(),
      projection: [],
    });
    const historical = layout.nodes.filter((node) => node.sourceKind === "milestone");
    expect(historical.map((node) => node.id).slice(-2)).toEqual(["TEST-001", "UI-001"]);
    for (let index = 1; index < historical.length; index += 1) {
      expect(historical[index]!.x - historical[index - 1]!.x).toBeGreaterThanOrEqual(
        DEFAULT_TIMELINE_LAYOUT_TOKENS.minimumMilestoneGap,
      );
    }
    const april = layout.monthBands[0]!;
    expect(april.xEnd - april.xStart).toBeGreaterThan(
      DEFAULT_TIMELINE_LAYOUT_TOKENS.nominalMonthWidth,
    );
    expect(april.historicalNodeIds).toHaveLength(12);
  });

  it("expands events distributed across one dense calendar month", () => {
    const days = [1, 5, 9, 13, 17, 21, 25, 29];
    const milestones = days.map((day, index) =>
      milestone(
        `CORE-${String(index + 1).padStart(3, "0")}`,
        `2026-04-${String(day).padStart(2, "0")}T09:00:00Z`,
        { parentIds: index === 0 ? [] : [`CORE-${String(index).padStart(3, "0")}`] },
      ),
    );
    const layout = expectLayout({
      displayTimeZone: "UTC",
      branches: [{ id: "BR-MAIN", title: "Main" }],
      milestones,
      projection: [],
    });
    const historical = layout.nodes.filter((node) => node.sourceKind === "milestone");
    for (let index = 1; index < historical.length; index += 1) {
      expect(historical[index]!.x - historical[index - 1]!.x).toBeGreaterThanOrEqual(
        DEFAULT_TIMELINE_LAYOUT_TOKENS.minimumMilestoneGap,
      );
    }
    const april = layout.monthBands.find((band) => band.monthKey === "2026-04")!;
    expect(april.historicalNodeIds).toHaveLength(days.length);
    expect(april.xEnd - april.xStart).toBeGreaterThan(
      DEFAULT_TIMELINE_LAYOUT_TOKENS.nominalMonthWidth,
    );
  });

  it("keeps six-month and two-year gaps visible without millisecond-proportional width", () => {
    const layout = expectLayout({
      displayTimeZone: "UTC",
      branches: [{ id: "BR-MAIN", title: "Main" }],
      milestones: [
        milestone("CORE-001", "2024-01-15T12:00:00Z"),
        milestone("CORE-002", "2024-07-15T12:00:00Z", { parentIds: ["CORE-001"] }),
        milestone("CORE-003", "2026-01-15T12:00:00Z", { parentIds: ["CORE-002"] }),
      ],
      projection: [],
    });
    expect(layout.monthBands).toHaveLength(25);
    const january2024 = layout.monthBands.find((band) => band.monthKey === "2024-01")!;
    const july2024 = layout.monthBands.find((band) => band.monthKey === "2024-07")!;
    const january2026 = layout.monthBands.find((band) => band.monthKey === "2026-01")!;
    expect(july2024.xStart - january2024.xStart).toBe(
      6 * DEFAULT_TIMELINE_LAYOUT_TOKENS.nominalMonthWidth,
    );
    expect(january2026.xStart - january2024.xStart).toBe(
      24 * DEFAULT_TIMELINE_LAYOUT_TOKENS.nominalMonthWidth,
    );
    expect(layout.width).toBeLessThan(5_000);
  });

  it("keeps difficult merge ownership, older-parent forks, and abandoned paths", async () => {
    const layout = expectLayout(await exampleTimelineInput("difficult"));
    const recoveryLane = layout.lanes.find((lane) => lane.branchId === "BR-RECOVERY")!;
    expect(layout.nodes.find((node) => node.id === "REC-002")?.laneIndex).toBe(
      recoveryLane.laneIndex,
    );
    expect(layout.edges.find((edge) => edge.id === "historical:REC-001->REC-002")?.kind).toBe(
      "continuation",
    );
    expect(layout.edges.find((edge) => edge.id === "historical:CORE-005->REC-002")?.kind).toBe(
      "merge",
    );
    expect(layout.edges.find((edge) => edge.id === "historical:CORE-002->REG-001")?.kind).toBe(
      "branch-origin",
    );
    expect(layout.nodes.find((node) => node.id === "EXEC-001")?.status).toBe("rejected");
    expect(layout.nodes.find((node) => node.id === "EXEC-002")?.status).toBe("abandoned");
    const olderParent = layout.nodes.find((node) => node.id === "CORE-002")!;
    const laterFork = layout.nodes.find((node) => node.id === "REG-001")!;
    expect(laterFork.x).toBeGreaterThan(olderParent.x);
  });

  it("truncates long Unicode labels at grapheme boundaries without moving nodes", () => {
    const longTitle = `Clock ${"e\u0301".repeat(30)} ${"🛰️".repeat(20)} validation conclusion`;
    const base: TimelineLayoutInput = {
      displayTimeZone: "UTC",
      branches: [{ id: "BR-MAIN", title: "Main" }],
      milestones: [
        milestone("CORE-001", "2026-01-01T12:00:00Z", { title: longTitle }),
        milestone("CORE-002", "2026-01-02T12:00:00Z", {
          title: longTitle,
          parentIds: ["CORE-001"],
        }),
      ],
      projection: [],
    };
    const longLayout = expectLayout(base);
    const shortLayout = expectLayout({
      ...base,
      milestones: base.milestones.map((item) =>
        item.id === "CORE-002" ? { ...item, title: "Short" } : item,
      ),
    });
    const node = longLayout.nodes.find((item) => item.id === "CORE-002")!;
    expect(node.titleWasTruncated).toBe(true);
    expect(node.visibleTitle.endsWith("…")).toBe(true);
    expect(node.fullTitle).toBe(longTitle);
    expect(node.accessibility.fullLabel).toContain(longTitle);
    expect(node.x).toBe(shortLayout.nodes.find((item) => item.id === "CORE-002")!.x);
    expect(node.label.tier).toBeGreaterThan(0);
  });

  it("places undated work after a distinct divider without extending month bands", () => {
    const layout = expectLayout({
      displayTimeZone: "UTC",
      branches: [{ id: "BR-MAIN", title: "Main" }],
      milestones: [milestone("CORE-001", "2026-05-05T14:30:52Z")],
      current: { milestoneId: "CORE-001", state: "Current" },
      projection: [
        {
          id: "RM-001",
          title: "Dated",
          status: "active",
          branchId: "BR-MAIN",
          plannedFor: "2026-06-01",
        },
        { id: "RM-002", title: "Undated A", status: "pending", branchId: "BR-MAIN" },
        { id: "RM-003", title: "Undated B", status: "blocked", branchId: "BR-MAIN" },
      ],
    });
    expect(layout.monthBands.map((band) => band.monthKey)).toEqual(["2026-05", "2026-06"]);
    expect(layout.zones).toHaveLength(1);
    const zone = layout.zones[0]!;
    const dated = layout.nodes.find((node) => node.id === "RM-001")!;
    const firstUndated = layout.nodes.find((node) => node.id === "RM-002")!;
    const secondUndated = layout.nodes.find((node) => node.id === "RM-003")!;
    expect(dated.x).toBeLessThan(zone.xStart);
    expect(firstUndated.x).toBeGreaterThan(zone.xStart);
    expect(secondUndated.x - firstUndated.x).toBe(
      DEFAULT_TIMELINE_LAYOUT_TOKENS.undatedItemGap,
    );
    expect(firstUndated.treatment).toBe("planned-undated");
    expect(firstUndated.plannedFor).toBeUndefined();
    expect(firstUndated.monthKey).toBeUndefined();
  });

  it("uses the explicit current pointer when a later rejected milestone exists", () => {
    const layout = expectLayout({
      displayTimeZone: "UTC",
      branches: [{ id: "BR-MAIN", title: "Main" }],
      milestones: [
        milestone("CORE-001", "2026-05-01T12:00:00Z"),
        milestone("CORE-002", "2026-05-10T12:00:00Z", {
          status: "rejected",
          parentIds: ["CORE-001"],
        }),
      ],
      current: { milestoneId: "CORE-001", state: "Restored accepted state" },
      projection: [
        {
          id: "RM-001",
          title: "Next experiment",
          status: "pending",
          branchId: "BR-MAIN",
          plannedFor: "2026-05-20",
        },
      ],
    });
    expect(layout.nodes.find((node) => node.id === "CORE-001")?.treatment).toBe("current");
    expect(layout.nodes.find((node) => node.id === "CORE-002")?.treatment).toBe("historical");
    expect(layout.navigation.currentX).toBeLessThan(layout.navigation.historyEndX!);
    expect(layout.edges.find((edge) => edge.id === "projection:CORE-001->RM-001")).toBeDefined();
  });

  it("is byte-deterministic under shuffled branch and milestone arrays", async () => {
    const input = await exampleTimelineInput("difficult");
    const expected = expectLayout(input);
    const shuffled = expectLayout({
      ...input,
      branches: [...input.branches].reverse(),
      milestones: [...input.milestones].sort((left, right) => compareIds(right.id, left.id)),
    });
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(expected));
  });

  it("reports defensive boundary failures instead of dropping records", () => {
    const missingBranch = layoutTimeline({
      displayTimeZone: "UTC",
      branches: [],
      milestones: [milestone("CORE-001", "2026-01-01T12:00:00Z")],
      projection: [],
    });
    expect(missingBranch.ok).toBe(false);
    if (!missingBranch.ok) expect(missingBranch.diagnostics[0]?.code).toBe("missing-branch");

    const noCurrent = layoutTimeline({
      displayTimeZone: "UTC",
      branches: [{ id: "BR-MAIN", title: "Main" }],
      milestones: [milestone("CORE-001", "2026-01-01T12:00:00Z")],
      projection: [{ id: "RM-001", title: "Plan", status: "pending", branchId: "BR-MAIN" }],
    });
    expect(noCurrent.ok).toBe(false);
    if (!noCurrent.ok) expect(noCurrent.diagnostics.some((item) => item.code === "projection-without-current")).toBe(true);
  });

  it("lays out the documented scale target within a bounded developer budget", () => {
    const branches = Array.from({ length: 12 }, (_, index) => ({
      id: `BR-${String(index + 1).padStart(2, "0")}`,
      title: `Branch ${index + 1}`,
    }));
    const milestones: TimelineMilestoneInput[] = [];
    for (let index = 0; index < 250; index += 1) {
      const branchIndex = index % branches.length;
      const priorOnBranch = index - branches.length;
      const date = new Date(Date.UTC(2021, 0, 1 + index * 7, 12));
      milestones.push(
        milestone(`CORE-${String(index + 1).padStart(3, "0")}`, date.toISOString(), {
          branchId: branches[branchIndex]!.id,
          parentIds:
            index === 0
              ? []
              : priorOnBranch >= 0
                ? [milestones[priorOnBranch]!.id]
                : [milestones[0]!.id],
        }),
      );
    }
    const current = milestones.at(-1)!;
    const projection = Array.from({ length: 30 }, (_, index) => ({
      id: `RM-${String(index + 1).padStart(3, "0")}`,
      title: `Projected item ${index + 1}`,
      status: "pending" as const,
      branchId: current.branchId,
      plannedFor: new Date(Date.UTC(2025, 10 + index, 15)).toISOString().slice(0, 10),
    }));
    const started = performance.now();
    const layout = expectLayout({
      displayTimeZone: "UTC",
      branches,
      milestones,
      current: { milestoneId: current.id, state: "Scale fixture current" },
      projection,
    });
    const elapsed = performance.now() - started;
    expect(layout.nodes).toHaveLength(280);
    expect(layout.lanes).toHaveLength(12);
    expect(elapsed).toBeLessThan(1_000);
  });
});

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
