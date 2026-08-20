import { describe, expect, it } from "vitest";

import type {
  TimelineLaneLayout,
  TimelineLayout,
  TimelineNodeLayout,
} from "../../../src/timeline";
import {
  cameraResetKey,
  canonicalCamera,
  historyContentBounds,
} from "../../../src/web/history/history-content-bounds";
import { HISTORY_MAX_SCALE } from "../../../src/web/history/history-render-metrics";
import {
  deriveNavigationBounds,
  visibleGraphRect,
} from "../../../src/web/history/viewport-math";

function lane(index = 0): TimelineLaneLayout {
  return {
    branchId: `BR-${index}`,
    branchTitle: `Branch ${index}`,
    laneIndex: index,
    y: 180 + index * 220,
    styleOrdinal: index,
  };
}

function node(
  id: string,
  laneLayout: TimelineLaneLayout,
  overrides: Partial<TimelineNodeLayout> = {},
): TimelineNodeLayout {
  return {
    id,
    sourceKind: "milestone",
    x: 200 + laneLayout.laneIndex * 180,
    y: laneLayout.y,
    laneIndex: laneLayout.laneIndex,
    branchId: laneLayout.branchId,
    treatment: "historical",
    status: "accepted",
    fullTitle: `Milestone ${id}`,
    visibleTitle: `Milestone ${id}`,
    titleWasTruncated: false,
    label: { side: "above", tier: 0, angleDegrees: -45 },
    exactTimestampIso: "2026-05-05T14:30:52+02:00",
    target: { kind: "milestone", id },
    accessibility: {
      fullLabel: id,
      description: `${id} description`,
      branchId: laneLayout.branchId,
      branchTitle: laneLayout.branchTitle,
      parentIds: [],
      childIds: [],
      evidenceCount: 1,
      exactTimestampIso: "2026-05-05T14:30:52+02:00",
      positionInSet: 1,
      setSize: 1,
    },
    ...overrides,
  };
}

function historyLayout(
  lanes: readonly TimelineLaneLayout[],
  nodes: readonly TimelineNodeLayout[],
  overrides: Partial<TimelineLayout> = {},
): TimelineLayout {
  return {
    timeScale: { kind: "compressed-calendar", proportional: false },
    width: 1_400,
    height: 900,
    lanes,
    nodes,
    edges: [],
    monthBands: [],
    zones: [],
    navigation: {},
    readingOrder: nodes.map((item) => item.id),
    ...overrides,
  };
}

function oneLaneLayout(nodeOverrides: Partial<TimelineNodeLayout> = {}): TimelineLayout {
  const onlyLane = lane();
  return historyLayout([onlyLane], [node("M-1", onlyLane, nodeOverrides)]);
}

