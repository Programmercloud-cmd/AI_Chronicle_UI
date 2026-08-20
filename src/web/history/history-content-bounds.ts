import type { TimelineLayout } from "../../timeline";
import {
  HISTORY_CAMERA_VERTICAL_PADDING,
  HISTORY_MAX_SCALE,
  HISTORY_RENDER_METRICS,
  estimateHistoryTextWidth,
  friendlyHistoryTimestamp,
  historyNodeLabelY,
  historyNodeTimestampY,
  type HistoryTextMetrics,
} from "./history-render-metrics";
import {
  clampCamera,
  deriveNavigationBounds,
  type CameraPose,
  type GraphRect,
  type ViewportSize,
} from "./viewport-math";

interface BoundsAccumulator {
  left: number;
  top: number;
  right: number;
  bottom: number;
  populated: boolean;
}

export interface CanonicalHistoryCamera {
  pose: CameraPose;
  minScale: number;
  maxScale: number;
  contentBounds: GraphRect;
  navigationBounds: GraphRect;
  currentNodeId?: string;
}

type TextAnchor = "start" | "middle" | "end";

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function assertPositive(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be greater than zero`);
}

function includePoint(bounds: BoundsAccumulator, x: number, y: number, name: string): void {
  assertFinite(x, `${name}.x`);
  assertFinite(y, `${name}.y`);
  bounds.left = Math.min(bounds.left, x);
  bounds.top = Math.min(bounds.top, y);
  bounds.right = Math.max(bounds.right, x);
  bounds.bottom = Math.max(bounds.bottom, y);
  bounds.populated = true;
}

function includeRect(
  bounds: BoundsAccumulator,
  left: number,
  top: number,
  right: number,
  bottom: number,
  name: string,
): void {
  for (const [suffix, value] of [["left", left], ["top", top], ["right", right], ["bottom", bottom]] as const) {
    assertFinite(value, `${name}.${suffix}`);
  }
  if (right < left || bottom < top) throw new RangeError(`${name} must have ordered bounds`);
  includePoint(bounds, left, top, name);
  includePoint(bounds, right, bottom, name);
}

function includeText(
  bounds: BoundsAccumulator,
  text: string,
  x: number,
  baselineY: number,
  anchor: TextAnchor,
  angleDegrees: number,
  metrics: HistoryTextMetrics,
  name: string,
): void {
  if (typeof text !== "string") throw new TypeError(`${name}.text must be a string`);
  assertFinite(x, `${name}.x`);
  assertFinite(baselineY, `${name}.baselineY`);
  assertFinite(angleDegrees, `${name}.angleDegrees`);
  assertPositive(metrics.fontSize, `${name}.fontSize`);
  assertFinite(metrics.averageGraphemeWidth, `${name}.averageGraphemeWidth`);
  assertFinite(metrics.letterSpacing, `${name}.letterSpacing`);

  const width = estimateHistoryTextWidth(text, metrics);
  const left = anchor === "start" ? x : anchor === "middle" ? x - width / 2 : x - width;
  const right = left + width;
  const top = baselineY - metrics.fontSize * 0.8;
  const bottom = baselineY + metrics.fontSize * 0.2;
  const radians = (angleDegrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);

  for (const [cornerX, cornerY] of [[left, top], [right, top], [right, bottom], [left, bottom]] as const) {
    const deltaX = cornerX - x;
    const deltaY = cornerY - baselineY;
    includePoint(
      bounds,
      x + deltaX * cosine - deltaY * sine,
      baselineY + deltaX * sine + deltaY * cosine,
      name,
    );
  }
}

function initialBounds(): BoundsAccumulator {
  return {
    left: Number.POSITIVE_INFINITY,
    top: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    bottom: Number.NEGATIVE_INFINITY,
    populated: false,
  };
}

function assertLayoutEnvelope(layout: TimelineLayout): void {
  assertPositive(layout.width, "layout.width");
  assertPositive(layout.height, "layout.height");
  if (layout.nodes.length === 0) {
    throw new RangeError("layout must contain at least one History node");
  }
  if (layout.lanes.length === 0) {
    throw new RangeError("layout must contain at least one History lane");
  }
}

/**
 * Returns the axis-aligned bounds of semantic SVG content. Layout width/height
 * are validated but deliberately not included, so unused outer padding cannot
 * reduce the canonical scale.
 */
export function historyContentBounds(layout: TimelineLayout): GraphRect {
  assertLayoutEnvelope(layout);
  const bounds = initialBounds();
  const metrics = HISTORY_RENDER_METRICS;

  for (const [index, lane] of layout.lanes.entries()) {
    assertFinite(lane.y, `layout.lanes[${index}].y`);
    includePoint(bounds, metrics.laneLabel.x, lane.y, `layout.lanes[${index}].position`);
    includeText(
      bounds,
      `${lane.branchId} · ${lane.branchTitle}`,
      metrics.laneLabel.x,
      lane.y + metrics.laneLabel.yOffset,
      "start",
      0,
      metrics.laneLabel,
      `layout.lanes[${index}].label`,
    );
  }

  for (const [index, edge] of layout.edges.entries()) {
    const halfStroke = metrics.edge.strokeWidth / 2;
    for (const [pointIndex, point] of edge.points.entries()) {
      includeRect(
        bounds,
        point.x - halfStroke,
        point.y - halfStroke,
        point.x + halfStroke,
        point.y + halfStroke,
        `layout.edges[${index}].points[${pointIndex}]`,
      );
    }
  }

  let currentNodeId: string | undefined;
  for (const [index, node] of layout.nodes.entries()) {
    assertFinite(node.x, `layout.nodes[${index}].x`);
    assertFinite(node.y, `layout.nodes[${index}].y`);
    assertFinite(node.label.tier, `layout.nodes[${index}].label.tier`);
    assertFinite(node.label.angleDegrees, `layout.nodes[${index}].label.angleDegrees`);
    if (node.label.tier < 0) throw new RangeError(`layout.nodes[${index}].label.tier must not be negative`);

    const current = node.treatment === "current";
    if (current) {
      if (currentNodeId !== undefined) throw new RangeError("layout must not contain multiple current nodes");
      currentNodeId = node.id;
    }
    const ringRadius = current ? metrics.node.currentRingRadius : metrics.node.ringRadius;
    const ringExtent = ringRadius + metrics.node.ringStrokeWidth / 2;
    includeRect(
      bounds,
      node.x - ringExtent,
      node.y - ringExtent,
      node.x + ringExtent,
      node.y + ringExtent,
      `layout.nodes[${index}].ring`,
    );

    if (!current) {
      includeText(
        bounds,
        node.visibleTitle,
        node.x,
        historyNodeLabelY(node.y, node.label.side, node.label.tier),
        node.label.side === "above" ? "start" : "end",
        node.label.angleDegrees,
        {
          fontSize: metrics.node.labelFontSize,
          averageGraphemeWidth: metrics.node.labelAverageGraphemeWidth,
          letterSpacing: metrics.node.labelLetterSpacing,
        },
        `layout.nodes[${index}].label`,
      );
    }

    const timestampY = historyNodeTimestampY(node.y, node.treatment, node.label.side);
    if (node.exactTimestampIso !== undefined) {
      includeText(
        bounds,
        friendlyHistoryTimestamp(node.exactTimestampIso),
        node.x,
        timestampY,
        "middle",
        0,
        {
          fontSize: metrics.node.timestampFontSize,
          averageGraphemeWidth: metrics.node.timestampAverageGraphemeWidth,
          letterSpacing: metrics.node.timestampLetterSpacing,
        },
        `layout.nodes[${index}].timestamp`,
      );
    }
    if (node.sourceKind === "roadmap" && node.plannedFor !== undefined) {
      includeText(
        bounds,
        `PLANNED ${node.plannedFor}`,
        node.x,
        timestampY,
        "middle",
        0,
        {
          fontSize: metrics.node.timestampFontSize,
          averageGraphemeWidth: metrics.node.timestampAverageGraphemeWidth,
          letterSpacing: metrics.node.timestampLetterSpacing,
        },
        `layout.nodes[${index}].plannedDate`,
      );
    }
    if (current) {
      includeText(
        bounds,
        node.calloutLabel ?? "CURRENT STATE",
        node.x,
        node.y + metrics.node.currentLabelOffset,
        "middle",
        0,
        {
          fontSize: metrics.node.currentFontSize,
          averageGraphemeWidth: metrics.node.currentAverageGraphemeWidth,
          letterSpacing: metrics.node.currentLabelLetterSpacing,
        },
        `layout.nodes[${index}].currentLabel`,
      );
      includeText(
        bounds,
        node.currentState ?? "",
        node.x,
        node.y + metrics.node.currentStateOffset,
        "middle",
        0,
        {
          fontSize: metrics.node.currentFontSize,
          averageGraphemeWidth: metrics.node.currentAverageGraphemeWidth,
          letterSpacing: metrics.node.currentStateLetterSpacing,
        },
        `layout.nodes[${index}].currentState`,
      );
    }
  }

  for (const [index, zone] of layout.zones.entries()) {
    assertFinite(zone.xStart, `layout.zones[${index}].xStart`);
    assertFinite(zone.xEnd, `layout.zones[${index}].xEnd`);
    assertFinite(zone.y, `layout.zones[${index}].y`);
    if (zone.xEnd < zone.xStart) throw new RangeError(`layout.zones[${index}] must have ordered bounds`);
    const halfStroke = metrics.zone.strokeWidth / 2;
    includeRect(
      bounds,
      zone.xStart - halfStroke,
      zone.y - metrics.zone.lineHalfHeight - halfStroke,
      zone.xStart + halfStroke,
      zone.y + metrics.zone.lineHalfHeight + halfStroke,
      `layout.zones[${index}].divider`,
    );
    // The named zone semantically spans xStart..xEnd even though only its start
    // divider and centered label are stroked.
    includePoint(bounds, zone.xEnd, zone.y, `layout.zones[${index}].extent`);
    includeText(
      bounds,
      zone.label,
      (zone.xStart + zone.xEnd) / 2,
      zone.y + metrics.zone.labelOffset,
      "middle",
      0,
      metrics.zone,
      `layout.zones[${index}].label`,
    );
  }

  for (const [index, band] of layout.monthBands.entries()) {
    assertFinite(band.xStart, `layout.monthBands[${index}].xStart`);
    assertFinite(band.xEnd, `layout.monthBands[${index}].xEnd`);
    assertFinite(band.y, `layout.monthBands[${index}].y`);
    if (band.xEnd < band.xStart) throw new RangeError(`layout.monthBands[${index}] must have ordered bounds`);
    const halfStroke = metrics.month.strokeWidth / 2;
    const centerX = (band.xStart + band.xEnd) / 2;
    includeRect(
      bounds,
      band.xStart - halfStroke,
      band.y - halfStroke,
      band.xEnd + halfStroke,
      band.y + halfStroke,
      `layout.monthBands[${index}].axis`,
    );
    // The background rectangle only masks the axis behind readable text. Its
    // invisible same-background fill is decorative and must not reduce fit.
    includeRect(
      bounds,
      band.xEnd - halfStroke,
      band.y - metrics.month.boundaryHalfHeight - halfStroke,
      band.xEnd + halfStroke,
      band.y + metrics.month.boundaryHalfHeight + halfStroke,
      `layout.monthBands[${index}].boundary`,
    );
    includeText(
      bounds,
      band.label,
      centerX,
      band.y + metrics.month.labelBaselineOffset,
      "middle",
      0,
      metrics.month,
      `layout.monthBands[${index}].label`,
    );
  }

  if (!bounds.populated) throw new RangeError("layout contains no meaningful History content");
  return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
}

export function canonicalCamera(
  layout: TimelineLayout,
  viewport: ViewportSize,
): CanonicalHistoryCamera {
  assertPositive(viewport.width, "viewport.width");
  assertPositive(viewport.height, "viewport.height");
  const usableHeight = viewport.height - HISTORY_CAMERA_VERTICAL_PADDING * 2;
  if (usableHeight <= 0) {
    throw new RangeError(`viewport.height must exceed ${HISTORY_CAMERA_VERTICAL_PADDING * 2}`);
  }

  const contentBounds = historyContentBounds(layout);
  const contentHeight = contentBounds.bottom - contentBounds.top;
  assertPositive(contentHeight, "meaningful content height");
  const minScale = Math.min(1, usableHeight / contentHeight);
  assertPositive(minScale, "minimum camera scale");
  const derivedNavigationBounds = deriveNavigationBounds(contentBounds, viewport, minScale);
  // deriveNavigationBounds intentionally creates an exactly fitting span on an
  // undersized axis. Add only floating-point slack so G1's strict containment
  // check cannot reject that mathematically valid span after subtraction.
  const containmentSlack =
    Number.EPSILON *
    32 *
    Math.max(
      1,
      Math.abs(derivedNavigationBounds.left),
      Math.abs(derivedNavigationBounds.top),
      Math.abs(derivedNavigationBounds.right),
      Math.abs(derivedNavigationBounds.bottom),
      viewport.width / minScale,
      viewport.height / minScale,
    );
  const navigationBounds = {
    left: derivedNavigationBounds.left - containmentSlack,
    top: derivedNavigationBounds.top - containmentSlack,
    right: derivedNavigationBounds.right + containmentSlack,
    bottom: derivedNavigationBounds.bottom + containmentSlack,
  };
  const currentNodes = layout.nodes.filter((node) => node.treatment === "current");
  if (currentNodes.length > 1) throw new RangeError("layout must not contain multiple current nodes");
  const currentNode = currentNodes[0];
  const pose = clampCamera(
    {
      centerX: currentNode?.x ?? (contentBounds.left + contentBounds.right) / 2,
      centerY: (contentBounds.top + contentBounds.bottom) / 2,
      scale: minScale,
    },
    viewport,
    navigationBounds,
  );

  return {
    pose,
    minScale,
    maxScale: HISTORY_MAX_SCALE,
    contentBounds,
    navigationBounds,
    ...(currentNode === undefined ? {} : { currentNodeId: currentNode.id }),
  };
}

/**
 * Stable primitive identity for camera-reset-worthy graph geometry. Text,
 * status, theme, detail state, layout object identity, and unused outer canvas
 * padding are deliberately omitted.
 */
export function cameraResetKey(layout: TimelineLayout): string {
  assertLayoutEnvelope(layout);
  const currentNodes = layout.nodes.filter((node) => node.treatment === "current");
  if (currentNodes.length > 1) throw new RangeError("layout must not contain multiple current nodes");

  const geometry = {
    currentNodeId: currentNodes[0]?.id ?? null,
    lanes: layout.lanes.map((lane, index) => {
      assertFinite(lane.y, `layout.lanes[${index}].y`);
      return [lane.y];
    }),
    nodes: layout.nodes.map((node, index) => {
      assertFinite(node.x, `layout.nodes[${index}].x`);
      assertFinite(node.y, `layout.nodes[${index}].y`);
      assertFinite(node.label.tier, `layout.nodes[${index}].label.tier`);
      assertFinite(node.label.angleDegrees, `layout.nodes[${index}].label.angleDegrees`);
      return [node.x, node.y, node.label.side, node.label.tier, node.label.angleDegrees];
    }),
    edges: layout.edges.map((edge, edgeIndex) => edge.points.map((point, pointIndex) => {
      assertFinite(point.x, `layout.edges[${edgeIndex}].points[${pointIndex}].x`);
      assertFinite(point.y, `layout.edges[${edgeIndex}].points[${pointIndex}].y`);
      return [point.x, point.y];
    })),
    monthBands: layout.monthBands.map((band, index) => {
      assertFinite(band.xStart, `layout.monthBands[${index}].xStart`);
      assertFinite(band.xEnd, `layout.monthBands[${index}].xEnd`);
      assertFinite(band.y, `layout.monthBands[${index}].y`);
      return [band.xStart, band.xEnd, band.y];
    }),
    zones: layout.zones.map((zone, index) => {
      assertFinite(zone.xStart, `layout.zones[${index}].xStart`);
      assertFinite(zone.xEnd, `layout.zones[${index}].xEnd`);
      assertFinite(zone.y, `layout.zones[${index}].y`);
      return [zone.xStart, zone.xEnd, zone.y];
    }),
  };

  return JSON.stringify(geometry);
}
