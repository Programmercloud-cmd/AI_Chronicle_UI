import { describe, expect, it } from "vitest";

import {
  clientPointToMinimap,
  createMinimapProjection,
  graphRectToMinimap,
  graphToMinimap,
  minimapToGraph,
  minimapPointToCamera,
  minimapViewportRect,
  MINIMAP_LOGICAL_HEIGHT,
  MINIMAP_LOGICAL_PADDING,
  MINIMAP_LOGICAL_WIDTH,
  type MinimapProjection,
} from "../../../src/web/history/minimap-math";
import { visibleGraphRect } from "../../../src/web/history/viewport-math";

describe("History minimap client mapping", () => {
  it("maps every logical corner through a same-aspect CSS rectangle", () => {
    const rect = { left: 10, top: 20, width: 480, height: 288 };

    expect(clientPointToMinimap({ x: 10, y: 20 }, rect)).toEqual({ x: 0, y: 0 });
    expect(clientPointToMinimap({ x: 490, y: 20 }, rect)).toEqual({ x: 240, y: 0 });
    expect(clientPointToMinimap({ x: 10, y: 308 }, rect)).toEqual({ x: 0, y: 144 });
    expect(clientPointToMinimap({ x: 490, y: 308 }, rect)).toEqual({ x: 240, y: 144 });
    expect(clientPointToMinimap({ x: 250, y: 164 }, rect)).toEqual({ x: 120, y: 72 });
  });

  it("rejects horizontal outer letterbox space for a wide CSS rectangle", () => {
    const rect = { left: 100, top: 50, width: 480, height: 144 };

    expect(clientPointToMinimap({ x: 220, y: 50 }, rect)).toEqual({ x: 0, y: 0 });
    expect(clientPointToMinimap({ x: 460, y: 194 }, rect)).toEqual({ x: 240, y: 144 });
    expect(clientPointToMinimap({ x: 219.999, y: 72 }, rect)).toBeUndefined();
    expect(clientPointToMinimap({ x: 460.001, y: 72 }, rect)).toBeUndefined();
  });

  it("rejects vertical outer letterbox space for a tall CSS rectangle", () => {
    const rect = { left: 10, top: 20, width: 240, height: 300 };

    expect(clientPointToMinimap({ x: 10, y: 98 }, rect)).toEqual({ x: 0, y: 0 });
    expect(clientPointToMinimap({ x: 250, y: 242 }, rect)).toEqual({ x: 240, y: 144 });
    expect(clientPointToMinimap({ x: 120, y: 97.999 }, rect)).toBeUndefined();
    expect(clientPointToMinimap({ x: 120, y: 242.001 }, rect)).toBeUndefined();
  });
});

