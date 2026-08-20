import { describe, expect, it } from "vitest";

import type { PublicChronicleSnapshot } from "../../../src/web/app-shell/snapshot";
import {
  buildMilestoneNeighborhood,
  type MilestoneNeighborhoodRecord,
} from "../../../src/web/detail/milestone-neighborhood-model";

interface MilestoneOptions {
  parents?: readonly string[];
  occurredAt?: string;
  relations?: readonly {
    type: "supersedes" | "disproves" | "reverts_to" | "related_to";
    target: string;
    explanation: string;
  }[];
}

function milestone(
  id: string,
  {
    parents = [],
    occurredAt = "2025-01-01T00:00:00Z",
    relations,
  }: MilestoneOptions = {},
): MilestoneNeighborhoodRecord {
  const value = {
    schema_version: 1 as const,
    id,
    occurred_at: occurredAt,
    recorded_at: occurredAt,
    title: `Title ${id}`,
    summary: `Summary ${id}`,
    branch_id: "BR-MAIN",
    parents: [...parents],
    status: "accepted" as const,
    ...(relations === undefined ? {} : { relations: [...relations] }),
  };
  return {
    sourcePath: `milestones/${id}.yaml`,
    value,
    original: value,
    amendments: [],
  };
}

function snapshot(...milestones: readonly MilestoneNeighborhoodRecord[]): PublicChronicleSnapshot {
  return { milestones } as unknown as PublicChronicleSnapshot;
}

function ids(records: readonly MilestoneNeighborhoodRecord[]): string[] {
  return records.map((record) => record.value.id);
}

