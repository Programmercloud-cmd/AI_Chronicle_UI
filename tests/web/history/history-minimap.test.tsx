// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Suspense, startTransition, useState } from "react";

import { canonicalCamera } from "../../../src/web/history/history-content-bounds";
import { HistoryMinimap } from "../../../src/web/history/history-minimap";
import { createMinimapProjection, graphToMinimap } from "../../../src/web/history/minimap-math";
import * as minimapMathModule from "../../../src/web/history/minimap-math";
import { visibleGraphRect, type CameraPose } from "../../../src/web/history/viewport-math";
import { canonicalHistoryLayout } from "./fixtures";

function renderMinimap(onCameraRequest?: (camera: CameraPose) => void, cameraScale?: number) {
  const layout = canonicalHistoryLayout();
  const viewport = { width: 800, height: 500 };
  const canonical = canonicalCamera(layout, viewport);
  const camera = cameraScale === undefined
    ? canonical.pose
    : {
        centerX: (canonical.navigationBounds.left + canonical.navigationBounds.right) / 2,
        centerY: (canonical.navigationBounds.top + canonical.navigationBounds.bottom) / 2,
        scale: cameraScale,
      };
  const rendered = render(
    <HistoryMinimap
      layout={layout}
      camera={camera}
      viewport={viewport}
      navigationBounds={canonical.navigationBounds}
      onCameraRequest={onCameraRequest}
    />,
  );
  return {
    ...rendered,
    layout,
    canonical,
    camera,
    viewport,
    projection: createMinimapProjection(canonical.navigationBounds),
  };
}

function fixedSvgRect(element: SVGSVGElement, rect = { left: 0, top: 0, width: 240, height: 144 }): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  });
}

function mockPointerCapture(target: SVGRectElement) {
  const setPointerCapture = vi.fn<(pointerId: number) => void>();
  const releasePointerCapture = vi.fn<(pointerId: number) => void>();
  Object.defineProperties(target, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
  });
  return { setPointerCapture, releasePointerCapture };
}

function installAnimationFrameHarness() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextId;
    nextId += 1;
    callbacks.set(id, callback);
    return id;
  });
  const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    callbacks.delete(id);
  });
  return {
    cancel,
    flush(time = 16) {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of pending) callback(time);
    },
    pendingCount: () => callbacks.size,
  };
}

const NEVER_RESOLVING_MINIMAP_RENDER = new Promise<void>(() => undefined);
let setInterruptedMinimapCallback: ((callback: (camera: CameraPose) => void) => void) | undefined;

function InterruptAfterMinimap({ active }: { active: boolean }) {
  if (active) throw NEVER_RESOLVING_MINIMAP_RENDER;
  return null;
}

function InterruptedMinimapHarness({
  layout,
  camera,
  viewport,
  navigationBounds,
  initialCallback,
}: {
  layout: ReturnType<typeof canonicalHistoryLayout>;
  camera: CameraPose;
  viewport: { width: number; height: number };
  navigationBounds: ReturnType<typeof canonicalCamera>["navigationBounds"];
  initialCallback(camera: CameraPose): void;
}) {
  const [state, setState] = useState({ callback: initialCallback, suspend: false });
  setInterruptedMinimapCallback = (callback) => setState({ callback, suspend: true });
  return (
    <Suspense fallback={<div data-testid="minimap-interrupted-fallback">Loading</div>}>
      <HistoryMinimap
        layout={layout}
        camera={camera}
        viewport={viewport}
        navigationBounds={navigationBounds}
        onCameraRequest={state.callback}
      />
      <InterruptAfterMinimap active={state.suspend} />
    </Suspense>
  );
}

