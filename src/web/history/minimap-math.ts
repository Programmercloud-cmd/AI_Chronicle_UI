import {
  clampCamera,
  visibleGraphRect,
  type CameraPose,
  type GraphPoint,
  type GraphRect,
  type ViewportSize,
} from "./viewport-math";

export const MINIMAP_LOGICAL_WIDTH = 240;
export const MINIMAP_LOGICAL_HEIGHT = 144;
export const MINIMAP_LOGICAL_PADDING = 8;

export interface MinimapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClientRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MinimapProjection {
  graphBounds: GraphRect;
  logicalBounds: MinimapRect;
  innerBounds: MinimapRect;
  plotBounds: MinimapRect;
  letterboxRects: readonly MinimapRect[];
  scale: number;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function assertPositive(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be greater than zero`);
}

function assertPoint(point: GraphPoint, name: string): void {
  assertFinite(point.x, `${name}.x`);
  assertFinite(point.y, `${name}.y`);
}

function assertClientRect(rect: ClientRectLike): void {
  assertFinite(rect.left, "elementRect.left");
  assertFinite(rect.top, "elementRect.top");
  assertPositive(rect.width, "elementRect.width");
  assertPositive(rect.height, "elementRect.height");
}

function rectSize(rect: GraphRect, name: string): ViewportSize {
  assertFinite(rect.left, `${name}.left`);
  assertFinite(rect.top, `${name}.top`);
  assertFinite(rect.right, `${name}.right`);
  assertFinite(rect.bottom, `${name}.bottom`);
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  assertFinite(width, `${name}.width`);
  assertFinite(height, `${name}.height`);
  if (width < 0 || height < 0) throw new RangeError(`${name} must have ordered bounds`);
  return { width, height };
}

function finitePoint(x: number, y: number, name: string): GraphPoint {
  assertFinite(x, `${name}.x`);
  assertFinite(y, `${name}.y`);
  return { x, y };
}

function finiteMinimapRect(
  x: number,
  y: number,
  width: number,
  height: number,
  name: string,
): MinimapRect {
  assertFinite(x, `${name}.x`);
  assertFinite(y, `${name}.y`);
  assertFinite(width, `${name}.width`);
  assertFinite(height, `${name}.height`);
  if (width < 0 || height < 0) throw new RangeError(`${name} must have non-negative dimensions`);
  return { x, y, width, height };
}

function assertMinimapRect(rect: MinimapRect, name: string): void {
  finiteMinimapRect(rect.x, rect.y, rect.width, rect.height, name);
}

function assertProjection(projection: MinimapProjection): void {
  assertPositive(projection.scale, "projection.scale");
  rectSize(projection.graphBounds, "projection.graphBounds");
  assertMinimapRect(projection.logicalBounds, "projection.logicalBounds");
  assertMinimapRect(projection.innerBounds, "projection.innerBounds");
  assertMinimapRect(projection.plotBounds, "projection.plotBounds");
  projection.letterboxRects.forEach((rect, index) => {
    assertMinimapRect(rect, `projection.letterboxRects[${index}]`);
  });
}

function projectionTolerance(projection: MinimapProjection): number {
  return Number.EPSILON * 64 * Math.max(
    1,
    Math.abs(projection.graphBounds.left),
    Math.abs(projection.graphBounds.top),
    Math.abs(projection.graphBounds.right),
    Math.abs(projection.graphBounds.bottom),
  );
}

function letterboxRects(inner: MinimapRect, plot: MinimapRect): MinimapRect[] {
  const rectangles: MinimapRect[] = [];
  const innerRight = inner.x + inner.width;
  const innerBottom = inner.y + inner.height;
  const plotRight = plot.x + plot.width;
  const plotBottom = plot.y + plot.height;

  if (plot.x > inner.x) {
    rectangles.push(finiteMinimapRect(inner.x, inner.y, plot.x - inner.x, inner.height, "letterbox.left"));
  }
  if (plotRight < innerRight) {
    rectangles.push(finiteMinimapRect(plotRight, inner.y, innerRight - plotRight, inner.height, "letterbox.right"));
  }
  if (plot.y > inner.y && plot.width > 0) {
    rectangles.push(finiteMinimapRect(plot.x, inner.y, plot.width, plot.y - inner.y, "letterbox.top"));
  }
  if (plotBottom < innerBottom && plot.width > 0) {
    rectangles.push(finiteMinimapRect(plot.x, plotBottom, plot.width, innerBottom - plotBottom, "letterbox.bottom"));
  }
  return rectangles;
}

/** Fits graph bounds into the fixed 240x144 logical minimap with 8px padding. */
export function createMinimapProjection(graphBounds: GraphRect): MinimapProjection {
  const graph = rectSize(graphBounds, "graphBounds");
  const logicalBounds = finiteMinimapRect(
    0,
    0,
    MINIMAP_LOGICAL_WIDTH,
    MINIMAP_LOGICAL_HEIGHT,
    "logicalBounds",
  );
  const innerBounds = finiteMinimapRect(
    MINIMAP_LOGICAL_PADDING,
    MINIMAP_LOGICAL_PADDING,
    MINIMAP_LOGICAL_WIDTH - MINIMAP_LOGICAL_PADDING * 2,
    MINIMAP_LOGICAL_HEIGHT - MINIMAP_LOGICAL_PADDING * 2,
    "innerBounds",
  );

  const scale = graph.width === 0 && graph.height === 0
    ? 1
    : graph.width === 0
      ? innerBounds.height / graph.height
      : graph.height === 0
        ? innerBounds.width / graph.width
        : Math.min(innerBounds.width / graph.width, innerBounds.height / graph.height);
  assertPositive(scale, "projection.scale");

  const plotWidth = graph.width * scale;
  const plotHeight = graph.height * scale;
  const plotBounds = finiteMinimapRect(
    innerBounds.x + (innerBounds.width - plotWidth) / 2,
    innerBounds.y + (innerBounds.height - plotHeight) / 2,
    plotWidth,
    plotHeight,
    "plotBounds",
  );

  return {
    graphBounds: { ...graphBounds },
    logicalBounds,
    innerBounds,
    plotBounds,
    letterboxRects: letterboxRects(innerBounds, plotBounds),
    scale,
  };
}

/**
 * Converts a browser client point into the minimap's fixed logical viewBox.
 * Space introduced by preserveAspectRatio="xMidYMid meet" is not part of the
 * viewBox and therefore returns undefined.
 */
export function clientPointToMinimap(
  point: GraphPoint,
  elementRect: ClientRectLike,
): GraphPoint | undefined {
  assertPoint(point, "point");
  assertClientRect(elementRect);

  const scale = Math.min(
    elementRect.width / MINIMAP_LOGICAL_WIDTH,
    elementRect.height / MINIMAP_LOGICAL_HEIGHT,
  );
  assertPositive(scale, "client-to-minimap scale");
  const renderedWidth = MINIMAP_LOGICAL_WIDTH * scale;
  const renderedHeight = MINIMAP_LOGICAL_HEIGHT * scale;
  const renderedLeft = elementRect.left + (elementRect.width - renderedWidth) / 2;
  const renderedTop = elementRect.top + (elementRect.height - renderedHeight) / 2;
  const renderedRight = renderedLeft + renderedWidth;
  const renderedBottom = renderedTop + renderedHeight;
  for (const [name, value] of [
    ["renderedLeft", renderedLeft],
    ["renderedTop", renderedTop],
    ["renderedRight", renderedRight],
    ["renderedBottom", renderedBottom],
  ] as const) {
    assertFinite(value, name);
  }

  if (
    point.x < renderedLeft ||
    point.x > renderedRight ||
    point.y < renderedTop ||
    point.y > renderedBottom
  ) {
    return undefined;
  }

  return finitePoint(
    Math.min(MINIMAP_LOGICAL_WIDTH, Math.max(0, (point.x - renderedLeft) / scale)),
    Math.min(MINIMAP_LOGICAL_HEIGHT, Math.max(0, (point.y - renderedTop) / scale)),
    "logicalMinimapPoint",
  );
}

export function graphToMinimap(point: GraphPoint, projection: MinimapProjection): GraphPoint {
  assertPoint(point, "point");
  assertProjection(projection);
  return finitePoint(
    projection.plotBounds.x + (point.x - projection.graphBounds.left) * projection.scale,
    projection.plotBounds.y + (point.y - projection.graphBounds.top) * projection.scale,
    "minimapPoint",
  );
}

/** Returns undefined for logical padding, letterbox space, or outside points. */
export function minimapToGraph(
  point: GraphPoint,
  projection: MinimapProjection,
): GraphPoint | undefined {
  assertPoint(point, "point");
  assertProjection(projection);
  const graph = rectSize(projection.graphBounds, "projection.graphBounds");
  const plot = projection.plotBounds;
  const plotRight = plot.x + plot.width;
  const plotBottom = plot.y + plot.height;
  const withinX = graph.width === 0 ? point.x === plot.x : point.x >= plot.x && point.x <= plotRight;
  const withinY = graph.height === 0 ? point.y === plot.y : point.y >= plot.y && point.y <= plotBottom;
  if (!withinX || !withinY) return undefined;

  return finitePoint(
    graph.width === 0
      ? projection.graphBounds.left
      : projection.graphBounds.left + (point.x - plot.x) / projection.scale,
    graph.height === 0
      ? projection.graphBounds.top
      : projection.graphBounds.top + (point.y - plot.y) / projection.scale,
    "graphPoint",
  );
}

/** Projects a contained graph rectangle without changing its aspect or extent. */
export function graphRectToMinimap(
  graphRect: GraphRect,
  projection: MinimapProjection,
): MinimapRect {
  rectSize(graphRect, "graphRect");
  assertProjection(projection);
  const tolerance = projectionTolerance(projection);
  if (
    graphRect.left < projection.graphBounds.left - tolerance ||
    graphRect.top < projection.graphBounds.top - tolerance ||
    graphRect.right > projection.graphBounds.right + tolerance ||
    graphRect.bottom > projection.graphBounds.bottom + tolerance
  ) {
    throw new RangeError("graphRect must be contained by projection.graphBounds");
  }

  const topLeft = graphToMinimap({
    x: Math.max(projection.graphBounds.left, graphRect.left),
    y: Math.max(projection.graphBounds.top, graphRect.top),
  }, projection);
  const bottomRight = graphToMinimap({
    x: Math.min(projection.graphBounds.right, graphRect.right),
    y: Math.min(projection.graphBounds.bottom, graphRect.bottom),
  }, projection);
  return finiteMinimapRect(
    topLeft.x,
    topLeft.y,
    Math.max(0, bottomRight.x - topLeft.x),
    Math.max(0, bottomRight.y - topLeft.y),
    "minimapRect",
  );
}

export function minimapViewportRect(
  camera: CameraPose,
  viewport: ViewportSize,
  projection: MinimapProjection,
): MinimapRect {
  return graphRectToMinimap(visibleGraphRect(camera, viewport), projection);
}

/**
 * Requests a camera centered on a logical minimap point. Graph padding and
 * letterbox space return undefined; accepted points preserve scale exactly and
 * clamp the full visible viewport to the shared navigation bounds.
 */
export function minimapPointToCamera(
  point: GraphPoint,
  projection: MinimapProjection,
  camera: CameraPose,
  viewport: ViewportSize,
  navigationBounds: GraphRect,
): CameraPose | undefined {
  const graphPoint = minimapToGraph(point, projection);
  if (graphPoint === undefined) return undefined;
  return clampCamera(
    {
      centerX: graphPoint.x,
      centerY: graphPoint.y,
      scale: camera.scale,
    },
    viewport,
    navigationBounds,
  );
}