describe("buildMilestoneNeighborhood", () => {
  it("returns undefined when the selected center is missing", () => {
    expect(buildMilestoneNeighborhood(snapshot(milestone("M-1")), "M-MISSING"))
      .toBeUndefined();
  });

  it("builds the direct ancestry around a linear middle milestone", () => {
    const input = snapshot(
      milestone("P"),
      milestone("C", { parents: ["P"] }),
      milestone("K", { parents: ["C"] }),
    );

    const model = buildMilestoneNeighborhood(input, "C");

    expect(model?.center.value.id).toBe("C");
    expect(ids(model?.parents ?? [])).toEqual(["P"]);
    expect(ids(model?.children ?? [])).toEqual(["K"]);
    expect(model?.edges).toEqual([
      { sourceId: "P", targetId: "C" },
      { sourceId: "C", targetId: "K" },
    ]);
  });

  it("builds a first milestone with no parents", () => {
    const model = buildMilestoneNeighborhood(snapshot(
      milestone("FIRST"),
      milestone("NEXT", { parents: ["FIRST"] }),
    ), "FIRST");

    expect(ids(model?.parents ?? [])).toEqual([]);
    expect(ids(model?.children ?? [])).toEqual(["NEXT"]);
    expect(model?.edges).toEqual([{ sourceId: "FIRST", targetId: "NEXT" }]);
  });

  it("builds a last milestone with no children", () => {
    const model = buildMilestoneNeighborhood(snapshot(
      milestone("PREVIOUS"),
      milestone("LAST", { parents: ["PREVIOUS"] }),
    ), "LAST");

    expect(ids(model?.parents ?? [])).toEqual(["PREVIOUS"]);
    expect(ids(model?.children ?? [])).toEqual([]);
    expect(model?.edges).toEqual([{ sourceId: "PREVIOUS", targetId: "LAST" }]);
  });

  it("includes every direct child in a branch", () => {
    const model = buildMilestoneNeighborhood(snapshot(
      milestone("CENTER"),
      milestone("RIGHT", { parents: ["CENTER"], occurredAt: "2025-03-02T00:00:00Z" }),
      milestone("LEFT", { parents: ["CENTER"], occurredAt: "2025-03-01T00:00:00Z" }),
    ), "CENTER");

    expect(ids(model?.children ?? [])).toEqual(["LEFT", "RIGHT"]);
    expect(model?.edges).toEqual([
      { sourceId: "CENTER", targetId: "LEFT" },
      { sourceId: "CENTER", targetId: "RIGHT" },
    ]);
  });

  it("includes every declared parent in a merge", () => {
    const model = buildMilestoneNeighborhood(snapshot(
      milestone("P-LEFT"),
      milestone("P-RIGHT"),
      milestone("MERGE", { parents: ["P-LEFT", "P-RIGHT"] }),
    ), "MERGE");

    expect(ids(model?.parents ?? [])).toEqual(["P-LEFT", "P-RIGHT"]);
    expect(model?.edges).toEqual([
      { sourceId: "P-LEFT", targetId: "MERGE" },
      { sourceId: "P-RIGHT", targetId: "MERGE" },
    ]);
  });

  it("preserves accepted declared parent order from top to bottom", () => {
    const model = buildMilestoneNeighborhood(snapshot(
      milestone("P-A", { occurredAt: "2025-01-01T00:00:00Z" }),
      milestone("P-B", { occurredAt: "2025-03-01T00:00:00Z" }),
      milestone("P-C", { occurredAt: "2025-02-01T00:00:00Z" }),
      milestone("CENTER", { parents: ["P-B", "P-A", "P-C"] }),
    ), "CENTER");

    expect(ids(model?.parents ?? [])).toEqual(["P-B", "P-A", "P-C"]);
  });

  it("orders children top to bottom by occurrence epoch and then stable ID", () => {
    const model = buildMilestoneNeighborhood(snapshot(
      milestone("CENTER"),
      milestone("CHILD-Z", { parents: ["CENTER"], occurredAt: "2025-03-02T00:00:00+02:00" }),
      milestone("CHILD-B", { parents: ["CENTER"], occurredAt: "2025-03-01T10:00:00Z" }),
      milestone("CHILD-A", { parents: ["CENTER"], occurredAt: "2025-03-01T10:00:00Z" }),
      milestone("CHILD-Y", { parents: ["CENTER"], occurredAt: "2025-03-01T09:59:59Z" }),
    ), "CENTER");

    expect(ids(model?.children ?? [])).toEqual([
      "CHILD-Y",
      "CHILD-A",
      "CHILD-B",
      "CHILD-Z",
    ]);
  });

  it("keeps complete deterministic parent and child collections at combined degree", () => {
    const input = snapshot(
      milestone("P-1"),
      milestone("P-2"),
      milestone("P-3"),
      milestone("CENTER", { parents: ["P-3", "P-1", "P-2"] }),
      milestone("K-3", { parents: ["CENTER"], occurredAt: "2025-05-03T00:00:00Z" }),
      milestone("K-1", { parents: ["CENTER"], occurredAt: "2025-05-01T00:00:00Z" }),
      milestone("K-2", { parents: ["CENTER"], occurredAt: "2025-05-02T00:00:00Z" }),
    );

    const model = buildMilestoneNeighborhood(input, "CENTER");

    expect(ids(model?.parents ?? [])).toEqual(["P-3", "P-1", "P-2"]);
    expect(ids(model?.children ?? [])).toEqual(["K-1", "K-2", "K-3"]);
    expect(model?.edges).toHaveLength(6);
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model?.parents)).toBe(true);
    expect(Object.isFrozen(model?.children)).toBe(true);
    expect(Object.isFrozen(model?.edges)).toBe(true);
  });

  it("omits unresolved defensive parent references without inventing edges", () => {
    const model = buildMilestoneNeighborhood(snapshot(
      milestone("PRESENT"),
      milestone("CENTER", { parents: ["MISSING", "PRESENT"] }),
    ), "CENTER");

    expect(ids(model?.parents ?? [])).toEqual(["PRESENT"]);
    expect(model?.edges).toEqual([{ sourceId: "PRESENT", targetId: "CENTER" }]);
  });

  it("never promotes semantic relations into ancestry nodes or edges", () => {
    const model = buildMilestoneNeighborhood(snapshot(
      milestone("ANCESTOR"),
      milestone("CENTER", {
        parents: ["ANCESTOR"],
        relations: [
          { type: "supersedes", target: "SEMANTIC-1", explanation: "superseded" },
          { type: "disproves", target: "SEMANTIC-2", explanation: "disproved" },
          { type: "reverts_to", target: "SEMANTIC-3", explanation: "reverted" },
          { type: "related_to", target: "SEMANTIC-4", explanation: "related" },
        ],
      }),
      milestone("DESCENDANT", { parents: ["CENTER"] }),
      milestone("SEMANTIC-1"),
      milestone("SEMANTIC-2"),
      milestone("SEMANTIC-3"),
      milestone("SEMANTIC-4"),
    ), "CENTER");

    expect(ids(model?.parents ?? [])).toEqual(["ANCESTOR"]);
    expect(ids(model?.children ?? [])).toEqual(["DESCENDANT"]);
    expect(model?.edges).toEqual([
      { sourceId: "ANCESTOR", targetId: "CENTER" },
      { sourceId: "CENTER", targetId: "DESCENDANT" },
    ]);
  });
});
