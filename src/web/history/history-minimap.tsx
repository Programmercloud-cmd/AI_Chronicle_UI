import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { TimelineLayout } from "../../timeline";
import { cameraResetKey } from "./history-content-bounds";
import {
  clientPointToMinimap,
  createMinimapProjection,
  graphToMinimap,
  minimapPointToCamera,
  minimapViewportRect,
  MINIMAP_LOGICAL_HEIGHT,
  MINIMAP_LOGICAL_WIDTH,
} from "./minimap-math";
import type {
  CameraPose,
  GraphRect,
  ViewportSize,
} from "./viewport-math";
import { clampCamera } from "./viewport-math";

export interface HistoryMinimapProps {
  layout: TimelineLayout;
  camera: CameraPose;
  viewport: ViewportSize;
  navigationBounds: GraphRect;
  onCameraRequest?(camera: CameraPose): void;
  interactionResetKey?: number | string;
  className?: string;
}

function branchClass(ordinal: number): string {
  return `history-branch-${ordinal % 4}`;
}

interface MinimapDragGesture {
  pointerId: number;
  originClientX: number;
  originClientY: number;
  clientToLogicalScale: number;
  graphToLogicalScale: number;
  startingCamera: CameraPose;
  viewport: ViewportSize;
  navigationBounds: GraphRect;
  captureTarget: SVGRectElement;
  escapeListener: (event: KeyboardEvent) => void;
  active: boolean;
  didRequest: boolean;
  requestedCameraKeys: Set<string>;
  lastRequested?: CameraPose;
  pending?: CameraPose;
}

function sameCamera(left: CameraPose | undefined, right: CameraPose): boolean {
  return left !== undefined &&
    left.centerX === right.centerX &&
    left.centerY === right.centerY &&
    left.scale === right.scale;
}

function cameraPoseKey(camera: CameraPose): string {
  return `${camera.centerX}|${camera.centerY}|${camera.scale}`;
}

function useCommittedLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

