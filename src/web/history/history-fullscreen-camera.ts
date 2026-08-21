import type { TimelineLayout } from "../../timeline";
import {
  canonicalCamera,
  historyNavigationBounds,
} from "./history-content-bounds";
import {
  clampCamera,
  type CameraPose,
  type GraphRect,
  type ViewportSize,
} from "./viewport-math";

export interface HistoryFullscreenSession {
  baselineViewport: ViewportSize;
  centerX: number;
  centerY: number;
  normalizedZoom: number;
  normalizedMinZoom: number;
  normalizedMaxZoom: number;
  mode: "canonical" | "manual";
}

export interface HistoryFullscreenTransition {
  pose: CameraPose;
  navigationBounds: GraphRect;
  minScale: number;
  maxScale: number;
  framingFactor: number;
}

function assertViewport(viewport: ViewportSize, name: string): void {
  if (!Number.isFinite(viewport.width) || viewport.width <= 0) {
    throw new RangeError(`${name}.width must be positive and finite`);
  }
  if (!Number.isFinite(viewport.height) || viewport.height <= 0) {
    throw new RangeError(`${name}.height must be positive and finite`);
  }
}

function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be positive and finite`);
  }
}

export function historyFullscreenFramingFactor(
  baselineViewport: ViewportSize,
  targetViewport: ViewportSize,
): number {
  assertViewport(baselineViewport, "baselineViewport");
  assertViewport(targetViewport, "targetViewport");
  return Math.min(
    targetViewport.width / baselineViewport.width,
    targetViewport.height / baselineViewport.height,
  );
}

export function captureHistoryFullscreenSession(
  camera: CameraPose & { viewportWidth: number; viewportHeight: number; mode: "canonical" | "manual" },
  minScale: number,
  maxScale: number,
): HistoryFullscreenSession {
  assertPositive(camera.scale, "camera.scale");
  assertPositive(minScale, "minScale");
  assertPositive(maxScale, "maxScale");
  if (maxScale < minScale) throw new RangeError("maxScale must be at least minScale");
  if (!Number.isFinite(camera.centerX) || !Number.isFinite(camera.centerY)) {
    throw new RangeError("camera center must be finite");
  }
  const baselineViewport = {
    width: camera.viewportWidth,
    height: camera.viewportHeight,
  };
  assertViewport(baselineViewport, "camera viewport");
  return {
    baselineViewport,
    centerX: camera.centerX,
    centerY: camera.centerY,
    normalizedZoom: camera.scale,
    normalizedMinZoom: minScale,
    normalizedMaxZoom: maxScale,
    mode: camera.mode,
  };
}

function transitionBounds(
  layout: TimelineLayout,
  viewport: ViewportSize,
  minScale: number,
): GraphRect {
  const contentBounds = canonicalCamera(layout, viewport).contentBounds;
  return historyNavigationBounds(contentBounds, viewport, minScale);
}

export function transitionHistoryCameraForFullscreen(
  session: HistoryFullscreenSession,
  layout: TimelineLayout,
  targetViewport: ViewportSize,
): HistoryFullscreenTransition {
  const framingFactor = historyFullscreenFramingFactor(session.baselineViewport, targetViewport);
  const minScale = session.normalizedMinZoom * framingFactor;
  const maxScale = session.normalizedMaxZoom * framingFactor;
  const scale = Math.min(
    maxScale,
    Math.max(minScale, session.normalizedZoom * framingFactor),
  );
  const navigationBounds = transitionBounds(layout, targetViewport, minScale);
  const pose = clampCamera(
    { centerX: session.centerX, centerY: session.centerY, scale },
    targetViewport,
    navigationBounds,
  );
  return { pose, navigationBounds, minScale, maxScale, framingFactor };
}

export function updateHistoryFullscreenSession(
  session: HistoryFullscreenSession,
  renderedCamera: CameraPose & { viewportWidth: number; viewportHeight: number; mode: "canonical" | "manual" },
): HistoryFullscreenSession {
  const framingFactor = historyFullscreenFramingFactor(session.baselineViewport, {
    width: renderedCamera.viewportWidth,
    height: renderedCamera.viewportHeight,
  });
  return {
    ...session,
    centerX: renderedCamera.centerX,
    centerY: renderedCamera.centerY,
    normalizedZoom: renderedCamera.scale / framingFactor,
    mode: renderedCamera.mode,
  };
}

export function restoreHistoryCameraFromFullscreen(
  session: HistoryFullscreenSession,
  layout: TimelineLayout,
  targetViewport: ViewportSize,
): HistoryFullscreenTransition {
  const canonical = canonicalCamera(layout, targetViewport);
  const minScale = canonical.minScale;
  const maxScale = canonical.maxScale;
  const scale = Math.min(maxScale, Math.max(minScale, session.normalizedZoom));
  const navigationBounds = canonical.navigationBounds;
  const pose = clampCamera(
    { centerX: session.centerX, centerY: session.centerY, scale },
    targetViewport,
    navigationBounds,
  );
  return { pose, navigationBounds, minScale, maxScale, framingFactor: 1 };
}
