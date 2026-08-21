import { describe, expect, it } from "vitest";

import {
  captureHistoryFullscreenSession,
  historyFullscreenFramingFactor,
  restoreHistoryCameraFromFullscreen,
  transitionHistoryCameraForFullscreen,
  updateHistoryFullscreenSession,
} from "../../../src/web/history/history-fullscreen-camera";
import { canonicalCamera } from "../../../src/web/history/history-content-bounds";
import { canonicalHistoryLayout } from "./fixtures";

const baseline = { width: 900, height: 560 };
const layout = canonicalHistoryLayout();
const baselineCanonical = canonicalCamera(layout, baseline);
const camera = {
  ...baselineCanonical.pose,
  scale: 1.2,
  viewportWidth: baseline.width,
  viewportHeight: baseline.height,
  mode: "manual" as const,
};

describe("History fullscreen normalized camera", () => {
  it.each([
    { name: "wider", target: { width: 1_920, height: 800 }, factor: 800 / 560 },
    { name: "taller", target: { width: 1_200, height: 1_200 }, factor: 1_200 / 900 },
    { name: "4K", target: { width: 3_840, height: 2_160 }, factor: 2_160 / 560 },
    { name: "narrow", target: { width: 320, height: 780 }, factor: 320 / 900 },
  ])("uses the limiting-axis framing factor for $name targets", ({ target, factor }) => {
    expect(historyFullscreenFramingFactor(baseline, target)).toBeCloseTo(factor, 12);
  });

  it("preserves graph center and multiplies normalized zoom and limits exactly once", () => {
    const session = captureHistoryFullscreenSession(camera, 0.6, 4);
    const firstViewport = { width: 1_920, height: 1_080 };
    const firstFactor = historyFullscreenFramingFactor(baseline, firstViewport);
    const first = transitionHistoryCameraForFullscreen(session, layout, firstViewport);
    expect(first.pose.centerX).toBeCloseTo(camera.centerX, 12);
    expect(first.pose.centerY).toBeCloseTo(camera.centerY, 12);
    expect(first.pose.scale).toBeCloseTo(camera.scale * firstFactor, 12);
    expect(first.minScale).toBeCloseTo(0.6 * firstFactor, 12);
    expect(first.maxScale).toBeCloseTo(4 * firstFactor, 12);

    const secondViewport = { width: 2_560, height: 1_440 };
    const second = transitionHistoryCameraForFullscreen(session, layout, secondViewport);
    expect(second.pose.scale).toBeCloseTo(
      camera.scale * historyFullscreenFramingFactor(baseline, secondViewport),
      12,
    );
  });

  it("stores fullscreen wheel zoom in normalized units and restores the equivalent preview pose", () => {
    const session = captureHistoryFullscreenSession(camera, 0.6, 4);
    const fullscreenViewport = { width: 1_920, height: 1_080 };
    const framingFactor = historyFullscreenFramingFactor(baseline, fullscreenViewport);
    const normalizedZoom = 1.35;
    const updated = updateHistoryFullscreenSession(session, {
      centerX: camera.centerX + 40,
      centerY: camera.centerY - 25,
      scale: normalizedZoom * framingFactor,
      viewportWidth: fullscreenViewport.width,
      viewportHeight: fullscreenViewport.height,
      mode: "manual",
    });
    expect(updated.normalizedZoom).toBeCloseTo(normalizedZoom, 12);

    const resized = transitionHistoryCameraForFullscreen(updated, layout, { width: 3_840, height: 2_160 });
    expect(resized.pose.scale).toBeCloseTo(normalizedZoom * (2_160 / 560), 12);
    expect(resized.pose.centerX).toBeCloseTo(camera.centerX + 40, 12);
    expect(resized.pose.centerY).toBeCloseTo(camera.centerY - 25, 12);

    const restored = restoreHistoryCameraFromFullscreen(updated, layout, baseline);
    expect(restored.pose.scale).toBeCloseTo(normalizedZoom, 12);
    expect(restored.pose.centerX).toBeCloseTo(camera.centerX + 40, 12);
    expect(restored.pose.centerY).toBeCloseTo(camera.centerY - 25, 12);
  });

  it("captures independent baseline geometry for each session", () => {
    const first = captureHistoryFullscreenSession(camera, 0.6, 4);
    const resizedCamera = {
      ...camera,
      centerX: camera.centerX + 75,
      scale: 1.1,
      viewportWidth: 1_180,
      viewportHeight: 690,
    };
    const second = captureHistoryFullscreenSession(resizedCamera, 0.7, 4);
    expect(second.baselineViewport).toEqual({ width: 1_180, height: 690 });
    expect(second.baselineViewport).not.toEqual(first.baselineViewport);
    expect(second.centerX).toBe(resizedCamera.centerX);
    expect(second.normalizedZoom).toBe(resizedCamera.scale);
    expect(second.normalizedMinZoom).toBe(0.7);
  });

  it.each([
    [{ width: 0, height: 560 }, baseline],
    [baseline, { width: Number.NaN, height: 800 }],
  ])("rejects invalid baseline or target viewport geometry", (source, target) => {
    expect(() => historyFullscreenFramingFactor(source, target)).toThrow(RangeError);
  });
});
