import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import type {
  TimelineEdgeLayout,
  TimelineLayout,
  TimelineNodeLayout,
} from "../../timeline";
import {
  cameraResetKey,
  canonicalCamera,
} from "./history-content-bounds";
import {
  HISTORY_CAMERA_VERTICAL_PADDING,
  HISTORY_RENDER_METRICS,
  friendlyHistoryTimestamp,
  historyNodeLabelY,
  historyNodeTimestampY,
} from "./history-render-metrics";
import { HistoryMinimap } from "./history-minimap";
import type { HistoryCameraSnapshot } from "./history-camera-session";
import {
  clampCamera,
  screenToGraph,
  visibleGraphRect,
  type CameraPose,
  type GraphPoint,
  type GraphRect,
  type ViewportSize,
} from "./viewport-math";
import "./history.css";

export interface HistoryViewProps {
  layout: TimelineLayout;
  restoredCameraSnapshot?: HistoryCameraSnapshot;
  onCameraCommit?(snapshot: HistoryCameraSnapshot): void;
}

export interface HistoryCamera {
  centerX: number;
  centerY: number;
  scale: number;
  viewportWidth: number;
  viewportHeight: number;
  mode: "canonical" | "manual";
}

function useCommittedLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

function historyCameraFromCanonical(
  layout: TimelineLayout,
  viewport: ViewportSize,
): HistoryCamera {
  const canonical = canonicalCamera(layout, viewport);
  return {
    ...canonical.pose,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    mode: "canonical",
  };
}

/**
 * Applies the production resize policy independently from React. Later
 * navigation gauntlets can set mode to manual without changing this contract.
 */
export function transitionHistoryCameraForResize(
  camera: HistoryCamera,
  layout: TimelineLayout,
  viewport: ViewportSize,
): HistoryCamera {
  if (camera.mode === "canonical") return historyCameraFromCanonical(layout, viewport);

  const constraints = canonicalCamera(layout, viewport);
  const scale = Math.min(constraints.maxScale, Math.max(constraints.minScale, camera.scale));
  const pose = clampCamera(
    { centerX: camera.centerX, centerY: camera.centerY, scale },
    viewport,
    constraints.navigationBounds,
  );
  return {
    ...pose,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    mode: "manual",
  };
}

export interface PosePreservingHistoryCameraTransition {
  camera: HistoryCamera;
  navigationBounds: GraphRect;
  minScale: number;
  maxScale: number;
}

/**
 * Changes only viewport-dependent camera data. Fullscreen must never turn a
 * viewport resize into an implicit fit or clamp the pose the user committed.
 */
export function transitionHistoryCameraPreservingPose(
  camera: HistoryCamera,
  layout: TimelineLayout,
  viewport: ViewportSize,
): PosePreservingHistoryCameraTransition {
  const canonical = canonicalCamera(layout, viewport);
  const nextCamera: HistoryCamera = {
    centerX: camera.centerX,
    centerY: camera.centerY,
    scale: camera.scale,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    mode: "manual",
  };
  const visible = visibleGraphRect(nextCamera, viewport);
  return {
    camera: nextCamera,
    navigationBounds: {
      left: Math.min(canonical.navigationBounds.left, visible.left),
      top: Math.min(canonical.navigationBounds.top, visible.top),
      right: Math.max(canonical.navigationBounds.right, visible.right),
      bottom: Math.max(canonical.navigationBounds.bottom, visible.bottom),
    },
    minScale: Math.min(canonical.minScale, camera.scale),
    maxScale: Math.max(canonical.maxScale, camera.scale),
  };
}

/** Positive screen deltas reveal graph content to the right and below. */
export function panHistoryCameraByScreenDelta(
  camera: HistoryCamera,
  deltaX: number,
  deltaY: number,
  navigationBounds: GraphRect,
): HistoryCamera {
  const viewport = {
    width: camera.viewportWidth,
    height: camera.viewportHeight,
  };
  const pose = clampCamera(
    {
      centerX: camera.centerX + deltaX / camera.scale,
      centerY: camera.centerY + deltaY / camera.scale,
      scale: camera.scale,
    },
    viewport,
    navigationBounds,
  );
  return {
    ...pose,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    mode: "manual",
  };
}

export const HISTORY_WHEEL_LINE_PIXELS = 16;
export const HISTORY_WHEEL_ZOOM_SENSITIVITY = 0.0015;
export const HISTORY_SELECTION_THRESHOLD = 8;
export const HISTORY_SELECTION_PADDING = 24;