describe("History meaningful content bounds", () => {
  it("isolates the lane position and label from node geometry", () => {
    const isolatedLane = { ...lane(), branchId: "B", branchTitle: "Lane", y: 100 };
    const farNode = node("M-1", isolatedLane, {
      x: 1_000,
      y: -1_000,
      visibleTitle: "",
      exactTimestampIso: undefined,
    });

    const bounds = historyContentBounds(historyLayout([isolatedLane], [farNode]));

    expect(bounds.left).toBe(12); // authored lane-label x; no node can mask it
    expect(bounds.bottom).toBe(100); // semantic lane position extends below its label
  });

  it("expands bounds for lane-label text independently of its anchor position", () => {
    const shortLane = { ...lane(), branchId: "B", branchTitle: "Short", y: 100 };
    const longLane = {
      ...shortLane,
      branchTitle: "A deliberately long branch title whose label extent must be fitted",
    };
    const farNode = node("M-1", shortLane, {
      x: -1_000,
      y: -1_000,
      visibleTitle: "",
      exactTimestampIso: undefined,
    });
    const shortBounds = historyContentBounds(historyLayout([shortLane], [farNode]));
    const longBounds = historyContentBounds(historyLayout([longLane], [farNode]));

    expect(longBounds.right).toBeGreaterThan(shortBounds.right);
    expect(longBounds.bottom).toBe(shortBounds.bottom); // same independent lane-position anchor
  });

  it("isolates a historical timestamp below all other node content", () => {
    const isolatedLane = { ...lane(), y: -1_000 };
    const timestamped = node("M-1", isolatedLane, { x: 200, y: 100 });
    const withoutTimestamp = { ...timestamped, exactTimestampIso: undefined };

    const withBounds = historyContentBounds(historyLayout([isolatedLane], [timestamped]));
    const withoutBounds = historyContentBounds(historyLayout([isolatedLane], [withoutTimestamp]));

    expect(withBounds.bottom).toBeCloseTo(149.8, 12);
    expect(withBounds.bottom).toBeGreaterThan(withoutBounds.bottom);
  });

  it("isolates a planned-date row below all other node content", () => {
    const isolatedLane = { ...lane(), y: -1_000 };
    const planned = node("R-1", isolatedLane, {
      sourceKind: "roadmap",
      treatment: "planned-dated",
      status: "pending",
      x: 200,
      y: 100,
      exactTimestampIso: undefined,
      plannedFor: "2026-06-22",
      target: { kind: "roadmap", id: "R-1" },
    });
    const withoutDate = { ...planned, plannedFor: undefined };

    const withBounds = historyContentBounds(historyLayout([isolatedLane], [planned]));
    const withoutBounds = historyContentBounds(historyLayout([isolatedLane], [withoutDate]));

    expect(withBounds.bottom).toBeCloseTo(149.8, 12);
    expect(withBounds.bottom).toBeGreaterThan(withoutBounds.bottom);
  });

  it("isolates the historical node ring extent", () => {
    const isolatedLane = { ...lane(), y: -1_000 };
    const ringOnlyAtBottom = node("M-1", isolatedLane, {
      x: 200,
      y: 100,
      visibleTitle: "",
      exactTimestampIso: undefined,
    });

    const bounds = historyContentBounds(historyLayout([isolatedLane], [ringOnlyAtBottom]));

    expect(bounds.bottom).toBe(114); // radius 13 + 1px half-stroke
  });

  it("isolates the larger current ring extent from empty callout text", () => {
    const isolatedLane = { ...lane(), y: -1_000 };
    const current = node("CURRENT", isolatedLane, {
      x: 200,
      y: 100,
      treatment: "current",
      exactTimestampIso: undefined,
      // Empty strings deliberately isolate ring geometry in this unit vector.
      calloutLabel: "" as "CURRENT STATE",
      currentState: "",
    });

    const bounds = historyContentBounds(historyLayout([isolatedLane], [current]));

    expect(bounds.right).toBe(218); // radius 17 + 1px half-stroke
  });

  it("isolates edge endpoint and base-stroke contribution", () => {
    const isolatedLane = { ...lane(), y: -1_000 };
    const farNode = node("M-1", isolatedLane, { x: 1_000, y: -500 });
    const layout = historyLayout([isolatedLane], [farNode], {
      edges: [{
        id: "edge",
        fromId: "M-1",
        toId: "M-1",
        kind: "continuation",
        owningBranchId: isolatedLane.branchId,
        points: [{ x: -50, y: 300 }, { x: 50, y: 300 }],
        accessibleLabel: "isolated edge",
      }],
    });

    const bounds = historyContentBounds(layout);

    expect(bounds.left).toBe(-51);
    expect(bounds.bottom).toBe(301);
  });

  it("projects all four corners of long rotated visible labels", () => {
    const shortBounds = historyContentBounds(oneLaneLayout({ visibleTitle: "Short" }));
    const longBounds = historyContentBounds(oneLaneLayout({
      visibleTitle: "A deliberately long visible milestone label for deterministic fitting",
    }));

    expect(longBounds.top).toBeLessThan(shortBounds.top);
    expect(longBounds.right).toBeGreaterThan(shortBounds.right);
    expect(longBounds.bottom).toBe(shortBounds.bottom);
  });

  it("includes lane labels, timestamps, planned dates, node rings, and edge endpoints", () => {
    const firstLane = lane();
    const historical = node("M-1", firstLane, { x: 200 });
    const planned = node("R-1", firstLane, {
      sourceKind: "roadmap",
      treatment: "planned-dated",
      status: "pending",
      x: 640,
      exactTimestampIso: undefined,
      plannedFor: "2026-06-22",
      target: { kind: "roadmap", id: "R-1" },
      label: { side: "below", tier: 1, angleDegrees: -45 },
    });
    const layout = historyLayout([firstLane], [historical, planned], {
      edges: [{
        id: "projection:M-1->R-1",
        fromId: "M-1",
        toId: "R-1",
        kind: "projection",
        owningBranchId: firstLane.branchId,
        points: [{ x: -30, y: 80 }, { x: 720, y: 330 }],
        accessibleLabel: "M-1 to R-1",
      }],
    });

    const bounds = historyContentBounds(layout);

    expect(bounds.left).toBeLessThanOrEqual(-31);
    expect(bounds.top).toBeLessThanOrEqual(79);
    expect(bounds.right).toBeGreaterThanOrEqual(721);
    expect(bounds.bottom).toBeGreaterThanOrEqual(331);
  });

  it("includes CURRENT STATE label/state text and month/zone semantic extents", () => {
    const currentState = "A deliberately wide current state that must remain visible";
    const current = node("CURRENT", lane(), {
      treatment: "current",
      visibleTitle: "Hidden current title",
      currentState,
      calloutLabel: "CURRENT STATE",
    });
    const layout = historyLayout([lane()], [current], {
      monthBands: [{
        monthKey: "2026-05",
        label: "May 2026",
        xStart: 40,
        xEnd: 840,
        y: 500,
        historicalNodeIds: [current.id],
        datedProjectionIds: [],
      }],
      zones: [{ kind: "undated-plan", xStart: 900, xEnd: 1_240, y: 500, label: "UNDATED PLAN" }],
    });

    const bounds = historyContentBounds(layout);

    expect(bounds.left).toBeLessThanOrEqual(12);
    expect(bounds.right).toBeGreaterThanOrEqual(1_240);
    expect(bounds.top).toBeLessThanOrEqual(current.y - 70);
    expect(bounds.bottom).toBeGreaterThan(550);
  });

  it("isolates CURRENT STATE label and state-text vertical extents", () => {
    const current = node("CURRENT", lane(), {
      treatment: "current",
      currentState: "Ready",
      calloutLabel: "CURRENT STATE",
    });

    const bounds = historyContentBounds(historyLayout([lane()], [current]));

    expect(bounds.top).toBe(current.y - 70); // label baseline -62, 8px ascent
    expect(bounds.bottom).toBe(current.y + 80); // state baseline +78, 2px descent
  });

  it("isolates zone divider, semantic end, and label without decorative overreach", () => {
    const isolatedLane = { ...lane(), y: -1_000 };
    const farNode = node("M-1", isolatedLane, { x: 100, y: -500 });
    const layout = historyLayout([isolatedLane], [farNode], {
      zones: [{ kind: "undated-plan", xStart: -200, xEnd: 400, y: 100, label: "UNDATED PLAN" }],
    });

    const bounds = historyContentBounds(layout);

    expect(bounds.left).toBe(-200.5); // divider plus half-stroke
    expect(bounds.right).toBe(400); // named zone span, but no outer padding
    expect(bounds.bottom).toBeCloseTo(151.8, 12); // label baseline +50 and descent
  });

  it("isolates month axis and boundary geometry", () => {
    const isolatedLane = { ...lane(), y: 500 };
    const farNode = node("M-1", isolatedLane, { x: 1_000, y: 500 });
    const layout = historyLayout([isolatedLane], [farNode], {
      monthBands: [{
        monthKey: "2026-05",
        label: "May",
        xStart: -300,
        xEnd: 300,
        y: 100,
        historicalNodeIds: ["M-1"],
        datedProjectionIds: [],
      }],
    });

    const bounds = historyContentBounds(layout);

    expect(bounds.left).toBe(-300.5); // axis start plus half-stroke
    expect(bounds.top).toBe(87.5); // boundary half-height 12 plus half-stroke
  });

  it("isolates the month label from a deliberately narrow band", () => {
    const isolatedLane = { ...lane(), y: 500 };
    const farNode = node("M-1", isolatedLane, { x: 1_000, y: 500 });
    const monthBand = {
      monthKey: "2026-05",
      label: "A deliberately long month label",
      xStart: 0,
      xEnd: 1,
      y: 100,
      historicalNodeIds: ["M-1"],
      datedProjectionIds: [],
    } as const;
    const withoutLabel = { ...monthBand, label: "" };

    const withBounds = historyContentBounds(historyLayout([isolatedLane], [farNode], {
      monthBands: [monthBand],
    }));
    const withoutBounds = historyContentBounds(historyLayout([isolatedLane], [farNode], {
      monthBands: [withoutLabel],
    }));

    expect(withBounds.left).toBeLessThan(withoutBounds.left);
  });

  it.each([1, 4, 12])("covers every lane position for a %i-lane history", (laneCount) => {
    const lanes = Array.from({ length: laneCount }, (_, index) => lane(index));
    const nodes = lanes.map((item, index) => node(`M-${index}`, item, {
      x: 220 + index * 100,
      label: { side: index % 2 === 0 ? "above" : "below", tier: index % 3, angleDegrees: -45 },
    }));

    const bounds = historyContentBounds(historyLayout(lanes, nodes));

    expect(Object.values(bounds).every(Number.isFinite)).toBe(true);
    expect(bounds.top).toBeLessThan(lanes[0]!.y);
    expect(bounds.bottom).toBeGreaterThan(lanes.at(-1)!.y);
  });

  it("excludes unrelated outer layout padding from meaningful bounds", () => {
    const layout = oneLaneLayout();
    const padded = { ...layout, width: 99_999, height: 88_888 };

    expect(historyContentBounds(padded)).toEqual(historyContentBounds(layout));
  });
});

