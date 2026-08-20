/**
 * Deterministic SVG metrics shared by History rendering and content-bound
 * calculations. These values mirror the authored SVG coordinates and CSS in
 * history-view.tsx/history.css; browser font measurement is intentionally not
 * part of camera initialization.
 */
export const HISTORY_RENDER_METRICS = Object.freeze({
  edge: Object.freeze({ strokeWidth: 2 }),
  laneLabel: Object.freeze({
    x: 12,
    yOffset: -18,
    fontSize: 10,
    averageGraphemeWidth: 6,
    letterSpacing: 0.6,
  }),
  node: Object.freeze({
    ringRadius: 13,
    currentRingRadius: 17,
    ringStrokeWidth: 2,
    labelBaseDistance: 34,
    labelTierDistance: 28,
    labelFontSize: 12,
    labelAverageGraphemeWidth: 7.5,
    labelLetterSpacing: 0,
    timestampAboveOffset: 48,
    timestampBelowOffset: -34,
    currentTimestampOffset: 54,
    timestampFontSize: 9,
    timestampAverageGraphemeWidth: 5.4,
    timestampLetterSpacing: 0,
    currentLabelOffset: -62,
    currentStateOffset: 78,
    currentFontSize: 10,
    currentAverageGraphemeWidth: 6,
    currentLabelLetterSpacing: 0.8,
    currentStateLetterSpacing: 0,
  }),
  zone: Object.freeze({
    lineHalfHeight: 28,
    labelOffset: 50,
    strokeWidth: 1,
    fontSize: 9,
    averageGraphemeWidth: 5.4,
    letterSpacing: 0.72,
  }),
  month: Object.freeze({
    labelBackgroundWidth: 124,
    labelBackgroundHeight: 28,
    labelBaselineOffset: 5,
    boundaryHalfHeight: 12,
    strokeWidth: 1,
    fontSize: 11,
    averageGraphemeWidth: 6.6,
    letterSpacing: 0.55,
  }),
});

export const HISTORY_CAMERA_VERTICAL_PADDING = 24;
export const HISTORY_MAX_SCALE = 4;

export interface HistoryTextMetrics {
  fontSize: number;
  averageGraphemeWidth: number;
  letterSpacing: number;
}

export function historyGraphemeCount(value: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].length;
}

export function estimateHistoryTextWidth(value: string, metrics: HistoryTextMetrics): number {
  const count = historyGraphemeCount(value);
  if (count === 0) return 0;
  return count * metrics.averageGraphemeWidth + (count - 1) * metrics.letterSpacing;
}

export function historyNodeLabelY(nodeY: number, side: "above" | "below", tier: number): number {
  const distance =
    HISTORY_RENDER_METRICS.node.labelBaseDistance +
    tier * HISTORY_RENDER_METRICS.node.labelTierDistance;
  return side === "above" ? nodeY - distance : nodeY + distance;
}

export function historyNodeTimestampY(
  nodeY: number,
  treatment: "historical" | "current" | "planned-dated" | "planned-undated",
  side: "above" | "below",
): number {
  if (treatment === "current") {
    return nodeY + HISTORY_RENDER_METRICS.node.currentTimestampOffset;
  }
  return side === "above"
    ? nodeY + HISTORY_RENDER_METRICS.node.timestampAboveOffset
    : nodeY + HISTORY_RENDER_METRICS.node.timestampBelowOffset;
}

export function friendlyHistoryTimestamp(timestamp: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/u.exec(timestamp);
  return match === null ? timestamp : `${match[1]} · ${match[2]}`;
}