describe("History minimap projection", () => {
  it("fits a wide history with preserved aspect and explicit top/bottom letterboxes", () => {
    const projection = createMinimapProjection({ left: 0, top: 0, right: 1_000, bottom: 100 });

    expect(projection.logicalBounds).toEqual({ x: 0, y: 0, width: 240, height: 144 });
    expect(projection.innerBounds).toEqual({ x: 8, y: 8, width: 224, height: 128 });
    expect(projection.scale).toBe(0.224);
    expect(projection.plotBounds.x).toBe(8);
    expect(projection.plotBounds.y).toBeCloseTo(60.8, 12);
    expect(projection.plotBounds.width).toBe(224);
    expect(projection.plotBounds.height).toBeCloseTo(22.4, 12);
    expect(projection.letterboxRects).toHaveLength(2);
    expect(projection.letterboxRects[0]).toEqual({ x: 8, y: 8, width: 224, height: 52.8 });
    expect(projection.letterboxRects[1]!.x).toBe(8);
    expect(projection.letterboxRects[1]!.y).toBeCloseTo(83.2, 12);
    expect(projection.letterboxRects[1]!.width).toBe(224);
    expect(projection.letterboxRects[1]!.height).toBeCloseTo(52.8, 12);
  });

  it("fits a tall history with preserved aspect and explicit left/right letterboxes", () => {
    const projection = createMinimapProjection({ left: 0, top: 0, right: 100, bottom: 1_000 });

    expect(projection.scale).toBe(0.128);
    expect(projection.plotBounds).toEqual({ x: 113.6, y: 8, width: 12.8, height: 128 });
    expect(projection.letterboxRects).toEqual([
      { x: 8, y: 8, width: 105.6, height: 128 },
      { x: 126.39999999999999, y: 8, width: 105.60000000000001, height: 128 },
    ]);
  });

  it("centers a small offset history without stretching it", () => {
    const projection = createMinimapProjection({ left: -10, top: -20, right: 90, bottom: 30 });

    expect(projection.scale).toBe(2.24);
    expect(projection.plotBounds.x).toBeCloseTo(8, 12);
    expect(projection.plotBounds.y).toBeCloseTo(16, 12);
    expect(projection.plotBounds.width).toBeCloseTo(224, 12);
    expect(projection.plotBounds.height).toBeCloseTo(112, 12);
    expect(graphToMinimap({ x: -10, y: -20 }, projection).x).toBeCloseTo(8, 12);
    expect(graphToMinimap({ x: -10, y: -20 }, projection).y).toBeCloseTo(16, 12);
    expect(graphToMinimap({ x: 90, y: 30 }, projection).x).toBeCloseTo(232, 12);
    expect(graphToMinimap({ x: 90, y: 30 }, projection).y).toBeCloseTo(128, 12);
  });

  it("keeps a single-point history finite and invertible at its exact plotted point", () => {
    const projection = createMinimapProjection({ left: 4.25, top: -8.5, right: 4.25, bottom: -8.5 });
    const minimapPoint = graphToMinimap({ x: 4.25, y: -8.5 }, projection);

    expect(projection.scale).toBe(1);
    expect(projection.plotBounds).toEqual({ x: 120, y: 72, width: 0, height: 0 });
    expect(minimapPoint).toEqual({ x: 120, y: 72 });
    expect(minimapToGraph(minimapPoint, projection)).toEqual({ x: 4.25, y: -8.5 });
    expect(minimapToGraph({ x: 120.001, y: 72 }, projection)).toBeUndefined();
  });

  it.each([
    { graph: { x: -10, y: -20 }, expected: { x: 8, y: 16 } },
    { graph: { x: 90, y: -20 }, expected: { x: 232, y: 16 } },
    { graph: { x: -10, y: 30 }, expected: { x: 8, y: 128 } },
    { graph: { x: 90, y: 30 }, expected: { x: 232, y: 128 } },
    { graph: { x: 23.375, y: 11.125 }, expected: { x: 82.76, y: 85.72 } },
  ])("round-trips graph/minimap vector $graph", ({ graph, expected }) => {
    const projection = createMinimapProjection({ left: -10, top: -20, right: 90, bottom: 30 });
    const projected = graphToMinimap(graph, projection);

    expect(projected.x).toBeCloseTo(expected.x, 12);
    expect(projected.y).toBeCloseTo(expected.y, 12);
    expect(minimapToGraph(projected, projection)?.x).toBeCloseTo(graph.x, 12);
    expect(minimapToGraph(projected, projection)?.y).toBeCloseTo(graph.y, 12);
  });

  it("rejects padding, letterbox, and points outside the logical minimap on inverse mapping", () => {
    const projection = createMinimapProjection({ left: 0, top: 0, right: 1_000, bottom: 100 });

    expect(minimapToGraph({ x: 120, y: 20 }, projection)).toBeUndefined(); // top letterbox
    expect(minimapToGraph({ x: 4, y: 72 }, projection)).toBeUndefined(); // logical padding
    expect(minimapToGraph({ x: -1, y: 72 }, projection)).toBeUndefined(); // outside SVG
    expect(minimapToGraph({ x: 8, y: 60.8 }, projection)).toEqual({ x: 0, y: 0 });
  });

  it("exposes the fixed logical contract", () => {
    expect(MINIMAP_LOGICAL_WIDTH).toBe(240);
    expect(MINIMAP_LOGICAL_HEIGHT).toBe(144);
    expect(MINIMAP_LOGICAL_PADDING).toBe(8);
  });
});