describe("History canonical camera", () => {
  it("fits meaningful height with 24px screen padding and ignores decorative canvas size", () => {
    const layout = oneLaneLayout({ visibleTitle: "Tall fitting target" });
    const result = canonicalCamera({ ...layout, height: 90_000 }, { width: 800, height: 240 });
    const contentHeight = result.contentBounds.bottom - result.contentBounds.top;

    expect(result.minScale).toBe(Math.min(1, (240 - 48) / contentHeight));
    expect(result.maxScale).toBe(HISTORY_MAX_SCALE);
    expect(result.pose.centerY).toBe((result.contentBounds.top + result.contentBounds.bottom) / 2);
    const visible = visibleGraphRect(result.pose, { width: 800, height: 240 });
    expect((result.contentBounds.top - visible.top) * result.pose.scale).toBeGreaterThanOrEqual(24 - 1e-9);
    expect((visible.bottom - result.contentBounds.bottom) * result.pose.scale).toBeGreaterThanOrEqual(24 - 1e-9);
  });

  it("requests explicit current x and clamps it to the nearest valid boundary", () => {
    const firstLane = lane();
    const current = node("CURRENT", firstLane, {
      x: 14,
      treatment: "current",
      currentState: "Ready",
      calloutLabel: "CURRENT STATE",
    });
    const layout = historyLayout([firstLane], [current]);

    const result = canonicalCamera(layout, { width: 800, height: 500 });
    const visible = visibleGraphRect(result.pose, { width: 800, height: 500 });

    expect(result.currentNodeId).toBe("CURRENT");
    expect(result.pose.centerX).toBe(result.navigationBounds.left + 400 / result.pose.scale);
    expect(visible.left).toBeCloseTo(result.navigationBounds.left, 12);
  });

  it("centers currentless history on meaningful content without inferring a current node", () => {
    const onlyLane = lane();
    const layout = historyLayout(
      [onlyLane],
      [node("M-1", onlyLane, { x: 100 }), node("M-2", onlyLane, { x: 900 })],
    );

    const result = canonicalCamera(layout, { width: 500, height: 400 });

    expect(result.currentNodeId).toBeUndefined();
    expect(result.pose.centerX).toBe((result.contentBounds.left + result.contentBounds.right) / 2);
  });

  it.each([
    { width: 777.125, height: 333.375 },
    { width: 801.3, height: 240.2 },
  ])("contains awkward decimal/exact-fit viewports with epsilon-only envelope slack", (viewport) => {
    const decimalLane = { ...lane(), y: 180.125 };
    const layout = historyLayout([decimalLane], [node("M-1", decimalLane, {
      x: 200.375,
      y: 180.125,
      label: { side: "above", tier: 2.25, angleDegrees: -33.333 },
    })]);

    const result = canonicalCamera(layout, viewport);
    const derived = deriveNavigationBounds(result.contentBounds, viewport, result.minScale);
    const visible = visibleGraphRect(result.pose, viewport);
    const magnitude = Math.max(
      1,
      Math.abs(derived.left),
      Math.abs(derived.top),
      Math.abs(derived.right),
      Math.abs(derived.bottom),
      viewport.width / result.minScale,
      viewport.height / result.minScale,
    );
    const maximumAllowedSlack = Number.EPSILON * 64 * magnitude;

    expect(visible.left).toBeGreaterThanOrEqual(result.navigationBounds.left);
    expect(visible.top).toBeGreaterThanOrEqual(result.navigationBounds.top);
    expect(visible.right).toBeLessThanOrEqual(result.navigationBounds.right);
    expect(visible.bottom).toBeLessThanOrEqual(result.navigationBounds.bottom);
    expect(derived.left - result.navigationBounds.left).toBeGreaterThanOrEqual(0);
    expect(derived.top - result.navigationBounds.top).toBeGreaterThanOrEqual(0);
    expect(result.navigationBounds.right - derived.right).toBeGreaterThanOrEqual(0);
    expect(result.navigationBounds.bottom - derived.bottom).toBeGreaterThanOrEqual(0);
    expect(derived.left - result.navigationBounds.left).toBeLessThanOrEqual(maximumAllowedSlack);
    expect(derived.top - result.navigationBounds.top).toBeLessThanOrEqual(maximumAllowedSlack);
    expect(result.navigationBounds.right - derived.right).toBeLessThanOrEqual(maximumAllowedSlack);
    expect(result.navigationBounds.bottom - derived.bottom).toBeLessThanOrEqual(maximumAllowedSlack);
  });
});