export interface HistoryScreenSelection {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function normalizeHistoryWheelDelta(
  deltaY: number,
  deltaMode: number,
  viewportHeight: number,
): number | undefined {
  if (!Number.isFinite(deltaY) || !Number.isFinite(viewportHeight) || viewportHeight <= 0) return undefined;
  const normalized = deltaMode === 0
    ? deltaY
    : deltaMode === 1
      ? deltaY * HISTORY_WHEEL_LINE_PIXELS
      : deltaMode === 2
        ? deltaY * viewportHeight
        : Number.NaN;
  return Number.isFinite(normalized) ? normalized : undefined;
}

export function zoomHistoryCameraAtScreenPoint(
  camera: HistoryCamera,
  screenPoint: GraphPoint,
  normalizedDelta: number,
  minScale: number,
  maxScale: number,
  navigationBounds: GraphRect,
): HistoryCamera {
  if (!Number.isFinite(normalizedDelta)) throw new RangeError("normalizedDelta must be finite");
  if (!Number.isFinite(minScale) || minScale <= 0) throw new RangeError("minScale must be positive and finite");
  if (!Number.isFinite(maxScale) || maxScale < minScale) throw new RangeError("maxScale must be finite and at least minScale");
  if (normalizedDelta === 0) return camera;

  const viewport = { width: camera.viewportWidth, height: camera.viewportHeight };
  const rawScale = camera.scale * Math.exp(-normalizedDelta * HISTORY_WHEEL_ZOOM_SENSITIVITY);
  const scale = Math.min(maxScale, Math.max(minScale, rawScale));
  if (scale === camera.scale) return camera;
  const anchor = screenToGraph(screenPoint, camera, viewport);
  const pose = clampCamera(
    {
      centerX: anchor.x - (screenPoint.x - viewport.width / 2) / scale,
      centerY: anchor.y - (screenPoint.y - viewport.height / 2) / scale,
      scale,
    },
    viewport,
    navigationBounds,
  );
  if (
    pose.centerX === camera.centerX &&
    pose.centerY === camera.centerY &&
    pose.scale === camera.scale
  ) return camera;
  return {
    ...pose,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    mode: "manual",
  };
}

export function normalizeHistoryScreenSelection(
  start: GraphPoint,
  end: GraphPoint,
  viewport: ViewportSize,
): HistoryScreenSelection {
  if (
    !Number.isFinite(start.x) ||
    !Number.isFinite(start.y) ||
    !Number.isFinite(end.x) ||
    !Number.isFinite(end.y) ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    throw new RangeError("selection points and viewport must be finite and positive");
  }
  const startX = Math.min(viewport.width, Math.max(0, start.x));
  const startY = Math.min(viewport.height, Math.max(0, start.y));
  const endX = Math.min(viewport.width, Math.max(0, end.x));
  const endY = Math.min(viewport.height, Math.max(0, end.y));
  return {
    left: Math.min(startX, endX),
    top: Math.min(startY, endY),
    right: Math.max(startX, endX),
    bottom: Math.max(startY, endY),
  };
}

export function fitHistoryCameraToScreenSelection(
  camera: HistoryCamera,
  start: GraphPoint,
  end: GraphPoint,
  minScale: number,
  maxScale: number,
  navigationBounds: GraphRect,
): HistoryCamera | undefined {
  if (!Number.isFinite(minScale) || minScale <= 0) throw new RangeError("minScale must be positive and finite");
  if (!Number.isFinite(maxScale) || maxScale < minScale) {
    throw new RangeError("maxScale must be finite and at least minScale");
  }
  const viewport = { width: camera.viewportWidth, height: camera.viewportHeight };
  const selection = normalizeHistoryScreenSelection(start, end, viewport);
  const width = selection.right - selection.left;
  const height = selection.bottom - selection.top;
  if (width < HISTORY_SELECTION_THRESHOLD || height < HISTORY_SELECTION_THRESHOLD) return undefined;

  const usableWidth = viewport.width - HISTORY_SELECTION_PADDING * 2;
  const usableHeight = viewport.height - HISTORY_SELECTION_PADDING * 2;
  if (usableWidth <= 0 || usableHeight <= 0) return undefined;
  const topLeft = screenToGraph({ x: selection.left, y: selection.top }, camera, viewport);
  const bottomRight = screenToGraph({ x: selection.right, y: selection.bottom }, camera, viewport);
  const graphWidth = bottomRight.x - topLeft.x;
  const graphHeight = bottomRight.y - topLeft.y;
  const fittedScale = Math.min(usableWidth / graphWidth, usableHeight / graphHeight);
  const scale = Math.min(maxScale, Math.max(minScale, fittedScale));
  const pose = clampCamera(
    {
      centerX: (topLeft.x + bottomRight.x) / 2,
      centerY: (topLeft.y + bottomRight.y) / 2,
      scale,
    },
    viewport,
    navigationBounds,
  );
  return {
    ...pose,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    mode: "manual",
  };
}

function validMeasuredViewport(width: number, height: number): boolean {
  return Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > HISTORY_CAMERA_VERTICAL_PADDING * 2;
}

function cameraViewBox(camera: HistoryCamera): string {
  const visible = visibleGraphRect(camera, {
    width: camera.viewportWidth,
    height: camera.viewportHeight,
  });
  return `${visible.left} ${visible.top} ${visible.right - visible.left} ${visible.bottom - visible.top}`;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element &&
    target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])") !== null;
}

function isInteractivePointerTarget(target: EventTarget | null): boolean {
  return target instanceof Element &&
    target.closest("a, button, input, textarea, select, [contenteditable]:not([contenteditable='false']), [data-history-control]") !== null;
}

interface HistoryPanGesture {
  pointerId: number;
  originX: number;
  originY: number;
  startCamera: HistoryCamera;
  navigationBounds: GraphRect;
  surface: HTMLDivElement;
  active: boolean;
  ending: boolean;
}

interface HistorySelectionGesture {
  pointerId: number;
  origin: GraphPoint;
  startCamera: HistoryCamera;
  minScale: number;
  maxScale: number;
  navigationBounds: GraphRect;
  surface: HTMLDivElement;
  surfaceRect: { left: number; top: number; width: number; height: number };
}

const HISTORY_PAN_THRESHOLD = 5;
const HISTORY_KEYBOARD_PAN = 48;
const HISTORY_KEYBOARD_FAST_PAN = 160;
const HISTORY_WHEEL_LISTENER_OPTIONS: AddEventListenerOptions = { passive: false };

function nodeHref(node: TimelineNodeLayout): string {
  return node.target.kind === "milestone"
    ? `/milestones/${encodeURIComponent(node.target.id)}`
    : `/roadmap#${encodeURIComponent(node.target.id)}`;
}

function branchClass(ordinal: number): string {
  return `history-branch-${ordinal % 4}`;
}

function edgePath(edge: TimelineEdgeLayout): string {
  const [from, to] = edge.points;
  return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
}

function DetailSurface({ node }: { node: TimelineNodeLayout }) {
  return (
    <aside className="history-detail-surface" aria-live="polite" aria-atomic="true">
      <strong>{node.fullTitle}</strong>
      <dl>
        <div><dt>ID</dt><dd>{node.id}</dd></div>
        <div>
          <dt>{node.sourceKind === "milestone" ? "Timestamp" : "Planned"}</dt>
          <dd>{node.exactTimestampIso ?? node.plannedFor ?? "Undated"}</dd>
        </div>
        <div><dt>Status</dt><dd>{node.status}</dd></div>
        <div><dt>Branch</dt><dd>{node.accessibility.branchTitle} · {node.branchId}</dd></div>
        {node.sourceKind === "milestone" ? (
          <div><dt>Evidence</dt><dd>{node.accessibility.evidenceCount ?? 0}</dd></div>
        ) : null}
      </dl>
      <p>{node.accessibility.description}</p>
    </aside>
  );
}