describe("History minimap viewport rectangle", () => {
  const navigationBounds = { left: 0, top: 0, right: 1_000, bottom: 800 };
  const projection = createMinimapProjection(navigationBounds);
  const viewport = { width: 200, height: 100 };

  it.each([
    { name: "top-left", camera: { centerX: 100, centerY: 50, scale: 1 }, expected: { x: 40, y: 8 } },
    { name: "top-right", camera: { centerX: 900, centerY: 50, scale: 1 }, expected: { x: 168, y: 8 } },
    { name: "bottom-left", camera: { centerX: 100, centerY: 750, scale: 1 }, expected: { x: 40, y: 120 } },
    { name: "bottom-right", camera: { centerX: 900, centerY: 750, scale: 1 }, expected: { x: 168, y: 120 } },
  ])("projects an exact contained viewport at the $name navigation corner", ({ camera, expected }) => {
    const rect = minimapViewportRect(camera, viewport, projection);

    expect(rect).toEqual({ x: expected.x, y: expected.y, width: 32, height: 16 });
    expect(rect.x).toBeGreaterThanOrEqual(projection.plotBounds.x);
    expect(rect.y).toBeGreaterThanOrEqual(projection.plotBounds.y);
    expect(rect.x + rect.width).toBeLessThanOrEqual(projection.plotBounds.x + projection.plotBounds.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(projection.plotBounds.y + projection.plotBounds.height);
  });

  it("projects a supplied contained graph rectangle without changing its exact extent", () => {
    expect(graphRectToMinimap(
      { left: 250, top: 200, right: 750, bottom: 600 },
      projection,
    )).toEqual({ x: 80, y: 40, width: 80, height: 64 });
  });

  it("rejects a viewport rectangle materially outside shared navigation bounds", () => {
    expect(() => minimapViewportRect(
      { centerX: 50, centerY: 50, scale: 1 },
      viewport,
      projection,
    )).toThrow(RangeError);
  });
});

describe("History minimap click camera requests", () => {
  const navigationBounds = { left: 0, top: 0, right: 1_000, bottom: 800 };
  const projection = createMinimapProjection(navigationBounds);
  const viewport = { width: 200, height: 100 };

  it.each([
    { name: "center", graph: { x: 500, y: 400 }, expected: { centerX: 500, centerY: 400 } },
    { name: "top-left", graph: { x: 0, y: 0 }, expected: { centerX: 100, centerY: 50 } },
    { name: "top", graph: { x: 500, y: 0 }, expected: { centerX: 500, centerY: 50 } },
    { name: "top-right", graph: { x: 1_000, y: 0 }, expected: { centerX: 900, centerY: 50 } },
    { name: "left", graph: { x: 0, y: 400 }, expected: { centerX: 100, centerY: 400 } },
    { name: "right", graph: { x: 1_000, y: 400 }, expected: { centerX: 900, centerY: 400 } },
    { name: "bottom-left", graph: { x: 0, y: 800 }, expected: { centerX: 100, centerY: 750 } },
    { name: "bottom", graph: { x: 500, y: 800 }, expected: { centerX: 500, centerY: 750 } },
    { name: "bottom-right", graph: { x: 1_000, y: 800 }, expected: { centerX: 900, centerY: 750 } },
  ])("recenters and clamps the full viewport for a $name plot click", ({ graph, expected }) => {
    const result = minimapPointToCamera(
      graphToMinimap(graph, projection),
      projection,
      { centerX: 250, centerY: 250, scale: 1 },
      viewport,
      navigationBounds,
    );

    expect(result).toEqual({ ...expected, scale: 1 });
    const visible = visibleGraphRect(result!, viewport);
    expect(visible.left).toBeGreaterThanOrEqual(navigationBounds.left);
    expect(visible.top).toBeGreaterThanOrEqual(navigationBounds.top);
    expect(visible.right).toBeLessThanOrEqual(navigationBounds.right);
    expect(visible.bottom).toBeLessThanOrEqual(navigationBounds.bottom);
  });

  it.each([0.5, 1.75, 4])("preserves scale %s exactly", (scale) => {
    const result = minimapPointToCamera(
      graphToMinimap({ x: 500, y: 400 }, projection),
      projection,
      { centerX: 100, centerY: 100, scale },
      viewport,
      navigationBounds,
    );

    expect(result?.scale).toBe(scale);
    expect(result?.centerX).toBe(500);
    expect(result?.centerY).toBe(400);
  });

  it("ignores graph letterbox and logical padding", () => {
    const wideProjection = createMinimapProjection({ left: 0, top: 0, right: 1_000, bottom: 100 });
    const camera = { centerX: 500, centerY: 50, scale: 2 };

    expect(minimapPointToCamera(
      { x: 120, y: 20 },
      wideProjection,
      camera,
      { width: 100, height: 50 },
      wideProjection.graphBounds,
    )).toBeUndefined();
    expect(minimapPointToCamera(
      { x: 4, y: 72 },
      wideProjection,
      camera,
      { width: 100, height: 50 },
      wideProjection.graphBounds,
    )).toBeUndefined();
  });
});

describe("History minimap invalid input behavior", () => {
  const validBounds = { left: 0, top: 0, right: 100, bottom: 100 };
  const projection = createMinimapProjection(validBounds);

  it.each([
    { name: "non-finite graph bound", run: () => createMinimapProjection({ ...validBounds, right: Number.NaN }) },
    { name: "reversed graph bounds", run: () => createMinimapProjection({ ...validBounds, left: 101 }) },
    { name: "non-finite graph point", run: () => graphToMinimap({ x: Number.POSITIVE_INFINITY, y: 0 }, projection) },
    { name: "non-finite minimap point", run: () => minimapToGraph({ x: 0, y: Number.NaN }, projection) },
    {
      name: "forged non-finite projection",
      run: () => graphToMinimap({ x: 0, y: 0 }, {
        ...projection,
        plotBounds: { ...projection.plotBounds, x: Number.NaN },
      } as MinimapProjection),
    },
    {
      name: "overflowing projection",
      run: () => graphToMinimap({ x: Number.MAX_VALUE, y: 0 }, createMinimapProjection({ left: 0, top: 0, right: 1, bottom: 1 })),
    },
    {
      name: "zero-width client rectangle",
      run: () => clientPointToMinimap({ x: 0, y: 0 }, { left: 0, top: 0, width: 0, height: 100 }),
    },
    {
      name: "non-finite client rectangle",
      run: () => clientPointToMinimap({ x: 0, y: 0 }, { left: Number.NaN, top: 0, width: 100, height: 100 }),
    },
  ])("throws RangeError for $name instead of emitting NaN/Infinity", ({ run }) => {
    expect(run).toThrow(RangeError);
  });
});