describe("History camera reset key", () => {
  it("is stable across equivalent objects and status/text-only changes", () => {
    const firstLane = lane();
    const current = node("M-1", firstLane, {
      treatment: "current",
      currentState: "Original state",
      calloutLabel: "CURRENT STATE",
    });
    const layout = historyLayout([firstLane], [current], {
      monthBands: [{
        monthKey: "2026-05",
        label: "May 2026",
        xStart: 40,
        xEnd: 840,
        y: 500,
        historicalNodeIds: [current.id],
        datedProjectionIds: [],
      }],
      zones: [{ kind: "undated-plan", xStart: 900, xEnd: 1_240, y: 500, label: "UNDATED PLAN" }],
    });
    const textOnly = structuredClone(layout);
    textOnly.lanes[0]!.branchTitle = "Renamed branch";
    textOnly.nodes[0]!.fullTitle = "Renamed full title";
    textOnly.nodes[0]!.visibleTitle = "Renamed visible title";
    textOnly.nodes[0]!.status = "blocked";
    textOnly.nodes[0]!.currentState = "Different state text";
    textOnly.monthBands[0]!.label = "Renamed month";
    textOnly.zones[0]!.label = "Renamed zone" as "UNDATED PLAN";
    textOnly.width = 99_999;
    textOnly.height = 88_888;

    expect(cameraResetKey(structuredClone(layout))).toBe(cameraResetKey(layout));
    expect(cameraResetKey(textOnly)).toBe(cameraResetKey(layout));
    expect(["light", "dark"].map(() => cameraResetKey(layout))).toEqual([
      cameraResetKey(layout),
      cameraResetKey(layout),
    ]);
  });

  it("changes independently for every graph-geometry family and explicit current identity", () => {
    const firstLane = lane();
    const current = node("M-1", firstLane, {
      treatment: "current",
      currentState: "Ready",
      calloutLabel: "CURRENT STATE",
    });
    const other = node("M-2", firstLane, { x: 700 });
    const layout = historyLayout([firstLane], [current, other], {
      edges: [{
        id: "edge",
        fromId: current.id,
        toId: other.id,
        kind: "continuation",
        owningBranchId: firstLane.branchId,
        points: [{ x: current.x, y: current.y }, { x: other.x, y: other.y }],
        accessibleLabel: "M-1 to M-2",
      }],
      monthBands: [{
        monthKey: "2026-05",
        label: "May 2026",
        xStart: 40,
        xEnd: 840,
        y: 500,
        historicalNodeIds: [current.id, other.id],
        datedProjectionIds: [],
      }],
      zones: [{ kind: "undated-plan", xStart: 900, xEnd: 1_240, y: 500, label: "UNDATED PLAN" }],
    });
    const mutations: Array<{ name: string; mutate(value: TimelineLayout): void }> = [
      { name: "lane", mutate: (value) => { value.lanes[0]!.y += 1; } },
      { name: "node", mutate: (value) => { value.nodes[1]!.x += 1; } },
      { name: "edge", mutate: (value) => { value.edges[0]!.points[0].x += 1; } },
      { name: "month", mutate: (value) => { value.monthBands[0]!.xStart += 1; } },
      { name: "zone", mutate: (value) => { value.zones[0]!.xEnd += 1; } },
    ];
    const originalKey = cameraResetKey(layout);

    for (const { name, mutate } of mutations) {
      const changed = structuredClone(layout);
      mutate(changed);
      expect(cameraResetKey(changed), `${name} geometry`).not.toBe(originalKey);
    }

    const changedCurrent = structuredClone(layout);
    changedCurrent.nodes[0]!.treatment = "historical";
    changedCurrent.nodes[1]!.treatment = "current";

    expect(cameraResetKey(changedCurrent), "current identity").not.toBe(originalKey);
  });
});