export function HistoryMinimap({
  layout,
  camera,
  viewport,
  navigationBounds,
  onCameraRequest,
  interactionResetKey,
  className,
}: HistoryMinimapProps) {
  const gestureRef = useRef<MinimapDragGesture | undefined>(undefined);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const onCameraRequestRef = useCommittedLatest(onCameraRequest);
  const suppressClickRef = useRef(false);
  const latestCameraRef = useRef<CameraPose>({ ...camera });
  const layoutGeometryKey = useMemo(() => cameraResetKey(layout), [layout]);
  const incomingCameraKey = cameraPoseKey(camera);
  const environmentKey = [
    layoutGeometryKey,
    navigationBounds.left,
    navigationBounds.top,
    navigationBounds.right,
    navigationBounds.bottom,
    viewport.width,
    viewport.height,
    interactionResetKey === undefined
      ? "reset:undefined"
      : `reset:${typeof interactionResetKey}:${interactionResetKey}`,
  ].join("|");
  const observedInputsRef = useRef({ cameraKey: incomingCameraKey, environmentKey });
  const projection = useMemo(
    () => createMinimapProjection(navigationBounds),
    [navigationBounds.left, navigationBounds.top, navigationBounds.right, navigationBounds.bottom],
  );
  const viewportRect = useMemo(
    () => minimapViewportRect(camera, viewport, projection),
    [camera.centerX, camera.centerY, camera.scale, viewport.width, viewport.height, projection],
  );
  const laneOrdinal = useMemo(
    () => new Map(layout.lanes.map((lane) => [lane.branchId, lane.styleOrdinal])),
    [layout.lanes],
  );
  const projectedEdges = useMemo(
    () => layout.edges.map((edge) => ({
      edge,
      from: graphToMinimap(edge.points[0], projection),
      to: graphToMinimap(edge.points[1], projection),
      ordinal: laneOrdinal.get(edge.owningBranchId) ?? 0,
    })),
    [laneOrdinal, layout.edges, projection],
  );
  const projectedNodes = useMemo(
    () => layout.nodes.map((node) => ({
      node,
      point: graphToMinimap(node, projection),
      ordinal: laneOrdinal.get(node.branchId) ?? 0,
    })),
    [laneOrdinal, layout.nodes, projection],
  );
  const classes = className === undefined ? "history-minimap" : `history-minimap ${className}`;

  function cancelAnimationFrameRequest(): void {
    if (animationFrameRef.current === undefined) return;
    window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = undefined;
  }

  function releaseCapture(gesture: MinimapDragGesture): void {
    try {
      gesture.captureTarget.releasePointerCapture(gesture.pointerId);
    } catch {
      // Pointer capture can already be gone after browser cancellation.
    }
  }

  function clearGesture(gesture: MinimapDragGesture): void {
    cancelAnimationFrameRequest();
    window.removeEventListener("keydown", gesture.escapeListener);
    gestureRef.current = undefined;
    releaseCapture(gesture);
  }

  function emitCamera(gesture: MinimapDragGesture, requested: CameraPose): void {
    if (sameCamera(gesture.lastRequested, requested)) return;
    const callback = onCameraRequestRef.current;
    if (callback === undefined) return;
    gesture.lastRequested = requested;
    gesture.didRequest = true;
    latestCameraRef.current = requested;
    gesture.requestedCameraKeys.add(cameraPoseKey(requested));
    callback(requested);
  }

  function restoreAndClearGesture(gesture: MinimapDragGesture, suppressClick: boolean): void {
    clearGesture(gesture);
    if (suppressClick) suppressClickRef.current = true;
    if (gesture.didRequest) {
      const callback = onCameraRequestRef.current;
      if (callback !== undefined) {
        latestCameraRef.current = gesture.startingCamera;
        callback(gesture.startingCamera);
      }
    }
  }

  function requestedCameraForClientPoint(
    gesture: MinimapDragGesture,
    clientX: number,
    clientY: number,
  ): CameraPose {
    const logicalDeltaX = (clientX - gesture.originClientX) / gesture.clientToLogicalScale;
    const logicalDeltaY = (clientY - gesture.originClientY) / gesture.clientToLogicalScale;
    return clampCamera(
      {
        centerX: gesture.startingCamera.centerX + logicalDeltaX / gesture.graphToLogicalScale,
        centerY: gesture.startingCamera.centerY + logicalDeltaY / gesture.graphToLogicalScale,
        scale: gesture.startingCamera.scale,
      },
      gesture.viewport,
      gesture.navigationBounds,
    );
  }

  function activateForClientPoint(
    gesture: MinimapDragGesture,
    clientX: number,
    clientY: number,
  ): boolean {
    if (gesture.active) return true;
    const distance = Math.hypot(
      clientX - gesture.originClientX,
      clientY - gesture.originClientY,
    );
    if (distance < 4) return false;
    gesture.active = true;
    return true;
  }

  function scheduleCamera(gesture: MinimapDragGesture, requested: CameraPose): void {
    gesture.pending = requested;
    if (animationFrameRef.current !== undefined) return;
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = undefined;
      const currentGesture = gestureRef.current;
      if (currentGesture !== gesture || !gesture.active || gesture.pending === undefined) return;
      const pending = gesture.pending;
      gesture.pending = undefined;
      emitCamera(gesture, pending);
    });
  }

  function handleViewportPointerDown(event: ReactPointerEvent<SVGRectElement>): void {
    if (
      onCameraRequestRef.current === undefined ||
      event.button !== 0 ||
      event.isPrimary === false ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      gestureRef.current !== undefined
    ) {
      return;
    }
    const elementRect = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (elementRect === undefined || elementRect.width <= 0 || elementRect.height <= 0) return;
    const clientToLogicalScale = Math.min(
      elementRect.width / MINIMAP_LOGICAL_WIDTH,
      elementRect.height / MINIMAP_LOGICAL_HEIGHT,
    );
    if (!Number.isFinite(clientToLogicalScale) || clientToLogicalScale <= 0) return;
    const pointerId = event.pointerId;
    const escapeListener = (keyboardEvent: KeyboardEvent): void => {
      if (keyboardEvent.key !== "Escape") return;
      const gesture = gestureRef.current;
      if (gesture === undefined || gesture.pointerId !== pointerId) return;
      keyboardEvent.preventDefault();
      restoreAndClearGesture(gesture, gesture.active);
    };
    const gesture: MinimapDragGesture = {
      pointerId,
      originClientX: event.clientX,
      originClientY: event.clientY,
      clientToLogicalScale,
      graphToLogicalScale: projection.scale,
      startingCamera: { ...latestCameraRef.current },
      viewport: { ...viewport },
      navigationBounds: { ...navigationBounds },
      captureTarget: event.currentTarget,
      escapeListener,
      active: false,
      didRequest: false,
      requestedCameraKeys: new Set<string>(),
      lastRequested: { ...latestCameraRef.current },
    };
    gestureRef.current = gesture;
    event.currentTarget.setPointerCapture(pointerId);
    window.addEventListener("keydown", escapeListener);
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>): void {
    const gesture = gestureRef.current;
    if (gesture === undefined || gesture.pointerId !== event.pointerId) return;
    if (!activateForClientPoint(gesture, event.clientX, event.clientY)) return;
    scheduleCamera(gesture, requestedCameraForClientPoint(gesture, event.clientX, event.clientY));
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>): void {
    const gesture = gestureRef.current;
    if (gesture === undefined || gesture.pointerId !== event.pointerId) return;
    const active = activateForClientPoint(gesture, event.clientX, event.clientY);
    cancelAnimationFrameRequest();
    if (active) {
      gesture.pending = undefined;
      emitCamera(gesture, requestedCameraForClientPoint(gesture, event.clientX, event.clientY));
      suppressClickRef.current = true;
    }
    clearGesture(gesture);
  }

  function handlePointerCancel(event: ReactPointerEvent<SVGSVGElement>): void {
    const gesture = gestureRef.current;
    if (gesture === undefined || gesture.pointerId !== event.pointerId) return;
    restoreAndClearGesture(gesture, false);
  }

  function handleLostPointerCapture(event: ReactPointerEvent<SVGSVGElement>): void {
    const gesture = gestureRef.current;
    if (gesture === undefined || gesture.pointerId !== event.pointerId) return;
    restoreAndClearGesture(gesture, false);
  }

  useEffect(() => () => {
    const gesture = gestureRef.current;
    if (gesture === undefined) return;
    cancelAnimationFrameRequest();
    window.removeEventListener("keydown", gesture.escapeListener);
    gestureRef.current = undefined;
    releaseCapture(gesture);
  }, []);

  useLayoutEffect(() => {
    const previous = observedInputsRef.current;
    const environmentChanged = previous.environmentKey !== environmentKey;
    const cameraChanged = previous.cameraKey !== incomingCameraKey;
    observedInputsRef.current = { cameraKey: incomingCameraKey, environmentKey };
    if (!environmentChanged && !cameraChanged) {
      // A completed request remains the synchronous origin for a second
      // gesture only until the controlled parent renders again. With no owned
      // gesture, even a same-key camera prop is authoritative.
      if (gestureRef.current === undefined) latestCameraRef.current = { ...camera };
      return;
    }

    const gesture = gestureRef.current;
    if (
      !environmentChanged &&
      gesture?.active === true &&
      gesture.requestedCameraKeys.has(incomingCameraKey)
    ) {
      return;
    }

    if (gesture !== undefined) {
      if (gesture.active) suppressClickRef.current = true;
      clearGesture(gesture);
    }
    latestCameraRef.current = { ...camera };
  });

  function handleClick(event: ReactMouseEvent<SVGSVGElement>): void {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const callback = onCameraRequestRef.current;
    if (
      callback === undefined ||
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }
    const logicalPoint = clientPointToMinimap(
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
    );
    if (logicalPoint === undefined) return;
    const requestedCamera = minimapPointToCamera(
      logicalPoint,
      projection,
      latestCameraRef.current,
      viewport,
      navigationBounds,
    );
    if (requestedCamera !== undefined) {
      latestCameraRef.current = requestedCamera;
      callback(requestedCamera);
    }
  }

  return (
    <svg
      className={classes}
      viewBox={`0 0 ${MINIMAP_LOGICAL_WIDTH} ${MINIMAP_LOGICAL_HEIGHT}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Project history overview minimap"
      data-testid="history-minimap"
      overflow="visible"
      onClick={handleClick}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
    >
      <title>Project history overview</title>
      <g className="history-minimap-edges" aria-hidden="true">
        {projectedEdges.map(({ edge, from, to, ordinal }) => {
          return (
            <line
              key={edge.id}
              data-edge-id={edge.id}
              data-edge-kind={edge.kind}
              className={`history-minimap-edge ${branchClass(ordinal)} history-edge-${edge.kind}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.25}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </g>
      <g className="history-minimap-nodes" aria-hidden="true">
        {projectedNodes.map(({ node, point, ordinal }) => {
          const current = node.treatment === "current";
          const planned = node.sourceKind === "roadmap";
          return (
            <g
              key={node.id}
              data-node-id={node.id}
              data-source-kind={node.sourceKind}
              data-treatment={node.treatment}
              className={`history-minimap-node ${branchClass(ordinal)}${current ? " history-node-current" : ""}`}
              transform={`translate(${point.x} ${point.y})`}
            >
              {current ? (
                <>
                  <circle
                    data-current-marker="outer-ring"
                    r={5}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    data-current-marker="inner-ring"
                    r={3}
                    fill="var(--history-background)"
                    stroke="currentColor"
                    strokeWidth={1.25}
                    vectorEffect="non-scaling-stroke"
                  />
                  <rect
                    data-current-marker="diamond"
                    x={-1.25}
                    y={-1.25}
                    width={2.5}
                    height={2.5}
                    transform="rotate(45)"
                    fill="currentColor"
                  />
                </>
              ) : (
                <circle
                  r={planned ? 3 : 2.5}
                  fill={planned ? "var(--history-background)" : "currentColor"}
                  stroke="currentColor"
                  strokeWidth={planned ? 1.25 : 0}
                  strokeDasharray={planned ? "1.5 1.5" : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </g>
          );
        })}
      </g>
      <g className="history-minimap-viewport" aria-hidden="true">
        <rect
          data-minimap-viewport="halo"
          x={viewportRect.x}
          y={viewportRect.y}
          width={viewportRect.width}
          height={viewportRect.height}
          fill="none"
          stroke="var(--history-background)"
          strokeWidth={4}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
        <rect
          data-minimap-viewport="outline"
          x={viewportRect.x}
          y={viewportRect.y}
          width={viewportRect.width}
          height={viewportRect.height}
          fill="none"
          stroke="var(--history-text)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
        <rect
          data-minimap-viewport="hit-target"
          x={viewportRect.x}
          y={viewportRect.y}
          width={viewportRect.width}
          height={viewportRect.height}
          fill="none"
          stroke="transparent"
          strokeWidth={24}
          vectorEffect="non-scaling-stroke"
          pointerEvents="stroke"
          onPointerDown={handleViewportPointerDown}
        />
      </g>
    </svg>
  );
}