describe("History minimap renderer", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.documentElement.removeAttribute("data-theme");
  });

  it("renders the fixed logical SVG and every accepted edge and node", () => {
    const { container, layout } = renderMinimap();
    const minimap = screen.getByRole("img", { name: "Project history overview minimap" });

    expect(minimap).toHaveAttribute("viewBox", "0 0 240 144");
    expect(minimap).toHaveAttribute("preserveAspectRatio", "xMidYMid meet");
    expect(container.querySelectorAll("[data-edge-id]")).toHaveLength(layout.edges.length);
    expect(container.querySelectorAll("[data-node-id]")).toHaveLength(layout.nodes.length);
    for (const edge of layout.edges) {
      expect(container.querySelector(`[data-edge-id='${edge.id}']`)).toBeInTheDocument();
    }
    for (const node of layout.nodes) {
      expect(container.querySelector(`[data-node-id='${node.id}']`)).toBeInTheDocument();
    }
  });

  it("renders projected future nodes and edges with simplified treatments", () => {
    const { container, layout } = renderMinimap();
    const projectedNodes = layout.nodes.filter((node) => node.sourceKind === "roadmap");
    const projectedEdges = layout.edges.filter((edge) => edge.kind === "projection");

    expect(container.querySelectorAll("[data-source-kind='roadmap']")).toHaveLength(projectedNodes.length);
    expect(container.querySelectorAll("[data-edge-kind='projection']")).toHaveLength(projectedEdges.length);
    expect(container.querySelector("[data-source-kind='roadmap'] circle")).toHaveAttribute("stroke-dasharray", "1.5 1.5");
  });

  it("marks current with color class, double ring, and a redundant diamond shape", () => {
    const { container } = renderMinimap();
    const current = container.querySelector("[data-treatment='current']");

    expect(current).toHaveClass("history-node-current");
    expect(current?.querySelector("[data-current-marker='outer-ring']")).toBeInTheDocument();
    expect(current?.querySelector("[data-current-marker='inner-ring']")).toBeInTheDocument();
    expect(current?.querySelector("[data-current-marker='diamond']")).toBeInTheDocument();
  });

  it("contains no readable milestone labels, dates, month labels, or toolbar chrome", () => {
    const { container, layout } = renderMinimap();

    expect(container.querySelector("text")).not.toBeInTheDocument();
    expect(container.querySelector("button")).not.toBeInTheDocument();
    expect(container.querySelector("a")).not.toBeInTheDocument();
    for (const node of layout.nodes) {
      expect(screen.queryByText(node.visibleTitle)).not.toBeInTheDocument();
      if (node.exactTimestampIso !== undefined) {
        expect(screen.queryByText(node.exactTimestampIso)).not.toBeInTheDocument();
      }
    }
  });

  it("uses theme tokens for an exact halo/outline pair and a separate 24px hit target", () => {
    const { container } = renderMinimap();
    const halo = container.querySelector("[data-minimap-viewport='halo']");
    const outline = container.querySelector("[data-minimap-viewport='outline']");
    const hitTarget = container.querySelector("[data-minimap-viewport='hit-target']");

    expect(halo).toHaveAttribute("stroke", "var(--history-background)");
    expect(halo).toHaveAttribute("vector-effect", "non-scaling-stroke");
    expect(outline).toHaveAttribute("stroke", "var(--history-text)");
    expect(outline).toHaveAttribute("vector-effect", "non-scaling-stroke");
    for (const attribute of ["x", "y", "width", "height"] as const) {
      expect(outline?.getAttribute(attribute)).toBe(halo?.getAttribute(attribute));
      expect(hitTarget?.getAttribute(attribute)).toBe(halo?.getAttribute(attribute));
    }
    expect(hitTarget).toHaveAttribute("fill", "none");
    expect(hitTarget).toHaveAttribute("stroke", "transparent");
    expect(hitTarget).toHaveAttribute("stroke-width", "24");
    expect(hitTarget).toHaveAttribute("vector-effect", "non-scaling-stroke");
    expect(hitTarget).toHaveAttribute("pointer-events", "stroke");
  });

  it("keeps rendered primitive count linear in accepted nodes and edges", () => {
    const { container, layout } = renderMinimap();
    const graphPrimitives = container.querySelectorAll(".history-minimap-edges line, .history-minimap-nodes circle, .history-minimap-nodes rect");

    // One edge primitive each; ordinary nodes use one primitive and current uses three.
    expect(graphPrimitives.length).toBe(layout.edges.length + layout.nodes.length + 2);
  });

  it("memoizes static node and edge projections across camera-only and equivalent rerenders", () => {
    const projectionSpy = vi.spyOn(minimapMathModule, "graphToMinimap");
    const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
    const { camera, canonical, layout, rerender, viewport } = renderMinimap(onCameraRequest, 1.75);
    const expectedInitialCalls = layout.edges.length * 2 + layout.nodes.length;
    expect(projectionSpy).toHaveBeenCalledTimes(expectedInitialCalls);
    const outline = screen.getByTestId("history-minimap").querySelector(
      "[data-minimap-viewport='outline']",
    );
    const initialWidth = outline?.getAttribute("width");

    projectionSpy.mockClear();
    const cameraOnly = { ...camera, scale: 2.25 };
    rerender(
      <HistoryMinimap
        layout={layout}
        camera={cameraOnly}
        viewport={viewport}
        navigationBounds={canonical.navigationBounds}
        onCameraRequest={onCameraRequest}
      />,
    );
    expect(projectionSpy).not.toHaveBeenCalled();
    expect(outline?.getAttribute("width")).not.toBe(initialWidth);

    document.documentElement.dataset.theme = "dark";
    rerender(
      <HistoryMinimap
        className="detail-equivalent"
        layout={layout}
        camera={cameraOnly}
        viewport={viewport}
        navigationBounds={canonical.navigationBounds}
        onCameraRequest={() => undefined}
      />,
    );
    expect(projectionSpy).not.toHaveBeenCalled();

    const changedBounds = {
      left: canonical.navigationBounds.left - 20,
      top: canonical.navigationBounds.top - 10,
      right: canonical.navigationBounds.right + 20,
      bottom: canonical.navigationBounds.bottom + 10,
    };
    rerender(
      <HistoryMinimap
        layout={layout}
        camera={cameraOnly}
        viewport={viewport}
        navigationBounds={changedBounds}
        onCameraRequest={onCameraRequest}
      />,
    );
    expect(projectionSpy).toHaveBeenCalledTimes(expectedInitialCalls);

    projectionSpy.mockClear();
    const geometryChanged = {
      ...layout,
      nodes: layout.nodes.map((node, index) => index === 0 ? { ...node, x: node.x + 1 } : node),
    };
    rerender(
      <HistoryMinimap
        layout={geometryChanged}
        camera={cameraOnly}
        viewport={viewport}
        navigationBounds={changedBounds}
        onCameraRequest={onCameraRequest}
      />,
    );
    expect(projectionSpy).toHaveBeenCalledTimes(layout.nodes.length);
  });

  it("never exposes an abandoned callback prop to retained minimap click or drag handlers", () => {
    installAnimationFrameHarness();
    const committedCallback = vi.fn<(camera: CameraPose) => void>();
    const abandonedCallback = vi.fn<(camera: CameraPose) => void>();
    const layout = canonicalHistoryLayout();
    const viewport = { width: 800, height: 500 };
    const canonical = canonicalCamera(layout, viewport);
    render(
      <InterruptedMinimapHarness
        layout={layout}
        camera={canonical.pose}
        viewport={viewport}
        navigationBounds={canonical.navigationBounds}
        initialCallback={committedCallback}
      />,
    );
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedSvgRect(minimap);
    const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
    mockPointerCapture(hitTarget);
    const projection = createMinimapProjection(canonical.navigationBounds);
    const center = {
      x: projection.plotBounds.x + projection.plotBounds.width / 2,
      y: projection.plotBounds.y + projection.plotBounds.height / 2,
    };

    act(() => {
      startTransition(() => {
        setInterruptedMinimapCallback?.(abandonedCallback);
      });
    });
    expect(screen.queryByTestId("minimap-interrupted-fallback")).not.toBeInTheDocument();
    expect(screen.getByTestId("history-minimap")).toBe(minimap);

    fireEvent.click(minimap, { button: 0, clientX: center.x, clientY: center.y });
    fireEvent.pointerDown(hitTarget, {
      pointerId: 31,
      button: 0,
      isPrimary: true,
      clientX: center.x,
      clientY: center.y,
    });
    fireEvent.pointerUp(minimap, {
      pointerId: 31,
      clientX: center.x + 10,
      clientY: center.y,
    });
    expect(committedCallback).toHaveBeenCalledTimes(2);
    expect(abandonedCallback).not.toHaveBeenCalled();
  });

  it("requests one clamped camera for an accepted unmodified primary click", () => {
    const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
    const { canonical, projection, viewport } = renderMinimap(onCameraRequest);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedSvgRect(minimap);
    const graphCenter = {
      x: (canonical.navigationBounds.left + canonical.navigationBounds.right) / 2,
      y: (canonical.navigationBounds.top + canonical.navigationBounds.bottom) / 2,
    };
    const logical = graphToMinimap(graphCenter, projection);

    fireEvent.click(minimap, { clientX: logical.x, clientY: logical.y, button: 0 });

    expect(onCameraRequest).toHaveBeenCalledTimes(1);
    const requested = onCameraRequest.mock.calls[0]![0];
    expect(requested.centerX).toBeCloseTo(graphCenter.x, 12);
    expect(requested.centerY).toBeCloseTo(graphCenter.y, 12);
    expect(requested.scale).toBe(canonical.pose.scale);
    const visible = visibleGraphRect(requested, viewport);
    expect(visible.left).toBeGreaterThanOrEqual(canonical.navigationBounds.left);
    expect(visible.top).toBeGreaterThanOrEqual(canonical.navigationBounds.top);
    expect(visible.right).toBeLessThanOrEqual(canonical.navigationBounds.right);
    expect(visible.bottom).toBeLessThanOrEqual(canonical.navigationBounds.bottom);
  });

  it("clamps center, every edge, and every corner with the requested scale rather than scale 1", () => {
    const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
    const { canonical, layout, projection, rerender, viewport } = renderMinimap(onCameraRequest);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedSvgRect(minimap);
    const bounds = canonical.navigationBounds;
    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;
    const clickVectors = [
      { name: "top-left", x: bounds.left, y: bounds.top },
      { name: "top", x: centerX, y: bounds.top },
      { name: "top-right", x: bounds.right, y: bounds.top },
      { name: "left", x: bounds.left, y: centerY },
      { name: "center", x: centerX, y: centerY },
      { name: "right", x: bounds.right, y: centerY },
      { name: "bottom-left", x: bounds.left, y: bounds.bottom },
      { name: "bottom", x: centerX, y: bounds.bottom },
      { name: "bottom-right", x: bounds.right, y: bounds.bottom },
    ];

    for (const scale of [canonical.minScale, 1.75, 4]) {
      const inputCamera = { ...canonical.pose, scale };
      rerender(
        <HistoryMinimap
          layout={layout}
          camera={inputCamera}
          viewport={viewport}
          navigationBounds={bounds}
          onCameraRequest={onCameraRequest}
        />,
      );

      for (const vector of clickVectors) {
        onCameraRequest.mockClear();
        const logical = graphToMinimap(vector, projection);
        fireEvent.click(minimap, { clientX: logical.x, clientY: logical.y, button: 0 });

        expect(onCameraRequest, `${vector.name} callback at scale ${scale}`).toHaveBeenCalledTimes(1);
        const requested = onCameraRequest.mock.calls[0]![0];
        const halfWidth = viewport.width / (2 * scale);
        const halfHeight = viewport.height / (2 * scale);
        const expectedCenterX = Math.min(
          bounds.right - halfWidth,
          Math.max(bounds.left + halfWidth, vector.x),
        );
        const expectedCenterY = Math.min(
          bounds.bottom - halfHeight,
          Math.max(bounds.top + halfHeight, vector.y),
        );
        expect(requested.centerX, `${vector.name} centerX at scale ${scale}`).toBeCloseTo(expectedCenterX, 12);
        expect(requested.centerY, `${vector.name} centerY at scale ${scale}`).toBeCloseTo(expectedCenterY, 12);
        expect(requested.scale, `${vector.name} scale ${scale}`).toBe(scale);
        const visible = visibleGraphRect(requested, viewport);
        const tolerance = Number.EPSILON * 64 * Math.max(
          1,
          Math.abs(bounds.left),
          Math.abs(bounds.top),
          Math.abs(bounds.right),
          Math.abs(bounds.bottom),
          viewport.width / scale,
          viewport.height / scale,
        );
        expect(visible.left, `${vector.name} left at scale ${scale}`).toBeGreaterThanOrEqual(bounds.left - tolerance);
        expect(visible.top, `${vector.name} top at scale ${scale}`).toBeGreaterThanOrEqual(bounds.top - tolerance);
        expect(visible.right, `${vector.name} right at scale ${scale}`).toBeLessThanOrEqual(bounds.right + tolerance);
        expect(visible.bottom, `${vector.name} bottom at scale ${scale}`).toBeLessThanOrEqual(bounds.bottom + tolerance);
      }
    }
  });

  it("ignores SVG viewBox letterbox and graph plot letterbox/padding clicks", () => {
    const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
    const { projection } = renderMinimap(onCameraRequest);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedSvgRect(minimap, { left: 10, top: 20, width: 480, height: 144 });

    fireEvent.click(minimap, { clientX: 100, clientY: 92, button: 0 }); // outer xMidYMid meet space
    expect(onCameraRequest).not.toHaveBeenCalled();

    fixedSvgRect(minimap);
    fireEvent.click(minimap, { clientX: 4, clientY: 72, button: 0 }); // logical padding
    expect(onCameraRequest).not.toHaveBeenCalled();

    const letterbox = projection.letterboxRects.find((rect) => rect.width > 0 && rect.height > 0);
    expect(letterbox).toBeDefined();
    fireEvent.click(minimap, {
      clientX: letterbox!.x + letterbox!.width / 2,
      clientY: letterbox!.y + letterbox!.height / 2,
      button: 0,
    });
    expect(onCameraRequest).not.toHaveBeenCalled();
  });

  it.each([
    { name: "middle button", event: { button: 1 } },
    { name: "Alt", event: { button: 0, altKey: true } },
    { name: "Control", event: { button: 0, ctrlKey: true } },
    { name: "Meta", event: { button: 0, metaKey: true } },
    { name: "Shift", event: { button: 0, shiftKey: true } },
  ])("ignores $name activation", ({ event }) => {
    const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
    renderMinimap(onCameraRequest);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedSvgRect(minimap);

    fireEvent.click(minimap, { clientX: 120, clientY: 72, ...event });

    expect(onCameraRequest).not.toHaveBeenCalled();
  });

  it("keeps diagonal Euclidean movement below 4px as one ordinary click despite Manhattan distance", () => {
    const raf = installAnimationFrameHarness();
    const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
    const { projection } = renderMinimap(onCameraRequest);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedSvgRect(minimap);
    const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
    const capture = mockPointerCapture(hitTarget);
    const origin = {
      x: projection.plotBounds.x + projection.plotBounds.width / 2,
      y: projection.plotBounds.y + projection.plotBounds.height / 2,
    };

    fireEvent.pointerDown(hitTarget, { pointerId: 7, button: 0, isPrimary: true, clientX: origin.x, clientY: origin.y });
    fireEvent.pointerMove(minimap, { pointerId: 7, clientX: origin.x + 2.7, clientY: origin.y + 2.7 });
    expect(raf.pendingCount()).toBe(0);
    expect(onCameraRequest).not.toHaveBeenCalled();
    fireEvent.pointerUp(minimap, { pointerId: 7, clientX: origin.x + 2.7, clientY: origin.y + 2.7 });
    expect(capture.setPointerCapture).toHaveBeenCalledWith(7);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(onCameraRequest).not.toHaveBeenCalled();

    fireEvent.click(minimap, { button: 0, clientX: origin.x + 2.7, clientY: origin.y + 2.7 });
    expect(onCameraRequest).toHaveBeenCalledTimes(1);
  });

  it("activates at exactly 4 CSS pixels using Euclidean distance and suppresses one synthetic click", () => {
    const raf = installAnimationFrameHarness();
    const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
    const { camera, projection } = renderMinimap(onCameraRequest);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedSvgRect(minimap);
    const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
    const capture = mockPointerCapture(hitTarget);
    const origin = {
      x: projection.plotBounds.x + projection.plotBounds.width / 2,
      y: projection.plotBounds.y + projection.plotBounds.height / 2,
    };

    fireEvent.pointerDown(hitTarget, { pointerId: 8, button: 0, isPrimary: true, clientX: origin.x, clientY: origin.y });
    fireEvent.pointerMove(minimap, { pointerId: 8, clientX: origin.x + 2.4, clientY: origin.y + 3.2 });
    expect(raf.pendingCount()).toBe(1);
    expect(onCameraRequest).not.toHaveBeenCalled();
    raf.flush();
    expect(onCameraRequest).toHaveBeenCalledTimes(1);
    expect(onCameraRequest.mock.calls[0]![0].scale).toBe(camera.scale);

    fireEvent.pointerUp(minimap, { pointerId: 8, clientX: origin.x + 2.4, clientY: origin.y + 3.2 });
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(8);
    expect(onCameraRequest).toHaveBeenCalledTimes(1);
    fireEvent.click(minimap, { button: 0, clientX: origin.x + 2.4, clientY: origin.y + 3.2 });
    expect(onCameraRequest).toHaveBeenCalledTimes(1);
    fireEvent.click(minimap, { button: 0, clientX: origin.x, clientY: origin.y });
    expect(onCameraRequest).toHaveBeenCalledTimes(2); // suppression is consumed exactly once
  });

  it("drags to every navigation edge and corner with exact scale-aware clamping", () => {
    installAnimationFrameHarness();
    const seedViewport = { width: 800, height: 500 };
    const seedCanonical = canonicalCamera(canonicalHistoryLayout(), seedViewport);
    const seedBounds = seedCanonical.navigationBounds;
    const seedCenter = {
      x: (seedBounds.left + seedBounds.right) / 2,
      y: (seedBounds.top + seedBounds.bottom) / 2,
    };
    const targetSelectors = [
      { name: "top-left", x: "left", y: "top" },
      { name: "top", x: "center", y: "top" },
      { name: "top-right", x: "right", y: "top" },
      { name: "left", x: "left", y: "center" },
      { name: "right", x: "right", y: "center" },
      { name: "bottom-left", x: "left", y: "bottom" },
      { name: "bottom", x: "center", y: "bottom" },
      { name: "bottom-right", x: "right", y: "bottom" },
    ];

    for (const [index, selector] of targetSelectors.entries()) {
      cleanup();
      const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
      const { camera, canonical, projection, viewport } = renderMinimap(onCameraRequest, 4);
      const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
      fixedSvgRect(minimap);
      const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
      const capture = mockPointerCapture(hitTarget);
      const bounds = canonical.navigationBounds;
      const origin = graphToMinimap({ x: camera.centerX, y: camera.centerY }, projection);
      const target = {
        name: selector.name,
        x: selector.x === "left" ? bounds.left : selector.x === "right" ? bounds.right : seedCenter.x,
        y: selector.y === "top" ? bounds.top : selector.y === "bottom" ? bounds.bottom : seedCenter.y,
      };
      const pointerId = 20 + index;
      const targetClient = graphToMinimap(target, projection);
      fireEvent.pointerDown(hitTarget, { pointerId, button: 0, isPrimary: true, clientX: origin.x, clientY: origin.y });
      fireEvent.pointerUp(minimap, {
        pointerId,
        clientX: targetClient.x,
        clientY: targetClient.y,
      });

      expect(onCameraRequest, `${target.name} callback`).toHaveBeenCalledTimes(1);
      const requested = onCameraRequest.mock.calls[0]![0];
      const halfWidth = viewport.width / (2 * camera.scale);
      const halfHeight = viewport.height / (2 * camera.scale);
      expect(requested.centerX, `${target.name} centerX`).toBeCloseTo(Math.min(
        bounds.right - halfWidth,
        Math.max(bounds.left + halfWidth, target.x),
      ), 12);
      expect(requested.centerY, `${target.name} centerY`).toBeCloseTo(Math.min(
        bounds.bottom - halfHeight,
        Math.max(bounds.top + halfHeight, target.y),
      ), 12);
      expect(requested.scale, `${target.name} scale`).toBe(4);
      const visible = visibleGraphRect(requested, viewport);
      const tolerance = Number.EPSILON * 64 * Math.max(1, ...Object.values(bounds).map(Math.abs));
      expect(visible.left).toBeGreaterThanOrEqual(bounds.left - tolerance);
      expect(visible.top).toBeGreaterThanOrEqual(bounds.top - tolerance);
      expect(visible.right).toBeLessThanOrEqual(bounds.right + tolerance);
      expect(visible.bottom).toBeLessThanOrEqual(bounds.bottom + tolerance);
      fireEvent.click(minimap, { button: 0, clientX: targetClient.x, clientY: targetClient.y });
      expect(onCameraRequest).toHaveBeenCalledTimes(1);
      expect(capture.setPointerCapture).toHaveBeenCalledOnce();
      expect(capture.releasePointerCapture).toHaveBeenCalledOnce();
    }
  });

  it("coalesces moves to one request per animation frame and commits pointerup final pose", () => {
    const raf = installAnimationFrameHarness();
    const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
    const { camera, projection } = renderMinimap(onCameraRequest, 1.75);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedSvgRect(minimap);
    const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
    mockPointerCapture(hitTarget);
    const origin = graphToMinimap({ x: camera.centerX, y: camera.centerY }, projection);

    fireEvent.pointerDown(hitTarget, { pointerId: 40, button: 0, isPrimary: true, clientX: origin.x, clientY: origin.y });
    for (const delta of [5, 10, 20]) {
      fireEvent.pointerMove(minimap, { pointerId: 40, clientX: origin.x + delta, clientY: origin.y });
    }
    expect(raf.pendingCount()).toBe(1);
    expect(onCameraRequest).not.toHaveBeenCalled();
    raf.flush();
    expect(onCameraRequest).toHaveBeenCalledTimes(1);
    expect(onCameraRequest.mock.calls[0]![0].centerX).toBeCloseTo(camera.centerX + 20 / projection.scale, 12);

    fireEvent.pointerMove(minimap, { pointerId: 40, clientX: origin.x + 25, clientY: origin.y });
    expect(raf.pendingCount()).toBe(1);
    fireEvent.pointerUp(minimap, { pointerId: 40, clientX: origin.x + 30, clientY: origin.y });
    expect(raf.pendingCount()).toBe(0);
    expect(raf.cancel).toHaveBeenCalled();
    expect(onCameraRequest).toHaveBeenCalledTimes(2);
    expect(onCameraRequest.mock.calls[1]![0].centerX).toBeCloseTo(camera.centerX + 30 / projection.scale, 12);
    expect(onCameraRequest.mock.calls[1]![0].scale).toBe(1.75);
    raf.flush();
    expect(onCameraRequest).toHaveBeenCalledTimes(2);
  });

  it("accumulates two immediate drags from the latest requested camera without waiting for a parent echo", () => {
    installAnimationFrameHarness();
    const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
    const { camera, projection } = renderMinimap(onCameraRequest, 1.75);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedSvgRect(minimap);
    const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
    mockPointerCapture(hitTarget);
    const origin = graphToMinimap({ x: camera.centerX, y: camera.centerY }, projection);

    fireEvent.pointerDown(hitTarget, { pointerId: 41, button: 0, isPrimary: true, clientX: origin.x, clientY: origin.y });
    fireEvent.pointerUp(minimap, { pointerId: 41, clientX: origin.x + 12, clientY: origin.y });
    expect(onCameraRequest).toHaveBeenCalledTimes(1);
    const first = onCameraRequest.mock.calls[0]![0];
    expect(first.centerX).toBeCloseTo(camera.centerX + 12 / projection.scale, 12);
    fireEvent.click(minimap, { button: 0, clientX: origin.x + 12, clientY: origin.y });
    expect(onCameraRequest).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(hitTarget, { pointerId: 42, button: 0, isPrimary: true, clientX: origin.x, clientY: origin.y });
    fireEvent.pointerUp(minimap, { pointerId: 42, clientX: origin.x + 12, clientY: origin.y });
    expect(onCameraRequest).toHaveBeenCalledTimes(2);
    const second = onCameraRequest.mock.calls[1]![0];
    expect(second.centerX).toBeCloseTo(camera.centerX + 24 / projection.scale, 12);
    expect(second.centerY).toBe(camera.centerY);
    expect(second.scale).toBe(1.75);
  });

  it("keeps an owned drag synchronized when the parent echoes a requested camera", () => {
    const raf = installAnimationFrameHarness();
    const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
    const { camera, canonical, layout, projection, rerender, viewport } = renderMinimap(onCameraRequest, 1.75);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedSvgRect(minimap);
    const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
    const capture = mockPointerCapture(hitTarget);
    const origin = graphToMinimap({ x: camera.centerX, y: camera.centerY }, projection);

    fireEvent.pointerDown(hitTarget, { pointerId: 43, button: 0, isPrimary: true, clientX: origin.x, clientY: origin.y });
    fireEvent.pointerMove(minimap, { pointerId: 43, clientX: origin.x + 12, clientY: origin.y });
    raf.flush();
    const echoed = onCameraRequest.mock.calls[0]![0];
    rerender(
      <HistoryMinimap
        layout={layout}
        camera={echoed}
        viewport={viewport}
        navigationBounds={canonical.navigationBounds}
        onCameraRequest={onCameraRequest}
      />,
    );
    expect(capture.releasePointerCapture).not.toHaveBeenCalled();

    fireEvent.pointerMove(minimap, { pointerId: 43, clientX: origin.x + 24, clientY: origin.y });
    raf.flush();
    expect(onCameraRequest).toHaveBeenCalledTimes(2);
    expect(onCameraRequest.mock.calls[1]![0].centerX).toBeCloseTo(camera.centerX + 24 / projection.scale, 12);
    expect(onCameraRequest.mock.calls[1]![0].scale).toBe(1.75);
    fireEvent.pointerUp(minimap, { pointerId: 43, clientX: origin.x + 24, clientY: origin.y });
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(43);
  });

  it("treats delayed earlier-to-latest and latest-to-earlier props as authoritative after gesture end", () => {
    installAnimationFrameHarness();
    const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
    const { camera, canonical, layout, projection, rerender, viewport } = renderMinimap(onCameraRequest, 1.75);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedSvgRect(minimap);
    const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
    mockPointerCapture(hitTarget);
    const origin = graphToMinimap({ x: camera.centerX, y: camera.centerY }, projection);
    const renderCamera = (nextCamera: CameraPose) => rerender(
      <HistoryMinimap
        layout={layout}
        camera={nextCamera}
        viewport={viewport}
        navigationBounds={canonical.navigationBounds}
        onCameraRequest={onCameraRequest}
      />,
    );
    const dragBy = (pointerId: number, logicalDeltaX: number) => {
      fireEvent.pointerDown(hitTarget, {
        pointerId,
        button: 0,
        isPrimary: true,
        clientX: origin.x,
        clientY: origin.y,
      });
      fireEvent.pointerUp(minimap, {
        pointerId,
        clientX: origin.x + logicalDeltaX,
        clientY: origin.y,
      });
      return onCameraRequest.mock.calls.at(-1)![0];
    };

    const first = dragBy(81, 10);
    renderCamera(camera);
    const second = dragBy(82, 10);
    expect(second).toEqual(first);

    renderCamera(first);
    renderCamera(camera);
    const third = dragBy(83, 10);
    expect(third.centerX).toBeCloseTo(camera.centerX + 10 / projection.scale, 12);
    expect(third.centerY).toBe(first.centerY);
    expect(third.scale).toBe(first.scale);
  });

  it("cancels an active drag when an external update reuses a prior gesture request key", () => {
    const raf = installAnimationFrameHarness();
    const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
    const { camera, canonical, layout, projection, rerender, viewport } = renderMinimap(onCameraRequest, 1.75);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedSvgRect(minimap);
    const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
    const capture = mockPointerCapture(hitTarget);
    const origin = graphToMinimap({ x: camera.centerX, y: camera.centerY }, projection);
    const renderCamera = (nextCamera: CameraPose) => rerender(
      <HistoryMinimap
        layout={layout}
        camera={nextCamera}
        viewport={viewport}
        navigationBounds={canonical.navigationBounds}
        onCameraRequest={onCameraRequest}
      />,
    );

    fireEvent.pointerDown(hitTarget, { pointerId: 84, button: 0, isPrimary: true, clientX: origin.x, clientY: origin.y });
    fireEvent.pointerMove(minimap, { pointerId: 84, clientX: origin.x + 10, clientY: origin.y });
    raf.flush();
    const priorRequest = onCameraRequest.mock.calls[0]![0];
    fireEvent.pointerMove(minimap, { pointerId: 84, clientX: origin.x + 20, clientY: origin.y });
    raf.flush();
    fireEvent.pointerUp(minimap, { pointerId: 84, clientX: origin.x + 20, clientY: origin.y });

    fireEvent.pointerDown(hitTarget, { pointerId: 85, button: 0, isPrimary: true, clientX: origin.x, clientY: origin.y });
    fireEvent.pointerMove(minimap, { pointerId: 85, clientX: origin.x + 15, clientY: origin.y });
    raf.flush();
    expect(capture.releasePointerCapture).not.toHaveBeenCalledWith(85);

    renderCamera(priorRequest);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(85);
    fireEvent.pointerMove(minimap, { pointerId: 85, clientX: origin.x + 30, clientY: origin.y });
    fireEvent.pointerUp(minimap, { pointerId: 85, clientX: origin.x + 30, clientY: origin.y });
    expect(onCameraRequest).toHaveBeenCalledTimes(3);
  });

  it("does not retain authority for any historical request after a bounded sequence of completed gestures", () => {
    const raf = installAnimationFrameHarness();
    const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
    const { camera, canonical, layout, projection, rerender, viewport } = renderMinimap(onCameraRequest, 1.75);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedSvgRect(minimap);
    const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
    const capture = mockPointerCapture(hitTarget);
    const origin = graphToMinimap({ x: camera.centerX, y: camera.centerY }, projection);
    const renderCamera = (nextCamera: CameraPose) => rerender(
      <HistoryMinimap
        layout={layout}
        camera={nextCamera}
        viewport={viewport}
        navigationBounds={canonical.navigationBounds}
        onCameraRequest={onCameraRequest}
      />,
    );

    for (let index = 0; index < 6; index += 1) {
      fireEvent.pointerDown(hitTarget, {
        pointerId: 90 + index,
        button: 0,
        isPrimary: true,
        clientX: origin.x,
        clientY: origin.y,
      });
      fireEvent.pointerUp(minimap, {
        pointerId: 90 + index,
        clientX: origin.x + 5,
        clientY: origin.y,
      });
    }
    const historicalRequest = onCameraRequest.mock.calls[1]![0];

    fireEvent.pointerDown(hitTarget, { pointerId: 96, button: 0, isPrimary: true, clientX: origin.x, clientY: origin.y });
    fireEvent.pointerMove(minimap, { pointerId: 96, clientX: origin.x + 8, clientY: origin.y });
    raf.flush();
    expect(capture.releasePointerCapture).not.toHaveBeenCalledWith(96);

    renderCamera(historicalRequest);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(96);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCameraRequest).toHaveBeenCalledTimes(7);
    expect(onCameraRequest.mock.calls[5]![0].centerX).toBeCloseTo(
      camera.centerX + 30 / projection.scale,
      12,
    );
  });

  it("cancels on geometry reset so a later Escape cannot restore a stale camera", () => {
    const raf = installAnimationFrameHarness();
    const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
    const { camera, canonical, layout, rerender, viewport } = renderMinimap(onCameraRequest, 1.75);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedSvgRect(minimap);
    const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
    const capture = mockPointerCapture(hitTarget);

    fireEvent.pointerDown(hitTarget, { pointerId: 97, button: 0, isPrimary: true, clientX: 120, clientY: 72 });
    fireEvent.pointerMove(minimap, { pointerId: 97, clientX: 140, clientY: 72 });
    raf.flush();
    expect(onCameraRequest).toHaveBeenCalledOnce();
    const changedLayout = {
      ...layout,
      nodes: layout.nodes.map((node, index) => index === 0 ? { ...node, x: node.x + 1 } : node),
    };
    rerender(
      <HistoryMinimap
        layout={changedLayout}
        camera={camera}
        viewport={viewport}
        navigationBounds={canonical.navigationBounds}
        onCameraRequest={onCameraRequest}
      />,
    );
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(97);

    fireEvent.keyDown(window, { key: "Escape" });
    raf.flush();
    expect(onCameraRequest).toHaveBeenCalledOnce();
  });

  it.each([
    { name: "wide", rect: { left: 30, top: 40, width: 480, height: 144 } },
    { name: "tall", rect: { left: -20, top: 70, width: 240, height: 300 } },
    { name: "offset same-aspect", rect: { left: 125, top: -35, width: 480, height: 288 } },
  ])("converts $name CSS drag deltas through the fitted SVG scale", ({ rect }) => {
    installAnimationFrameHarness();
    const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
    const { camera, projection } = renderMinimap(onCameraRequest, 1.75);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedSvgRect(minimap, rect);
    const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
    mockPointerCapture(hitTarget);
    const cssScale = Math.min(rect.width / 240, rect.height / 144);
    const renderedLeft = rect.left + (rect.width - 240 * cssScale) / 2;
    const renderedTop = rect.top + (rect.height - 144 * cssScale) / 2;
    const logicalOrigin = graphToMinimap({ x: camera.centerX, y: camera.centerY }, projection);
    const origin = {
      x: renderedLeft + logicalOrigin.x * cssScale,
      y: renderedTop + logicalOrigin.y * cssScale,
    };

    fireEvent.pointerDown(hitTarget, { pointerId: 44, button: 0, isPrimary: true, clientX: origin.x, clientY: origin.y });
    fireEvent.pointerUp(minimap, {
      pointerId: 44,
      clientX: origin.x + 12 * cssScale,
      clientY: origin.y - 6 * cssScale,
    });

    expect(onCameraRequest).toHaveBeenCalledTimes(1);
    expect(onCameraRequest.mock.calls[0]![0].centerX).toBeCloseTo(camera.centerX + 12 / projection.scale, 12);
    expect(onCameraRequest.mock.calls[0]![0].centerY).toBeCloseTo(camera.centerY - 6 / projection.scale, 12);
    expect(onCameraRequest.mock.calls[0]![0].scale).toBe(1.75);
  });

  it.each(["camera", "navigation", "viewport", "layout"] as const)(
    "cancels owned resources without stale restore when external %s changes",
    (change) => {
      const raf = installAnimationFrameHarness();
      const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
      const { camera, canonical, layout, rerender, viewport } = renderMinimap(onCameraRequest, 1.75);
      const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
      fixedSvgRect(minimap);
      const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
      const capture = mockPointerCapture(hitTarget);

      fireEvent.pointerDown(hitTarget, { pointerId: 45, button: 0, isPrimary: true, clientX: 120, clientY: 72 });
      fireEvent.pointerMove(minimap, { pointerId: 45, clientX: 140, clientY: 72 });
      expect(raf.pendingCount()).toBe(1);

      const nextCamera = change === "camera" ? { ...camera, centerX: camera.centerX + 1 } : camera;
      const nextBounds = change === "navigation"
        ? {
            left: canonical.navigationBounds.left - 10,
            top: canonical.navigationBounds.top - 10,
            right: canonical.navigationBounds.right + 10,
            bottom: canonical.navigationBounds.bottom + 10,
          }
        : canonical.navigationBounds;
      const nextViewport = change === "viewport"
        ? { width: viewport.width + 20, height: viewport.height + 10 }
        : viewport;
      const nextLayout = change === "layout"
        ? {
            ...layout,
            nodes: layout.nodes.map((node, index) => index === 0 ? { ...node, x: node.x + 1 } : node),
          }
        : layout;
      rerender(
        <HistoryMinimap
          layout={nextLayout}
          camera={nextCamera}
          viewport={nextViewport}
          navigationBounds={nextBounds}
          onCameraRequest={onCameraRequest}
        />,
      );

      expect(raf.pendingCount()).toBe(0);
      expect(capture.releasePointerCapture).toHaveBeenCalledWith(45);
      expect(onCameraRequest).not.toHaveBeenCalled();
      raf.flush();
      expect(onCameraRequest).not.toHaveBeenCalled();
    },
  );

  it("preserves an owned gesture across equivalent theme, detail, text, and status rerenders", () => {
    const raf = installAnimationFrameHarness();
    const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
    const { camera, canonical, layout, rerender, viewport } = renderMinimap(onCameraRequest, 1.75);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedSvgRect(minimap);
    const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
    const capture = mockPointerCapture(hitTarget);
    const presentationLayout = {
      ...layout,
      nodes: layout.nodes.map((node, index) => index === 0
        ? {
            ...node,
            visibleTitle: "Presentation-only minimap detail",
            fullTitle: "Presentation-only minimap detail",
            status: node.status === "accepted" ? "informational" as const : node.status,
          }
        : node),
    };

    fireEvent.pointerDown(hitTarget, { pointerId: 46, button: 0, isPrimary: true, clientX: 120, clientY: 72 });
    fireEvent.pointerMove(minimap, { pointerId: 46, clientX: 140, clientY: 72 });
    expect(raf.pendingCount()).toBe(1);
    document.documentElement.dataset.theme = "dark";
    rerender(
      <HistoryMinimap
        layout={presentationLayout}
        camera={camera}
        viewport={viewport}
        navigationBounds={canonical.navigationBounds}
        onCameraRequest={onCameraRequest}
      />,
    );

    expect(raf.pendingCount()).toBe(1);
    expect(capture.releasePointerCapture).not.toHaveBeenCalled();
    raf.flush();
    expect(onCameraRequest).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(minimap, { pointerId: 46, clientX: 140, clientY: 72 });
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(46);
  });

  it("filters foreign pointer IDs and ignores nonprimary, modified, and outside-target starts", () => {
    const raf = installAnimationFrameHarness();
    const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
    const { projection } = renderMinimap(onCameraRequest);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedSvgRect(minimap);
    const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
    const capture = mockPointerCapture(hitTarget);
    const origin = { x: projection.plotBounds.x + 40, y: projection.plotBounds.y + 40 };

    fireEvent.pointerDown(minimap, { pointerId: 50, button: 0, isPrimary: true, clientX: origin.x, clientY: origin.y });
    const ignoredStarts = [
      { pointerId: 51, button: 1, isPrimary: true },
      { pointerId: 52, button: 0, isPrimary: true, altKey: true },
      { pointerId: 53, button: 0, isPrimary: true, ctrlKey: true },
      { pointerId: 54, button: 0, isPrimary: true, metaKey: true },
      { pointerId: 55, button: 0, isPrimary: true, shiftKey: true },
      { pointerId: 56, button: 0, isPrimary: false },
    ];
    for (const ignored of ignoredStarts) {
      fireEvent.pointerDown(hitTarget, { ...ignored, clientX: origin.x, clientY: origin.y });
    }
    expect(capture.setPointerCapture).not.toHaveBeenCalled();

    fireEvent.pointerDown(hitTarget, { pointerId: 57, button: 0, isPrimary: true, clientX: origin.x, clientY: origin.y });
    expect(capture.setPointerCapture).toHaveBeenCalledWith(57);
    fireEvent.pointerMove(minimap, { pointerId: 58, clientX: origin.x + 20, clientY: origin.y });
    fireEvent.pointerUp(minimap, { pointerId: 58, clientX: origin.x + 20, clientY: origin.y });
    expect(raf.pendingCount()).toBe(0);
    expect(onCameraRequest).not.toHaveBeenCalled();
    fireEvent.pointerCancel(minimap, { pointerId: 57 });
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(57);
  });

  it.each(["pointercancel", "Escape", "lostpointercapture"] as const)(
    "restores the exact starting camera after %s and leaves no stale frame",
    (cancellation) => {
      const raf = installAnimationFrameHarness();
      const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
      const { camera, projection } = renderMinimap(onCameraRequest, 1.75);
      const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
      fixedSvgRect(minimap);
      const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
      const capture = mockPointerCapture(hitTarget);
      const origin = graphToMinimap({ x: camera.centerX, y: camera.centerY }, projection);

      fireEvent.pointerDown(hitTarget, { pointerId: 60, button: 0, isPrimary: true, clientX: origin.x, clientY: origin.y });
      fireEvent.pointerMove(minimap, { pointerId: 60, clientX: origin.x + 20, clientY: origin.y + 10 });
      raf.flush();
      expect(onCameraRequest).toHaveBeenCalledTimes(1);
      expect(onCameraRequest.mock.calls[0]![0]).not.toEqual(camera);

      fireEvent.pointerMove(minimap, { pointerId: 60, clientX: origin.x + 30, clientY: origin.y + 15 });
      expect(raf.pendingCount()).toBe(1);
      if (cancellation === "pointercancel") {
        fireEvent.pointerCancel(minimap, { pointerId: 60 });
      } else if (cancellation === "Escape") {
        fireEvent.keyDown(window, { key: "Escape" });
      } else {
        fireEvent.lostPointerCapture(minimap, { pointerId: 60 });
      }

      expect(onCameraRequest).toHaveBeenCalledTimes(2);
      expect(onCameraRequest.mock.calls[1]![0]).toEqual(camera);
      expect(raf.pendingCount()).toBe(0);
      expect(capture.releasePointerCapture).toHaveBeenCalledWith(60);
      raf.flush();
      expect(onCameraRequest).toHaveBeenCalledTimes(2);
    },
  );

  it("cleans capture, key listener, and pending RAF on unmount without stale callbacks", () => {
    const raf = installAnimationFrameHarness();
    const addListener = vi.spyOn(window, "addEventListener");
    const removeListener = vi.spyOn(window, "removeEventListener");
    const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
    const { projection, unmount } = renderMinimap(onCameraRequest);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedSvgRect(minimap);
    const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
    const capture = mockPointerCapture(hitTarget);
    const origin = { x: projection.plotBounds.x + 40, y: projection.plotBounds.y + 40 };

    fireEvent.pointerDown(hitTarget, { pointerId: 70, button: 0, isPrimary: true, clientX: origin.x, clientY: origin.y });
    fireEvent.pointerMove(minimap, { pointerId: 70, clientX: origin.x + 20, clientY: origin.y });
    expect(raf.pendingCount()).toBe(1);
    const keyListener = addListener.mock.calls.find(([type]) => type === "keydown")?.[1];
    expect(keyListener).toBeDefined();

    unmount();

    expect(raf.pendingCount()).toBe(0);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(70);
    expect(removeListener).toHaveBeenCalledWith("keydown", keyListener);
    raf.flush();
    expect(onCameraRequest).not.toHaveBeenCalled();
  });

  it("cancels owned interaction in layout phase when the parent reset primitive changes", () => {
    const raf = installAnimationFrameHarness();
    const addListener = vi.spyOn(window, "addEventListener");
    const removeListener = vi.spyOn(window, "removeEventListener");
    const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
    const layout = canonicalHistoryLayout();
    const viewport = { width: 800, height: 500 };
    const canonical = canonicalCamera(layout, viewport);
    const rendered = render(
      <HistoryMinimap
        layout={layout}
        camera={canonical.pose}
        viewport={viewport}
        navigationBounds={canonical.navigationBounds}
        interactionResetKey={0}
        onCameraRequest={onCameraRequest}
      />,
    );
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedSvgRect(minimap);
    const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
    const capture = mockPointerCapture(hitTarget);
    const origin = {
      x: Number(hitTarget.getAttribute("x")) + Number(hitTarget.getAttribute("width")) / 2,
      y: Number(hitTarget.getAttribute("y")) + Number(hitTarget.getAttribute("height")) / 2,
    };

    fireEvent.pointerDown(hitTarget, {
      pointerId: 71,
      button: 0,
      isPrimary: true,
      clientX: origin.x,
      clientY: origin.y,
    });
    fireEvent.pointerMove(minimap, {
      pointerId: 71,
      clientX: origin.x + 20,
      clientY: origin.y,
    });
    expect(raf.pendingCount()).toBe(1);
    const keyListener = addListener.mock.calls.find(([type]) => type === "keydown")?.[1];
    expect(keyListener).toBeDefined();

    rendered.rerender(
      <HistoryMinimap
        layout={layout}
        camera={canonical.pose}
        viewport={viewport}
        navigationBounds={canonical.navigationBounds}
        interactionResetKey={1}
        onCameraRequest={onCameraRequest}
      />,
    );

    expect(raf.pendingCount()).toBe(0);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(71);
    expect(removeListener).toHaveBeenCalledWith("keydown", keyListener);
    expect(onCameraRequest).not.toHaveBeenCalled();
    fireEvent.pointerMove(minimap, { pointerId: 71, clientX: origin.x + 40, clientY: origin.y });
    fireEvent.keyDown(window, { key: "Escape" });
    raf.flush();
    expect(onCameraRequest).not.toHaveBeenCalled();
  });

  it("keeps a sub-24 logical viewport rectangle targetable through the separate hit target", () => {
    installAnimationFrameHarness();
    const onCameraRequest = vi.fn<(camera: CameraPose) => void>();
    renderMinimap(onCameraRequest, 4);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedSvgRect(minimap);
    const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
    const capture = mockPointerCapture(hitTarget);
    const width = Number(hitTarget.getAttribute("width"));
    const height = Number(hitTarget.getAttribute("height"));

    expect(Math.min(width, height)).toBeLessThan(24);
    expect(hitTarget).toHaveAttribute("stroke-width", "24");
    fireEvent.pointerDown(hitTarget, {
      pointerId: 80,
      button: 0,
      isPrimary: true,
      clientX: Number(hitTarget.getAttribute("x")) + width / 2,
      clientY: Number(hitTarget.getAttribute("y")) + height / 2,
    });
    expect(capture.setPointerCapture).toHaveBeenCalledWith(80);
    fireEvent.pointerCancel(minimap, { pointerId: 80 });
  });
});