function TimelineNode({
  node,
  laneOrdinal,
  onHover,
  onFocus,
}: {
  node: TimelineNodeLayout;
  laneOrdinal: number;
  onHover(node?: TimelineNodeLayout): void;
  onFocus(node?: TimelineNodeLayout): void;
}) {
  const planned = node.sourceKind === "roadmap";
  const metrics = HISTORY_RENDER_METRICS.node;
  const labelY = historyNodeLabelY(node.y, node.label.side, node.label.tier);
  const labelAnchor = node.label.side === "above" ? "start" : "end";
  const timestampY = historyNodeTimestampY(node.y, node.treatment, node.label.side);
  const classNames = [
    "history-node",
    branchClass(laneOrdinal),
    `history-node-${node.treatment}`,
    `history-status-${node.status}`,
  ].join(" ");

  return (
    <g className={classNames} data-node-id={node.id}>
      <Link
        to={nodeHref(node)}
        aria-label={`${node.id}. ${node.accessibility.fullLabel}`}
        onMouseEnter={() => onHover(node)}
        onMouseLeave={() => onHover()}
        onFocus={() => onFocus(node)}
        onBlur={() => onFocus()}
      >
        <title>{node.accessibility.fullLabel}</title>
        <circle
          className="history-node-ring"
          cx={node.x}
          cy={node.y}
          r={node.treatment === "current" ? metrics.currentRingRadius : metrics.ringRadius}
        />
        <circle className="history-node-core" cx={node.x} cy={node.y} r={node.treatment === "current" ? 10 : 8} />
        <text
          className="history-node-label"
          x={node.x}
          y={labelY}
          textAnchor={labelAnchor}
          transform={`rotate(${node.label.angleDegrees} ${node.x} ${labelY})`}
        >
          {node.visibleTitle}
        </text>
        {node.exactTimestampIso === undefined ? null : (
          <text className="history-node-time" x={node.x} y={timestampY} textAnchor="middle">
            {friendlyHistoryTimestamp(node.exactTimestampIso)}
          </text>
        )}
        {planned && node.plannedFor !== undefined ? (
          <text className="history-node-time history-planned-date" x={node.x} y={timestampY} textAnchor="middle">
            PLANNED {node.plannedFor}
          </text>
        ) : null}
        {node.treatment === "current" ? (
          <>
            <text
              className="history-current-label"
              x={node.x}
              y={node.y + metrics.currentLabelOffset}
              textAnchor="middle"
            >
              {node.calloutLabel ?? "CURRENT STATE"}
            </text>
            <text
              className="history-current-state"
              x={node.x}
              y={node.y + metrics.currentStateOffset}
              textAnchor="middle"
            >
              {node.currentState}
            </text>
          </>
        ) : null}
      </Link>
    </g>
  );
}