describe("History bounds invalid input behavior", () => {
  it.each([
    { name: "empty History", run: () => historyContentBounds(historyLayout([], [])) },
    {
      name: "non-finite node coordinate",
      run: () => historyContentBounds(oneLaneLayout({ x: Number.NaN })),
    },
    {
      name: "reversed month band",
      run: () => historyContentBounds({
        ...oneLaneLayout(),
        monthBands: [{
          monthKey: "2026-05",
          label: "May 2026",
          xStart: 900,
          xEnd: 800,
          y: 500,
          historicalNodeIds: ["M-1"],
          datedProjectionIds: [],
        }],
      }),
    },
    {
      name: "multiple current nodes",
      run: () => {
        const onlyLane = lane();
        return historyContentBounds(historyLayout([onlyLane], [
          node("M-1", onlyLane, { treatment: "current" }),
          node("M-2", onlyLane, { treatment: "current" }),
        ]));
      },
    },
    {
      name: "viewport too short for canonical padding",
      run: () => canonicalCamera(oneLaneLayout(), { width: 800, height: 48 }),
    },
    {
      name: "non-finite reset geometry",
      run: () => cameraResetKey(oneLaneLayout({ y: Number.POSITIVE_INFINITY })),
    },
  ])("throws RangeError for $name instead of returning partial/non-finite geometry", ({ run }) => {
    expect(run).toThrow(RangeError);
  });
});
