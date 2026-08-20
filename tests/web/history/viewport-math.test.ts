import { describe, expect, it } from "vitest";

import {
  clampCamera,
  deriveNavigationBounds,
  graphToScreen,
  screenToGraph,
  visibleGraphRect,
  type CameraPose,
  type GraphPoint,
  type GraphRect,
  type ViewportSize,
} from "../../../src/web/history/viewport-math";

const viewport: ViewportSize = { width: 200, height: 100 };
const navigationBounds: GraphRect = { left: 0, top: 0, right: 1_000, bottom: 800 };

describe("History viewport math", () => {
  describe("deriveNavigationBounds", () => {
    it("adds symmetric empty margin on both axes for content smaller than the minimum-scale viewport", () => {
      const content = { left: 10, top: 20, right: 110, bottom: 70 };

      const result = deriveNavigationBounds(content, { width: 800, height: 600 }, 0.5);

      expect(result).toEqual({ left: -740, top: -555, right: 860, bottom: 645 });
      expect((result.left + result.right) / 2).toBe((content.left + content.right) / 2);
      expect((result.top + result.bottom) / 2).toBe((content.top + content.bottom) / 2);
    });

    it.each([
      {
        name: "wide",
        content: { left: 0, top: 10, right: 2_000, bottom: 110 },
        expected: { left: 0, top: -540, right: 2_000, bottom: 660 },
      },
      {
        name: "tall",
        content: { left: 10, top: 0, right: 110, bottom: 2_000 },
        expected: { left: -740, top: 0, right: 860, bottom: 2_000 },
      },
    ])("preserves the $name content axis and expands only the undersized axis", ({ content, expected }) => {
      expect(deriveNavigationBounds(content, { width: 800, height: 600 }, 0.5)).toEqual(expected);
    });

    it("preserves content bounds that already contain the minimum-scale viewport", () => {
      const content = { left: -100, top: -200, right: 1_900, bottom: 1_400 };
      expect(deriveNavigationBounds(content, { width: 800, height: 600 }, 0.5)).toEqual(content);
    });
  });

  describe("coordinate transforms", () => {
    it("maps the camera center and visible rectangle corners exactly", () => {
      const camera = { centerX: 125, centerY: -75, scale: 2 };
      const sizedViewport = { width: 800, height: 600 };

      expect(graphToScreen({ x: 125, y: -75 }, camera, sizedViewport)).toEqual({ x: 400, y: 300 });
      expect(visibleGraphRect(camera, sizedViewport)).toEqual({ left: -75, top: -225, right: 325, bottom: 75 });
      expect(screenToGraph({ x: 0, y: 0 }, camera, sizedViewport)).toEqual({ x: -75, y: -225 });
      expect(screenToGraph({ x: 800, y: 600 }, camera, sizedViewport)).toEqual({ x: 325, y: 75 });
    });

    it.each([
      { point: { x: -9_876.54321, y: 1_234.56789 }, camera: { centerX: 12.25, centerY: -17.75, scale: 0.125 } },
      { point: { x: 0.000_000_1, y: -0.000_000_3 }, camera: { centerX: -4_000, centerY: 8_000, scale: 3.75 } },
      { point: { x: 999_999.25, y: -555_555.75 }, camera: { centerX: 500_000, centerY: -250_000, scale: 4 } },
    ])("round-trips graph and screen coordinates within 1e-9", ({ point, camera }) => {
      const sizedViewport = { width: 1_337, height: 811 };
      const roundTripped = screenToGraph(graphToScreen(point, camera, sizedViewport), camera, sizedViewport);

      expect(Math.abs(roundTripped.x - point.x)).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(roundTripped.y - point.y)).toBeLessThanOrEqual(1e-9);
    });

    it("does not accumulate avoidable drift across repeated inverse operations", () => {
      const camera = { centerX: 2_400.125, centerY: -800.875, scale: 0.37 };
      const sizedViewport = { width: 1_024, height: 777 };
      const original = { x: 4_321.123_456_789, y: -1_234.987_654_321 };
      let current: GraphPoint = original;

      for (let index = 0; index < 10_000; index += 1) {
        current = screenToGraph(graphToScreen(current, camera, sizedViewport), camera, sizedViewport);
      }

      expect(Math.abs(current.x - original.x)).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(current.y - original.y)).toBeLessThanOrEqual(1e-9);
    });
  });

  describe("clampCamera", () => {
    it.each([
      { name: "top-left", requested: { x: -1_000, y: -1_000 }, expected: { x: 50, y: 25 } },
      { name: "top", requested: { x: 500, y: -1_000 }, expected: { x: 500, y: 25 } },
      { name: "top-right", requested: { x: 2_000, y: -1_000 }, expected: { x: 950, y: 25 } },
      { name: "left", requested: { x: -1_000, y: 400 }, expected: { x: 50, y: 400 } },
      { name: "center", requested: { x: 500, y: 400 }, expected: { x: 500, y: 400 } },
      { name: "right", requested: { x: 2_000, y: 400 }, expected: { x: 950, y: 400 } },
      { name: "bottom-left", requested: { x: -1_000, y: 2_000 }, expected: { x: 50, y: 775 } },
      { name: "bottom", requested: { x: 500, y: 2_000 }, expected: { x: 500, y: 775 } },
      { name: "bottom-right", requested: { x: 2_000, y: 2_000 }, expected: { x: 950, y: 775 } },
    ])("clamps the $name request while preserving scale", ({ requested, expected }) => {
      const result = clampCamera(
        { centerX: requested.x, centerY: requested.y, scale: 2 },
        viewport,
        navigationBounds,
      );

      expect(result).toEqual({ centerX: expected.x, centerY: expected.y, scale: 2 });
      const visible = visibleGraphRect(result, viewport);
      expect(visible.left).toBeGreaterThanOrEqual(navigationBounds.left);
      expect(visible.top).toBeGreaterThanOrEqual(navigationBounds.top);
      expect(visible.right).toBeLessThanOrEqual(navigationBounds.right);
      expect(visible.bottom).toBeLessThanOrEqual(navigationBounds.bottom);
    });

    it("centers exactly on an axis whose navigation span equals the visible span", () => {
      const bounds = deriveNavigationBounds(
        { left: 25, top: 10, right: 75, bottom: 610 },
        { width: 800, height: 600 },
        0.5,
      );

      expect(clampCamera(
        { centerX: -10_000, centerY: 300, scale: 0.5 },
        { width: 800, height: 600 },
        bounds,
      )).toEqual({ centerX: 50, centerY: 310, scale: 0.5 });
    });
  });

  describe("invalid input behavior", () => {
    it.each([
      { name: "zero viewport width", run: () => visibleGraphRect({ centerX: 0, centerY: 0, scale: 1 }, { width: 0, height: 100 }) },
      { name: "negative viewport height", run: () => graphToScreen({ x: 0, y: 0 }, { centerX: 0, centerY: 0, scale: 1 }, { width: 100, height: -1 }) },
      { name: "zero scale", run: () => screenToGraph({ x: 0, y: 0 }, { centerX: 0, centerY: 0, scale: 0 }, viewport) },
      { name: "negative minimum scale", run: () => deriveNavigationBounds(navigationBounds, viewport, -0.5) },
      { name: "unordered rectangle", run: () => deriveNavigationBounds({ left: 10, top: 0, right: 5, bottom: 10 }, viewport, 1) },
      { name: "non-finite point", run: () => graphToScreen({ x: Number.NaN, y: 0 }, { centerX: 0, centerY: 0, scale: 1 }, viewport) },
      { name: "non-finite camera", run: () => visibleGraphRect({ centerX: Number.POSITIVE_INFINITY, centerY: 0, scale: 1 }, viewport) },
      { name: "overflowing transform", run: () => graphToScreen({ x: Number.MAX_VALUE, y: 0 }, { centerX: -Number.MAX_VALUE, centerY: 0, scale: 2 }, viewport) },
      { name: "overflowing visible span", run: () => visibleGraphRect({ centerX: 0, centerY: 0, scale: Number.MIN_VALUE }, viewport) },
      { name: "overflowing navigation span", run: () => deriveNavigationBounds(navigationBounds, viewport, Number.MIN_VALUE) },
      {
        name: "bounds smaller than visible viewport",
        run: () => clampCamera(
          { centerX: 50, centerY: 50, scale: 1 },
          { width: 200, height: 200 },
          { left: 0, top: 0, right: 100, bottom: 100 },
        ),
      },
    ])("throws RangeError for $name instead of returning non-finite geometry", ({ run }) => {
      expect(run).toThrow(RangeError);
    });
  });
});
