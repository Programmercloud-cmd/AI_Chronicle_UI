import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadChronicle } from "../../src/data";
import { validateChronicle, type ValidatedChronicle } from "../../src/domain";
import {
  createCurrentRoadmapPresentation,
  PresentationInvariantError,
} from "../../src/presentation";

async function fixture(name: "canonical" | "difficult" = "canonical"): Promise<ValidatedChronicle> {
  const loaded = await loadChronicle(path.resolve(`examples/${name}`));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics, null, 2));
  const validated = await validateChronicle(loaded.value);
  if (!validated.ok) throw new Error(JSON.stringify(validated.diagnostics, null, 2));
  return validated.value;
}

const canonical = (): Promise<ValidatedChronicle> => fixture("canonical");

function withRoadmap(
  chronicle: ValidatedChronicle,
  items: ValidatedChronicle["roadmap"]["value"]["items"],
): ValidatedChronicle {
  return {
    ...chronicle,
    roadmap: {
      ...chronicle.roadmap,
      value: { ...chronicle.roadmap.value, items },
    },
  };
}

describe("Current and Roadmap presentation", () => {
  it("preserves separate current, milestone, audit, and roadmap timestamps", async () => {
    const chronicle = await canonical();
    const result = createCurrentRoadmapPresentation(chronicle);

    expect(result.current).toMatchObject({
      updatedAt: "2026-05-09T10:17:00+02:00",
      milestone: {
        id: "TIM-004",
        occurredAt: "2026-05-05T14:30:52+02:00",
        recordedAt: "2026-05-05T14:42:10+02:00",
      },
    });
    expect(result.roadmap.updatedAt).toBe("2026-05-09T10:17:00+02:00");
    expect(result.current!.milestone.occurredAt).not.toBe(result.current!.updatedAt);
    expect(result.current!.milestone.recordedAt).not.toBe(result.current!.milestone.occurredAt);
  });

  it("uses only the explicit projection and preserves its order and date precision", async () => {
    const chronicle = await canonical();
    const unselected = chronicle.roadmap.value.items.find((item) => item.id === "RM-001")!;
    const selected = ["RM-005", "RM-003"];
    const input: ValidatedChronicle = {
      ...chronicle,
      current: {
        ...chronicle.current!,
        value: { ...chronicle.current!.value, history_projection: selected },
      },
      roadmap: {
        ...chronicle.roadmap,
        value: {
          ...chronicle.roadmap.value,
          items: [
            { ...unselected, follows: { type: "milestone", id: "TIM-004" }, branch_id: "BR-TIMING" },
            ...chronicle.roadmap.value.items.filter((item) => item.id !== "RM-001"),
          ],
        },
      },
    };

    const result = createCurrentRoadmapPresentation(input);
    expect(result.historyProjection.map(({ item }) => item.id)).toEqual(selected);
    expect(result.historyProjection.map(({ plannedFor }) => plannedFor)).toEqual([
      "2026-06-18",
      "2026-05-19",
    ]);
    expect(result.historyProjection.some(({ item }) => item.id === "RM-001")).toBe(false);
    expect(result.historyProjection[0]).not.toHaveProperty("occurredAt");
  });

  it("emits a parent-first outline sorted by sibling order then ordinal ID", async () => {
    const chronicle = await canonical();
    const items = chronicle.roadmap.value.items.map((item) => {
      if (item.id === "RM-001") return { ...item, order: 20 };
      if (item.id === "RM-002") return { ...item, order: 20 };
      if (item.id === "RM-003") return { ...item, parent_id: "RM-002", order: 1 };
      if (item.id === "RM-004") return { ...item, parent_id: "RM-003", order: 1 };
      return { ...item, order: 30 };
    }).reverse();

    const result = createCurrentRoadmapPresentation(withRoadmap(chronicle, items));
    expect(result.roadmap.outline.map(({ item, depth }) => [item.id, depth])).toEqual([
      ["RM-001", 0],
      ["RM-002", 0],
      ["RM-003", 1],
      ["RM-004", 2],
      ["RM-005", 0],
    ]);
  });

  it("resolves declared blockers and links while preserving external blockers", async () => {
    const chronicle = await canonical();
    const input: ValidatedChronicle = {
      ...chronicle,
      current: {
        ...chronicle.current!,
        value: {
          ...chronicle.current!.value,
          blocked: [
            { summary: "External approval is pending." },
            {
              summary: "Regression remains open.",
              blocked_by: [
                { type: "milestone", id: "CORE-003" },
                { type: "roadmap", id: "RM-004" },
              ],
            },
          ],
          related_roadmap_items: ["RM-005", "RM-003"],
        },
      },
    };

    const result = createCurrentRoadmapPresentation(input);
    expect(result.current!.blocked[0]).toEqual({
      summary: "External approval is pending.",
      blockedBy: [],
    });
    expect(result.current!.blocked[1]!.blockedBy.map(({ type, id }) => [type, id])).toEqual([
      ["milestone", "CORE-003"],
      ["roadmap", "RM-004"],
    ]);
    expect(result.current!.relatedRoadmapItems.map(({ id }) => id)).toEqual(["RM-005", "RM-003"]);
  });

  it("derives stable incoming annotations without changing recorded status", async () => {
    const chronicle = await canonical();
    const result = createCurrentRoadmapPresentation(chronicle);
    const regression = result.roadmap.outline
      .flatMap(({ item }) => item.relatedMilestones)
      .find(({ id }) => id === "CORE-003");

    expect(regression).toMatchObject({ status: "informational" });
    expect(regression!.annotations).toEqual([
      {
        kind: "disproved-by",
        sourceMilestoneId: "TIM-001",
        sourceMilestoneTitle: "Root Cause Found",
        sourceOccurredAt: "2026-04-26T13:35:09+02:00",
        explanation: expect.any(String),
      },
    ]);

    const shuffled: ValidatedChronicle = { ...chronicle, milestones: [...chronicle.milestones].reverse() };
    expect(createCurrentRoadmapPresentation(shuffled)).toEqual(result);
  });

  it("renders roadmap without Current and returns no History projection", async () => {
    const chronicle = await canonical();
    const result = createCurrentRoadmapPresentation({ ...chronicle, current: undefined });
    expect(result.current).toBeUndefined();
    expect(result.historyProjection).toEqual([]);
    expect(result.roadmap.outline).toHaveLength(chronicle.roadmap.value.items.length);
  });

  it("keeps superseded and abandoned work visible and resolves supersession", async () => {
    const result = createCurrentRoadmapPresentation(await fixture("difficult"));
    const byId = new Map(result.roadmap.outline.map(({ item }) => [item.id, item]));

    expect(byId.get("RM-002")).toMatchObject({
      status: "superseded",
      supersededBy: { type: "roadmap", id: "RM-003", status: "active" },
    });
    expect(byId.get("RM-007")).toMatchObject({ status: "abandoned" });
  });

  it("does not share mutable arrays with the validated snapshot", async () => {
    const chronicle = await canonical();
    const result = createCurrentRoadmapPresentation(chronicle);
    const originalCriterion = chronicle.roadmap.value.items[0]!.acceptance_criteria![0];

    (result.roadmap.outline[0]!.item.acceptanceCriteria as string[])[0] = "changed output";
    (result.current!.activeWork as string[]).push("changed output");

    expect(chronicle.roadmap.value.items[0]!.acceptance_criteria![0]).toBe(originalCriterion);
    expect(chronicle.current!.value.active_work).toEqual(["Run the performance benchmark."]);
  });

  it("fails fast when the validated boundary is bypassed", async () => {
    const chronicle = await canonical();
    const input: ValidatedChronicle = {
      ...chronicle,
      current: {
        ...chronicle.current!,
        value: { ...chronicle.current!.value, milestone_id: "CORE-999" },
      },
    };
    expect(() => createCurrentRoadmapPresentation(input)).toThrowError(PresentationInvariantError);
    expect(() => createCurrentRoadmapPresentation(input)).toThrow(
      "Invalid validated Chronicle boundary: current references missing milestone CORE-999",
    );
  });
});