export function HistoryView({
  layout,
  restoredCameraSnapshot,
  onCameraCommit,
}: HistoryViewProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const layoutRef = useCommittedLatest(layout);
  const onCameraCommitRef = useCommittedLatest(onCameraCommit);
  const [hoveredId, setHoveredId] = useState<string>();
  const [focusedId, setFocusedId] = useState<string>();
  const [measuredViewport, setMeasuredViewport] = useState<ViewportSize>();
  const [camera, setCamera] = useState<HistoryCamera>();
  const cameraRef = useRef<HistoryCamera | undefined>(undefined);
  const [fitAnnouncementVersion, setFitAnnouncementVersion] = useState(0);
  const [fullscreenAnnouncement, setFullscreenAnnouncement] = useState<{
    version: number;
    message: string;
  }>();
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [screenSelection, setScreenSelection] = useState<HistoryScreenSelection>();
  const lastResetKeyRef = useRef<string | undefined>(undefined);
  const navigationBoundsRef = useRef<GraphRect | undefined>(undefined);
  const minScaleRef = useRef<number | undefined>(undefined);
  const maxScaleRef = useRef<number | undefined>(undefined);
  const panGestureRef = useRef<HistoryPanGesture | undefined>(undefined);
  const pendingPanCameraRef = useRef<HistoryCamera | undefined>(undefined);
  const endingPanCameraRef = useRef<HistoryCamera | undefined>(undefined);
  const panAnimationFrameRef = useRef<number | undefined>(undefined);
  const pendingWheelCameraRef = useRef<HistoryCamera | undefined>(undefined);
  const committingWheelCameraRef = useRef<HistoryCamera | undefined>(undefined);
  const wheelAnimationFrameRef = useRef<number | undefined>(undefined);
  const selectionGestureRef = useRef<HistorySelectionGesture | undefined>(undefined);
  const pendingSelectionRef = useRef<HistoryScreenSelection | undefined>(undefined);
  const selectionAnimationFrameRef = useRef<number | undefined>(undefined);
  const isFullscreenRef = useRef(false);
  const fullscreenTransitionPendingRef = useRef(false);
  const preserveNextExitResizeRef = useRef(false);
  const preservePoseResizeRef = useRef(false);
  const exitResizeObservedBeforeEventRef = useRef(false);
  const hasGraph = layout.nodes.length > 0;
  const resetKey = useMemo(
    () => hasGraph ? cameraResetKey(layout) : undefined,
    [hasGraph, layout],
  );
  const resetKeyRef = useCommittedLatest(resetKey);
  const nodeById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes],
  );
  const laneByBranch = useMemo(
    () => new Map(layout.lanes.map((lane) => [lane.branchId, lane])),
    [layout.lanes],
  );
  const activeId = focusedId ?? hoveredId;
  const activeNode = activeId === undefined ? undefined : nodeById.get(activeId);
  const currentNode = layout.nodes.find((node) => node.treatment === "current");

  function publishCamera(nextCamera: HistoryCamera): void {
    cameraRef.current = nextCamera;
    setCamera(nextCamera);
    const committedResetKey = resetKeyRef.current;
    if (committedResetKey !== undefined) {
      onCameraCommitRef.current?.({
        cameraResetKey: committedResetKey,
        centerX: nextCamera.centerX,
        centerY: nextCamera.centerY,
        scale: nextCamera.scale,
        mode: nextCamera.mode,
      });
    }
  }

  function releasePanCapture(gesture: HistoryPanGesture): void {
    const { surface, pointerId } = gesture;
    if (typeof surface.releasePointerCapture !== "function") return;
    if (typeof surface.hasPointerCapture === "function" && !surface.hasPointerCapture(pointerId)) return;
    surface.releasePointerCapture(pointerId);
  }

  function discardPanResources(updateUi: boolean): void {
    if (panAnimationFrameRef.current !== undefined) {
      cancelAnimationFrame(panAnimationFrameRef.current);
      panAnimationFrameRef.current = undefined;
    }
    pendingPanCameraRef.current = undefined;
    endingPanCameraRef.current = undefined;
    const gesture = panGestureRef.current;
    panGestureRef.current = undefined;
    if (gesture !== undefined) releasePanCapture(gesture);
    if (updateUi) setIsPanning(false);
  }

  function restorePanGesture(): void {
    const gesture = panGestureRef.current;
    if (gesture === undefined) return;
    const startCamera = gesture.startCamera;
    discardPanResources(true);
    publishCamera(startCamera);
  }

  function queuePanCamera(nextCamera: HistoryCamera): void {
    pendingPanCameraRef.current = nextCamera;
    if (panAnimationFrameRef.current !== undefined) return;
    panAnimationFrameRef.current = requestAnimationFrame(() => {
      panAnimationFrameRef.current = undefined;
      const pending = pendingPanCameraRef.current;
      pendingPanCameraRef.current = undefined;
      if (pending !== undefined) {
        if (panGestureRef.current?.ending) endingPanCameraRef.current = pending;
        publishCamera(pending);
      }
    });
  }

  function panCameraForPointer(gesture: HistoryPanGesture, clientX: number, clientY: number): HistoryCamera {
    return panHistoryCameraByScreenDelta(
      gesture.startCamera,
      -(clientX - gesture.originX),
      -(clientY - gesture.originY),
      gesture.navigationBounds,
    );
  }

  function discardWheelResources(): void {
    if (wheelAnimationFrameRef.current !== undefined) {
      cancelAnimationFrame(wheelAnimationFrameRef.current);
      wheelAnimationFrameRef.current = undefined;
    }
    pendingWheelCameraRef.current = undefined;
    committingWheelCameraRef.current = undefined;
  }

  function queueWheelCamera(nextCamera: HistoryCamera): void {
    pendingWheelCameraRef.current = nextCamera;
    if (wheelAnimationFrameRef.current !== undefined) return;
    wheelAnimationFrameRef.current = requestAnimationFrame(() => {
      wheelAnimationFrameRef.current = undefined;
      const pending = pendingWheelCameraRef.current;
      pendingWheelCameraRef.current = undefined;
      if (pending === undefined) return;
      committingWheelCameraRef.current = pending;
      publishCamera(pending);
    });
  }

  function releaseSelectionCapture(gesture: HistorySelectionGesture): void {
    const { surface, pointerId } = gesture;
    if (typeof surface.releasePointerCapture !== "function") return;
    if (typeof surface.hasPointerCapture === "function" && !surface.hasPointerCapture(pointerId)) return;
    surface.releasePointerCapture(pointerId);
  }

  function discardSelectionResources(updateUi: boolean): void {
    if (selectionAnimationFrameRef.current !== undefined) {
      cancelAnimationFrame(selectionAnimationFrameRef.current);
      selectionAnimationFrameRef.current = undefined;
    }
    pendingSelectionRef.current = undefined;
    const gesture = selectionGestureRef.current;
    selectionGestureRef.current = undefined;
    if (gesture !== undefined) releaseSelectionCapture(gesture);
    if (updateUi) {
      setIsSelecting(false);
      setScreenSelection(undefined);
    }
  }

  function selectionPointForClient(
    gesture: HistorySelectionGesture,
    clientX: number,
    clientY: number,
  ): GraphPoint {
    return {
      x: Math.min(gesture.surfaceRect.width, Math.max(0, clientX - gesture.surfaceRect.left)),
      y: Math.min(gesture.surfaceRect.height, Math.max(0, clientY - gesture.surfaceRect.top)),
    };
  }

  function queueScreenSelection(selection: HistoryScreenSelection): void {
    pendingSelectionRef.current = selection;
    if (selectionAnimationFrameRef.current !== undefined) return;
    selectionAnimationFrameRef.current = requestAnimationFrame(() => {
      selectionAnimationFrameRef.current = undefined;
      const pending = pendingSelectionRef.current;
      pendingSelectionRef.current = undefined;
      if (pending !== undefined && selectionGestureRef.current !== undefined) {
        setScreenSelection(pending);
      }
    });
  }

  function cameraScreenPoint(
    gesture: HistorySelectionGesture,
    point: GraphPoint,
  ): GraphPoint {
    return {
      x: point.x * gesture.startCamera.viewportWidth / gesture.surfaceRect.width,
      y: point.y * gesture.startCamera.viewportHeight / gesture.surfaceRect.height,
    };
  }

  function handleNativeWheel(event: WheelEvent): void {
    if (selectionGestureRef.current !== undefined) {
      event.preventDefault();
      return;
    }
    if (panGestureRef.current !== undefined) return;
    const bounds = navigationBoundsRef.current;
    const minScale = minScaleRef.current;
    const maxScale = maxScaleRef.current;
    const baseCamera = pendingWheelCameraRef.current ?? committingWheelCameraRef.current ?? cameraRef.current;
    if (baseCamera === undefined || bounds === undefined || minScale === undefined || maxScale === undefined) return;
    const normalizedDelta = normalizeHistoryWheelDelta(
      event.deltaY,
      event.deltaMode,
      baseCamera.viewportHeight,
    );
    if (normalizedDelta === undefined || normalizedDelta === 0) return;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const screenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (!Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) return;

    // This surface-scoped listener intentionally owns finite wheel input for
    // custom zoom, so it must be non-passive in order to suppress page scroll.
    event.preventDefault();
    const nextCamera = zoomHistoryCameraAtScreenPoint(
      baseCamera,
      screenPoint,
      normalizedDelta,
      minScale,
      maxScale,
      bounds,
    );
    if (nextCamera !== baseCamera) queueWheelCamera(nextCamera);
  }

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) {
      setMeasuredViewport(undefined);
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((item) => item.target === element) ?? entries[0];
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      if (!validMeasuredViewport(width, height)) return;
      const fullscreenNow = document.fullscreenElement === element;
      if (!fullscreenNow && isFullscreenRef.current) {
        exitResizeObservedBeforeEventRef.current = true;
      }
      if (
        fullscreenNow ||
        isFullscreenRef.current ||
        fullscreenTransitionPendingRef.current ||
        preserveNextExitResizeRef.current
      ) {
        preservePoseResizeRef.current = true;
        if (!fullscreenNow && !isFullscreenRef.current) {
          preserveNextExitResizeRef.current = false;
        }
      }
      setMeasuredViewport((previous) =>
        previous?.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasGraph]);

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) return;
    const available = document.fullscreenEnabled !== false &&
      typeof element.requestFullscreen === "function" &&
      typeof document.exitFullscreen === "function";
    setFullscreenAvailable(available);

    function handleFullscreenChange(): void {
      const fullscreenNow = document.fullscreenElement === element;
      if (fullscreenNow === isFullscreenRef.current) {
        fullscreenTransitionPendingRef.current = false;
        return;
      }
      if (!fullscreenNow && !exitResizeObservedBeforeEventRef.current) {
        preserveNextExitResizeRef.current = true;
      }
      exitResizeObservedBeforeEventRef.current = false;
      fullscreenTransitionPendingRef.current = false;
      isFullscreenRef.current = fullscreenNow;
      setIsFullscreen(fullscreenNow);
      discardWheelResources();
      discardPanResources(true);
      discardSelectionResources(true);
      setFullscreenAnnouncement((previous) => ({
        version: (previous?.version ?? 0) + 1,
        message: fullscreenNow ? "History fullscreen entered" : "History fullscreen exited",
      }));
    }

    handleFullscreenChange();
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [hasGraph]);

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) return;
    element.addEventListener("wheel", handleNativeWheel, HISTORY_WHEEL_LISTENER_OPTIONS);
    return () => {
      element.removeEventListener("wheel", handleNativeWheel, false);
      discardWheelResources();
    };
  }, [hasGraph]);

  useEffect(() => {
    discardWheelResources();
    discardPanResources(true);
    discardSelectionResources(true);
    if (resetKey === undefined) {
      lastResetKeyRef.current = undefined;
      navigationBoundsRef.current = undefined;
      minScaleRef.current = undefined;
      maxScaleRef.current = undefined;
      cameraRef.current = undefined;
      setCamera(undefined);
      return;
    }
    if (measuredViewport === undefined) return;

    const keyChanged = lastResetKeyRef.current !== resetKey;
    lastResetKeyRef.current = resetKey;
    const currentLayout = layoutRef.current;
    const constraints = canonicalCamera(currentLayout, measuredViewport);
    const preservePose = preservePoseResizeRef.current;
    preservePoseResizeRef.current = false;
    const previous = cameraRef.current;
    const restored = previous === undefined &&
      restoredCameraSnapshot?.cameraResetKey === resetKey &&
      Number.isFinite(restoredCameraSnapshot.centerX) &&
      Number.isFinite(restoredCameraSnapshot.centerY) &&
      Number.isFinite(restoredCameraSnapshot.scale) &&
      restoredCameraSnapshot.scale > 0
      ? restoredCameraSnapshot
      : undefined;
    const restoredCamera: HistoryCamera | undefined = restored === undefined
      ? undefined
      : {
          centerX: restored.centerX,
          centerY: restored.centerY,
          scale: restored.scale,
          viewportWidth: measuredViewport.width,
          viewportHeight: measuredViewport.height,
          mode: restored.mode,
        };
    const poseTransition = restoredCamera !== undefined
      ? transitionHistoryCameraPreservingPose(restoredCamera, currentLayout, measuredViewport)
      : preservePose && previous !== undefined && !keyChanged
        ? transitionHistoryCameraPreservingPose(previous, currentLayout, measuredViewport)
        : undefined;
    navigationBoundsRef.current = poseTransition?.navigationBounds ?? constraints.navigationBounds;
    minScaleRef.current = poseTransition?.minScale ?? constraints.minScale;
    maxScaleRef.current = poseTransition?.maxScale ?? constraints.maxScale;
    const next: HistoryCamera = restoredCamera !== undefined && poseTransition !== undefined
      ? { ...poseTransition.camera, mode: restoredCamera.mode }
      : previous === undefined || keyChanged
        ? {
            ...constraints.pose,
            viewportWidth: measuredViewport.width,
            viewportHeight: measuredViewport.height,
            mode: "canonical",
          }
        : poseTransition?.camera ?? transitionHistoryCameraForResize(previous, currentLayout, measuredViewport);
    publishCamera(next);
  }, [resetKey, measuredViewport?.height, measuredViewport?.width]);

  useEffect(() => () => discardPanResources(false), []);
  useEffect(() => () => discardSelectionResources(false), []);

  useEffect(() => {
    if (endingPanCameraRef.current === undefined || camera !== endingPanCameraRef.current) return;
    endingPanCameraRef.current = undefined;
    const gesture = panGestureRef.current;
    if (gesture?.ending) {
      panGestureRef.current = undefined;
      releasePanCapture(gesture);
      setIsPanning(false);
    }
  }, [camera]);

  useEffect(() => {
    if (committingWheelCameraRef.current === camera) committingWheelCameraRef.current = undefined;
  }, [camera]);

  function fitCurrent(focusSurface: boolean) {
    const element = viewportRef.current;
    if (currentNode === undefined || measuredViewport === undefined || element === null) return;
    const canonical = canonicalCamera(layoutRef.current, measuredViewport);
    navigationBoundsRef.current = canonical.navigationBounds;
    minScaleRef.current = canonical.minScale;
    maxScaleRef.current = canonical.maxScale;
    discardWheelResources();
    discardPanResources(true);
    discardSelectionResources(true);
    const nextCamera: HistoryCamera = {
      ...canonical.pose,
      viewportWidth: measuredViewport.width,
      viewportHeight: measuredViewport.height,
      mode: "canonical",
    };
    publishCamera(nextCamera);
    if (focusSurface) element.focus({ preventScroll: true });
    setFullscreenAnnouncement(undefined);
    setFitAnnouncementVersion((version) => version + 1);
  }

  async function toggleFullscreen(): Promise<void> {
    const element = viewportRef.current;
    if (!fullscreenAvailable || element === null) return;
    const exiting = document.fullscreenElement === element;
    fullscreenTransitionPendingRef.current = true;
    discardWheelResources();
    discardPanResources(true);
    discardSelectionResources(true);
    try {
      if (exiting) await document.exitFullscreen();
      else await element.requestFullscreen();
      const transitionOccurred = exiting
        ? document.fullscreenElement !== element
        : document.fullscreenElement === element;
      if (!transitionOccurred) fullscreenTransitionPendingRef.current = false;
    } catch {
      fullscreenTransitionPendingRef.current = false;
      setFullscreenAnnouncement((previous) => ({
        version: (previous?.version ?? 0) + 1,
        message: exiting ? "Unable to exit fullscreen" : "Unable to enter fullscreen",
      }));
    }
  }

  function handleMinimapCameraRequest(requested: CameraPose): void {
    const current = cameraRef.current;
    if (current === undefined) return;
    discardWheelResources();
    discardPanResources(true);
    discardSelectionResources(true);
    const nextCamera: HistoryCamera = {
      centerX: requested.centerX,
      centerY: requested.centerY,
      scale: requested.scale,
      viewportWidth: current.viewportWidth,
      viewportHeight: current.viewportHeight,
      mode: "manual",
    };
    publishCamera(nextCamera);
  }

  function handleSelectionPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    const startCamera = cameraRef.current;
    const minScale = minScaleRef.current;
    const maxScale = maxScaleRef.current;
    const navigationBounds = navigationBoundsRef.current;
    if (
      !event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.shiftKey ||
      event.button !== 0 ||
      event.isPrimary === false ||
      isInteractivePointerTarget(event.target) ||
      startCamera === undefined ||
      minScale === undefined ||
      maxScale === undefined ||
      navigationBounds === undefined ||
      panGestureRef.current !== undefined ||
      selectionGestureRef.current !== undefined ||
      pendingWheelCameraRef.current !== undefined ||
      committingWheelCameraRef.current !== undefined ||
      wheelAnimationFrameRef.current !== undefined
    ) return;

    const surface = event.currentTarget;
    const rect = surface.getBoundingClientRect();
    const surfaceWidth = surface.clientWidth > 0 ? surface.clientWidth : rect.width;
    const surfaceHeight = surface.clientHeight > 0 ? surface.clientHeight : rect.height;
    const surfaceLeft = rect.left + surface.clientLeft;
    const surfaceTop = rect.top + surface.clientTop;
    if (
      !Number.isFinite(surfaceLeft) ||
      !Number.isFinite(surfaceTop) ||
      !Number.isFinite(surfaceWidth) ||
      !Number.isFinite(surfaceHeight) ||
      surfaceWidth <= 0 ||
      surfaceHeight <= 0
    ) return;
    const gesture: HistorySelectionGesture = {
      pointerId: event.pointerId,
      origin: {
        x: Math.min(surfaceWidth, Math.max(0, event.clientX - surfaceLeft)),
        y: Math.min(surfaceHeight, Math.max(0, event.clientY - surfaceTop)),
      },
      startCamera: { ...startCamera },
      minScale,
      maxScale,
      navigationBounds: { ...navigationBounds },
      surface,
      surfaceRect: { left: surfaceLeft, top: surfaceTop, width: surfaceWidth, height: surfaceHeight },
    };
    event.preventDefault();
    surface.focus({ preventScroll: true });
    surface.setPointerCapture(event.pointerId);
    selectionGestureRef.current = gesture;
    setIsSelecting(true);
    setScreenSelection(undefined);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.ctrlKey) {
      handleSelectionPointerDown(event);
      return;
    }
    const startCamera = cameraRef.current;
    if (
      startCamera === undefined ||
      navigationBoundsRef.current === undefined ||
      panGestureRef.current !== undefined ||
      selectionGestureRef.current !== undefined ||
      pendingWheelCameraRef.current !== undefined ||
      committingWheelCameraRef.current !== undefined ||
      wheelAnimationFrameRef.current !== undefined ||
      event.button !== 0 ||
      event.isPrimary === false ||
      isInteractivePointerTarget(event.target)
    ) return;

    const surface = event.currentTarget;
    surface.focus({ preventScroll: true });
    surface.setPointerCapture(event.pointerId);
    panGestureRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      startCamera,
      navigationBounds: navigationBoundsRef.current,
      surface,
      active: false,
      ending: false,
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const selectionGesture = selectionGestureRef.current;
    if (selectionGesture !== undefined) {
      if (selectionGesture.pointerId !== event.pointerId) return;
      event.preventDefault();
      const endpoint = selectionPointForClient(selectionGesture, event.clientX, event.clientY);
      queueScreenSelection(normalizeHistoryScreenSelection(
        selectionGesture.origin,
        endpoint,
        { width: selectionGesture.surfaceRect.width, height: selectionGesture.surfaceRect.height },
      ));
      return;
    }
    const gesture = panGestureRef.current;
    if (gesture === undefined || gesture.pointerId !== event.pointerId) return;
    if (gesture.ending) return;
    const deltaX = event.clientX - gesture.originX;
    const deltaY = event.clientY - gesture.originY;
    if (!gesture.active && Math.hypot(deltaX, deltaY) < HISTORY_PAN_THRESHOLD) return;
    if (!gesture.active) {
      gesture.active = true;
      setIsPanning(true);
    }
    event.preventDefault();
    queuePanCamera(panCameraForPointer(gesture, event.clientX, event.clientY));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    const selectionGesture = selectionGestureRef.current;
    if (selectionGesture !== undefined) {
      if (selectionGesture.pointerId !== event.pointerId) return;
      event.preventDefault();
      const endpoint = selectionPointForClient(selectionGesture, event.clientX, event.clientY);
      const screenRect = normalizeHistoryScreenSelection(
        selectionGesture.origin,
        endpoint,
        { width: selectionGesture.surfaceRect.width, height: selectionGesture.surfaceRect.height },
      );
      discardSelectionResources(true);
      if (
        screenRect.right - screenRect.left < HISTORY_SELECTION_THRESHOLD ||
        screenRect.bottom - screenRect.top < HISTORY_SELECTION_THRESHOLD
      ) return;
      const nextCamera = fitHistoryCameraToScreenSelection(
        selectionGesture.startCamera,
        cameraScreenPoint(selectionGesture, { x: screenRect.left, y: screenRect.top }),
        cameraScreenPoint(selectionGesture, { x: screenRect.right, y: screenRect.bottom }),
        selectionGesture.minScale,
        selectionGesture.maxScale,
        selectionGesture.navigationBounds,
      );
      if (nextCamera !== undefined) {
        publishCamera(nextCamera);
      }
      return;
    }
    const gesture = panGestureRef.current;
    if (gesture === undefined || gesture.pointerId !== event.pointerId) return;
    if (gesture.active) {
      event.preventDefault();
      gesture.ending = true;
      queuePanCamera(panCameraForPointer(gesture, event.clientX, event.clientY));
      return;
    }
    panGestureRef.current = undefined;
    releasePanCapture(gesture);
    setIsPanning(false);
  }

  function handlePointerCancel(event: React.PointerEvent<HTMLDivElement>): void {
    if (selectionGestureRef.current?.pointerId === event.pointerId) {
      discardSelectionResources(true);
      return;
    }
    if (panGestureRef.current?.pointerId === event.pointerId) restorePanGesture();
  }

  function handleLostPointerCapture(event: React.PointerEvent<HTMLDivElement>): void {
    if (selectionGestureRef.current?.pointerId === event.pointerId) {
      discardSelectionResources(true);
      return;
    }
    const gesture = panGestureRef.current;
    if (gesture?.pointerId === event.pointerId && !gesture.ending) restorePanGesture();
  }

  function handleHistoryKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (
      (event.key === "f" || event.key === "F") &&
      event.shiftKey &&
      !isEditableTarget(event.target) &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      fullscreenAvailable
    ) {
      event.preventDefault();
      void toggleFullscreen();
      return;
    }
    if (
      (event.key === "f" || event.key === "F") &&
      !event.shiftKey &&
      !isEditableTarget(event.target) &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      currentNode !== undefined &&
      measuredViewport !== undefined
    ) {
      event.preventDefault();
      fitCurrent(false);
      return;
    }
    if (event.key === "Escape" && selectionGestureRef.current !== undefined) {
      event.preventDefault();
      discardSelectionResources(true);
      return;
    }
    if (event.key === "Escape" && panGestureRef.current !== undefined) {
      event.preventDefault();
      restorePanGesture();
      return;
    }
    if (
      selectionGestureRef.current !== undefined ||
      panGestureRef.current !== undefined ||
      pendingWheelCameraRef.current !== undefined ||
      committingWheelCameraRef.current !== undefined ||
      wheelAnimationFrameRef.current !== undefined
    ) {
      if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
      }
      return;
    }
    if (
      camera === undefined ||
      navigationBoundsRef.current === undefined ||
      isEditableTarget(event.target) ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey
    ) return;

    const distance = event.shiftKey ? HISTORY_KEYBOARD_FAST_PAN : HISTORY_KEYBOARD_PAN;
    let deltaX = 0;
    let deltaY = 0;
    if (event.key === "ArrowRight") deltaX = distance;
    else if (event.key === "ArrowLeft") deltaX = -distance;
    else if (event.key === "ArrowDown") deltaY = distance;
    else if (event.key === "ArrowUp") deltaY = -distance;
    else return;

    event.preventDefault();
    const bounds = navigationBoundsRef.current;
    const baseCamera = cameraRef.current;
    if (baseCamera === undefined) return;
    const next = panHistoryCameraByScreenDelta(baseCamera, deltaX, deltaY, bounds);
    publishCamera(next);
  }

  if (layout.nodes.length === 0) {
    return (
      <section className="history-empty" aria-labelledby="history-title">
        <p className="eyebrow">Development graph</p>
        <h1 id="history-title">History</h1>
        <p>No historical milestones have been recorded yet.</p>
      </section>
    );
  }

  return (
    <section className="history-page" aria-labelledby="history-title">
      <header className="history-heading">
        <div>
          <p className="eyebrow">Development graph</p>
          <h1 id="history-title">History</h1>
          <p id="history-navigation-hint" className="history-navigation-hint">
            Drag: pan · Wheel: zoom · <kbd>Ctrl</kbd>+drag: zoom area · <kbd>F</kbd>: fit current · <kbd>Shift</kbd>+<kbd>F</kbd>: fullscreen
          </p>
        </div>
        {currentNode === undefined ? null : (
          <button type="button" onClick={() => fitCurrent(true)}>Fit current (F)</button>
        )}
      </header>
      {activeNode === undefined ? null : <DetailSurface node={activeNode} />}
      <p className="history-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {fullscreenAnnouncement !== undefined ? (
          <span key={`fullscreen-${fullscreenAnnouncement.version}`}>{fullscreenAnnouncement.message}</span>
        ) : fitAnnouncementVersion === 0 ? null : (
          <span key={fitAnnouncementVersion}>History view fitted to current state</span>
        )}
      </p>
      <div
        className={`history-scroll${isPanning ? " history-panning" : ""}${isSelecting ? " history-selecting" : ""}`}
        ref={viewportRef}
        tabIndex={0}
        aria-label="Navigable project history timeline"
        aria-describedby="history-navigation-hint"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
        onKeyDown={handleHistoryKeyDown}
      >
        {camera === undefined ? null : (<svg
          className="history-canvas"
          width="100%"
          height="100%"
          viewBox={cameraViewBox(camera)}
          role="group"
          aria-labelledby="history-graph-title"
          aria-describedby="history-graph-description history-navigation-hint"
        >
          <title id="history-graph-title">Branching project history</title>
          <desc id="history-graph-description">
            Milestones ordered chronologically from left to right, with branch ancestry shown by lines and future roadmap items shown as muted outlined nodes.
          </desc>
          <g className="history-edges" aria-hidden="true">
            {layout.edges.map((edge) => {
              const lane = laneByBranch.get(edge.owningBranchId);
              return (
                <path
                  key={edge.id}
                  className={`${branchClass(lane?.styleOrdinal ?? 0)} history-edge-${edge.kind}`}
                  d={edgePath(edge)}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </g>
          <g className="history-lane-labels" aria-hidden="true">
            {layout.lanes.map((lane) => (
              <text
                key={lane.branchId}
                x={HISTORY_RENDER_METRICS.laneLabel.x}
                y={lane.y + HISTORY_RENDER_METRICS.laneLabel.yOffset}
              >
                {lane.branchId} · {lane.branchTitle}
              </text>
            ))}
          </g>
          <g className="history-nodes">
            {layout.nodes.map((node) => (
              <TimelineNode
                key={node.id}
                node={node}
                laneOrdinal={laneByBranch.get(node.branchId)?.styleOrdinal ?? 0}
                onHover={(item) => setHoveredId(item?.id)}
                onFocus={(item) => setFocusedId(item?.id)}
              />
            ))}
          </g>
          <g className="history-zones" aria-hidden="true">
            {layout.zones.map((zone) => (
              <g key={`${zone.kind}:${zone.xStart}`}>
                <line
                  x1={zone.xStart}
                  x2={zone.xStart}
                  y1={zone.y - HISTORY_RENDER_METRICS.zone.lineHalfHeight}
                  y2={zone.y + HISTORY_RENDER_METRICS.zone.lineHalfHeight}
                />
                <text
                  x={(zone.xStart + zone.xEnd) / 2}
                  y={zone.y + HISTORY_RENDER_METRICS.zone.labelOffset}
                  textAnchor="middle"
                >
                  {zone.label}
                </text>
              </g>
            ))}
          </g>
          <g className="history-months" aria-hidden="true">
            {layout.monthBands.map((band) => (
              <g key={band.monthKey}>
                <line x1={band.xStart} x2={band.xEnd} y1={band.y} y2={band.y} />
                <rect
                  x={(band.xStart + band.xEnd - HISTORY_RENDER_METRICS.month.labelBackgroundWidth) / 2}
                  y={band.y - HISTORY_RENDER_METRICS.month.labelBackgroundHeight / 2}
                  width={HISTORY_RENDER_METRICS.month.labelBackgroundWidth}
                  height={HISTORY_RENDER_METRICS.month.labelBackgroundHeight}
                />
                <text
                  x={(band.xStart + band.xEnd) / 2}
                  y={band.y + HISTORY_RENDER_METRICS.month.labelBaselineOffset}
                  textAnchor="middle"
                >
                  {band.label}
                </text>
                <line
                  className="history-month-boundary"
                  x1={band.xEnd}
                  x2={band.xEnd}
                  y1={band.y - HISTORY_RENDER_METRICS.month.boundaryHalfHeight}
                  y2={band.y + HISTORY_RENDER_METRICS.month.boundaryHalfHeight}
                />
              </g>
            ))}
          </g>
        </svg>)}
        {screenSelection === undefined ? null : (
          <div
            className="history-selection-rectangle"
            data-testid="history-selection-rectangle"
            aria-hidden="true"
            style={{
              left: screenSelection.left,
              top: screenSelection.top,
              width: screenSelection.right - screenSelection.left,
              height: screenSelection.bottom - screenSelection.top,
            }}
          />
        )}
        {camera === undefined || navigationBoundsRef.current === undefined ? null : (
          <div className="history-minimap-shell" data-history-control style={{ overflow: "visible" }}>
            <HistoryMinimap
              layout={layout}
              camera={camera}
              viewport={{ width: camera.viewportWidth, height: camera.viewportHeight }}
              navigationBounds={navigationBoundsRef.current}
              onCameraRequest={handleMinimapCameraRequest}
              interactionResetKey={fitAnnouncementVersion}
            />
          </div>
        )}
        <button
          type="button"
          className="history-fullscreen-control"
          data-history-control
          disabled={!fullscreenAvailable}
          aria-pressed={isFullscreen}
          aria-label={fullscreenAvailable
            ? isFullscreen ? "Exit fullscreen (Esc)" : "Enter fullscreen (Shift+F)"
            : "Fullscreen unavailable"}
          title={fullscreenAvailable
            ? isFullscreen ? "Exit fullscreen (Esc)" : "Enter fullscreen (Shift+F)"
            : "Fullscreen unavailable"}
          onClick={() => void toggleFullscreen()}
        >
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
            {isFullscreen ? (
              <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
            ) : (
              <path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" />
            )}
          </svg>
        </button>
      </div>
    </section>
  );
}
