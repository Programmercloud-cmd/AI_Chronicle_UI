// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import axe from "axe-core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense, startTransition, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

import { layoutTimeline, type TimelineLayout } from "../../../src/timeline";
import {
  HISTORY_SELECTION_PADDING,
  HISTORY_SELECTION_THRESHOLD,
  HISTORY_WHEEL_LINE_PIXELS,
  HistoryView,
  fitHistoryCameraToScreenSelection,
  normalizeHistoryWheelDelta,
  normalizeHistoryScreenSelection,
  panHistoryCameraByScreenDelta,
  transitionHistoryCameraForResize,
  transitionHistoryCameraPreservingPose,
  zoomHistoryCameraAtScreenPoint,
  type HistoryCamera,
  type HistoryViewProps,
} from "../../../src/web/history/history-view";
import {
  captureHistoryFullscreenSession,
  historyFullscreenFramingFactor,
  transitionHistoryCameraForFullscreen,
} from "../../../src/web/history/history-fullscreen-camera";
import {
  HistoryCameraSessionProvider,
  useHistoryCameraSession,
  type HistoryCameraSnapshot,
} from "../../../src/web/history/history-camera-session";
import {
  canonicalCamera,
  cameraResetKey,
} from "../../../src/web/history/history-content-bounds";
import {
  createMinimapProjection,
  graphToMinimap,
  minimapPointToCamera,
  minimapViewportRect,
} from "../../../src/web/history/minimap-math";
import {
  clampCamera,
  graphToScreen,
  screenToGraph,
  visibleGraphRect,
  type GraphPoint,
  type ViewportSize,
} from "../../../src/web/history/viewport-math";
import { canonicalHistoryInput, canonicalHistoryLayout } from "./fixtures";

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];

  readonly observe = vi.fn((target: Element) => {
    this.target = target;
  });
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();
  private target?: Element;

  constructor(private readonly callback: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this);
  }

  emit(width: number, height: number): void {
    if (this.target === undefined) throw new Error("ResizeObserver target is unavailable");
    const entry = {
      target: this.target,
      contentRect: { width, height },
    } as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
}

class MockPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly isPrimary: boolean;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.isPrimary = init.isPrimary ?? true;
  }
}

let animationFrameId = 0;
let animationFrames = new Map<number, FrameRequestCallback>();
let mockFullscreenElement: Element | null = null;
let mockFullscreenEnabled = true;
let requestFullscreenMock: ReturnType<typeof vi.fn>;
let exitFullscreenMock: ReturnType<typeof vi.fn>;

function dispatchFullscreenChange(element: Element | null): void {
  act(() => {
    mockFullscreenElement = element;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
}

function flushAnimationFrames(): void {
  const pending = [...animationFrames.values()];
  animationFrames.clear();
  act(() => {
    for (const callback of pending) callback(16.67);
  });
}

function installPointerCapture(surface: HTMLElement) {
  const captured = new Set<number>();
  const setPointerCapture = vi.fn((pointerId: number) => captured.add(pointerId));
  const releasePointerCapture = vi.fn((pointerId: number) => captured.delete(pointerId));
  const hasPointerCapture = vi.fn((pointerId: number) => captured.has(pointerId));
  Object.defineProperties(surface, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
    hasPointerCapture: { configurable: true, value: hasPointerCapture },
  });
  return {
    setPointerCapture,
    releasePointerCapture,
    hasPointerCapture,
    lose(pointerId: number) {
      captured.delete(pointerId);
    },
  };
}

function viewBoxCameraCenter(container: HTMLElement): { x: number; y: number; width: number; height: number } {
  const value = container.querySelector("svg")?.getAttribute("viewBox");
  if (value === undefined || value === null) throw new Error("History viewBox is unavailable");
  const [left, top, width, height] = value.split(" ").map(Number);
  if (left === undefined || top === undefined || width === undefined || height === undefined) {
    throw new Error(`invalid History viewBox: ${value}`);
  }
  return { x: left + width / 2, y: top + height / 2, width, height };
}

const DEFAULT_VIEWPORT = { width: 900, height: 560 };

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="history-location">{location.pathname}{location.hash}</div>;
}

function historyUi(
  layout: TimelineLayout,
  props: Omit<HistoryViewProps, "layout"> = {},
) {
  return (
    <MemoryRouter>
      <main tabIndex={-1} data-testid="app-main">
        <HistoryView layout={layout} {...props} />
      </main>
      <LocationProbe />
    </MemoryRouter>
  );
}

function renderHistory(
  layout = canonicalHistoryLayout(),
  props: Omit<HistoryViewProps, "layout"> = {},
) {
  return render(historyUi(layout, props));
}

function SessionBoundHistory({ layout, visible }: { layout: TimelineLayout; visible: boolean }) {
  const session = useHistoryCameraSession();
  if (!visible) return null;
  const resetKey = cameraResetKey(layout);
  return (
    <HistoryView
      layout={layout}
      restoredCameraSnapshot={session.read(resetKey)}
      onCameraCommit={session.commit}
    />
  );
}

function historySessionUi(layout: TimelineLayout, visible: boolean) {
  return (
    <MemoryRouter>
      <HistoryCameraSessionProvider>
        <main tabIndex={-1} data-testid="session-main">
          <SessionBoundHistory layout={layout} visible={visible} />
        </main>
      </HistoryCameraSessionProvider>
    </MemoryRouter>
  );
}

function latestObserver(): MockResizeObserver {
  const observer = MockResizeObserver.instances.at(-1);
  if (observer === undefined) throw new Error("History did not create a ResizeObserver");
  return observer;
}

function measure(viewport: ViewportSize = DEFAULT_VIEWPORT): void {
  act(() => latestObserver().emit(viewport.width, viewport.height));
}

function expectedCanonicalViewBox(layout: TimelineLayout, viewport: ViewportSize): string {
  const canonical = canonicalCamera(layout, viewport);
  const visible = visibleGraphRect(canonical.pose, viewport);
  return `${visible.left} ${visible.top} ${visible.right - visible.left} ${visible.bottom - visible.top}`;
}

function historyCameraViewBox(camera: HistoryCamera): string {
  const visible = visibleGraphRect(camera, {
    width: camera.viewportWidth,
    height: camera.viewportHeight,
  });
  return `${visible.left} ${visible.top} ${visible.right - visible.left} ${visible.bottom - visible.top}`;
}

function historyCameraFromRenderedViewBox(container: HTMLElement, viewport: ViewportSize): HistoryCamera {
  const box = viewBoxCameraCenter(container);
  return {
    centerX: box.x,
    centerY: box.y,
    scale: viewport.width / box.width,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    mode: "manual",
  };
}

function dispatchNativeWheel(
  surface: HTMLElement,
  init: WheelEventInit,
): WheelEvent {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  surface.dispatchEvent(event);
  return event;
}

function zoomHistoryIn(surface: HTMLElement, deltaY = -500): void {
  dispatchNativeWheel(surface, {
    deltaY,
    clientX: DEFAULT_VIEWPORT.width / 2,
    clientY: DEFAULT_VIEWPORT.height / 2,
  });
  flushAnimationFrames();
}

function fixedSurfaceRect(
  surface: HTMLElement,
  rect: { left?: number; top?: number; width?: number; height?: number } = {},
): DOMRect {
  const left = rect.left ?? 0;
  const top = rect.top ?? 0;
  const width = rect.width ?? DEFAULT_VIEWPORT.width;
  const height = rect.height ?? DEFAULT_VIEWPORT.height;
  const value = {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => undefined,
  } as DOMRect;
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(value);
  return value;
}

function fixedMinimapRect(minimap: SVGSVGElement, width = 240, height = 144): void {
  vi.spyOn(minimap, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => undefined,
  });
}

function expectIntegratedMinimapRect(
  minimap: SVGSVGElement,
  camera: HistoryCamera,
  navigationBounds: ReturnType<typeof canonicalCamera>["navigationBounds"],
): void {
  const expected = minimapViewportRect(
    camera,
    { width: camera.viewportWidth, height: camera.viewportHeight },
    createMinimapProjection(navigationBounds),
  );
  const outline = minimap.querySelector("[data-minimap-viewport='outline']");
  expect(Number(outline?.getAttribute("x"))).toBeCloseTo(expected.x, 10);
  expect(Number(outline?.getAttribute("y"))).toBeCloseTo(expected.y, 10);
  expect(Number(outline?.getAttribute("width"))).toBeCloseTo(expected.width, 10);
  expect(Number(outline?.getAttribute("height"))).toBeCloseTo(expected.height, 10);
}

function currentlessLayout(): TimelineLayout {
  const layout = canonicalHistoryLayout();
  return {
    ...layout,
    nodes: layout.nodes.map((node) => node.treatment === "current"
      ? {
          ...node,
          treatment: "historical" as const,
          currentState: undefined,
          calloutLabel: undefined,
        }
      : node),
    navigation: { ...layout.navigation, currentX: undefined },
  };
}

const NEVER_RESOLVING_RENDER = new Promise<void>(() => undefined);
let setInterruptedHistoryState: ((state: { layout: TimelineLayout; suspend: boolean }) => void) | undefined;

function InterruptAfterHistory({ active }: { active: boolean }) {
  if (active) throw NEVER_RESOLVING_RENDER;
  return null;
}

function InterruptedHistoryHarness({ initialLayout }: { initialLayout: TimelineLayout }) {
  const [state, setState] = useState({ layout: initialLayout, suspend: false });
  setInterruptedHistoryState = setState;
  return (
    <MemoryRouter>
      <main tabIndex={-1} data-testid="interrupted-main">
        <Suspense fallback={<div data-testid="interrupted-fallback">Loading</div>}>
          <HistoryView layout={state.layout} />
          <InterruptAfterHistory active={state.suspend} />
        </Suspense>
      </main>
    </MemoryRouter>
  );
}

describe("History view camera lifecycle", () => {
  beforeEach(() => {
    MockResizeObserver.instances = [];
    animationFrameId = 0;
    animationFrames = new Map();
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("PointerEvent", MockPointerEvent);
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      animationFrameId += 1;
      animationFrames.set(animationFrameId, callback);
      return animationFrameId;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => {
      animationFrames.delete(id);
    }));
    mockFullscreenElement = null;
    mockFullscreenEnabled = true;
    requestFullscreenMock = vi.fn(() => Promise.resolve());
    exitFullscreenMock = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => mockFullscreenElement,
    });
    Object.defineProperty(document, "fullscreenEnabled", {
      configurable: true,
      get: () => mockFullscreenEnabled,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreenMock,
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreenMock,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as Partial<HTMLElement>).requestFullscreen;
    document.documentElement.removeAttribute("data-theme");
  });

  it("waits for a finite usable measurement, then renders the exact canonical viewBox at physical viewport size", () => {
    const layout = canonicalHistoryLayout();
    const { container } = renderHistory(layout);
    const main = screen.getByTestId("app-main");
    main.focus();

    expect(container.querySelector(".history-canvas")).not.toBeInTheDocument();
    for (const invalid of [
      { width: -1, height: 560 },
      { width: 0, height: 560 },
      { width: 47.999, height: 560 },
      { width: 48, height: 560 },
      { width: Number.NaN, height: 560 },
      { width: Number.POSITIVE_INFINITY, height: 560 },
      { width: 900, height: -1 },
      { width: 900, height: 0 },
      { width: 900, height: 47.999 },
      { width: 900, height: 48 },
      { width: 900, height: Number.NaN },
      { width: 900, height: Number.POSITIVE_INFINITY },
    ]) {
      act(() => latestObserver().emit(invalid.width, invalid.height));
      expect(container.querySelector(".history-canvas")).not.toBeInTheDocument();
    }

    measure();

    const canvas = container.querySelector("svg");
    expect(canvas).toHaveAttribute("width", "100%");
    expect(canvas).toHaveAttribute("height", "100%");
    expect(canvas).toHaveAttribute("viewBox", expectedCanonicalViewBox(layout, DEFAULT_VIEWPORT));
    expect(screen.getByLabelText("Navigable project history timeline")).not.toHaveFocus();
    expect(main).toHaveFocus();
  });

  it("renders the accepted topology and shared authored coordinates after camera initialization", () => {
    const layout = canonicalHistoryLayout();
    const { container } = renderHistory(layout);
    measure();

    expect(screen.getByRole("heading", { name: "History" })).toBeVisible();
    expect(container.querySelectorAll(".history-node")).toHaveLength(11);
    expect(container.querySelectorAll(".history-canvas .history-edge-branch-origin")).toHaveLength(1);
    expect(container.querySelector("[data-node-id='TIM-004']")).toHaveClass("history-node-current");
    expect(container.querySelectorAll(".history-node-planned-dated")).toHaveLength(3);
    expect(container.querySelector(".history-edge-projection")).toBeInTheDocument();
    expect(container.querySelectorAll(".history-months > g")).toHaveLength(3);
    expect(screen.getByText("2026-05-05 · 14:30:52")).toBeInTheDocument();
    expect(screen.getByText("CURRENT STATE")).toBeInTheDocument();
    expect(screen.getByText("Stable implementation accepted")).toBeInTheDocument();
  });

  it("renders exactly one compact control hint and shares it through surface and SVG descriptions", () => {
    const { container } = renderHistory();
    measure();
    const hint = container.querySelector("#history-navigation-hint");
    const surface = screen.getByLabelText("Navigable project history timeline");
    const canvas = container.querySelector(".history-canvas");

    expect(hint).toHaveTextContent(/Drag: pan/u);
    expect(hint).toHaveTextContent(/Wheel: zoom/u);
    expect(hint).toHaveTextContent(/Ctrl\+drag: zoom area/u);
    expect(hint).toHaveTextContent(/F: fit current/u);
    expect(hint).toHaveTextContent(/Shift\+F: fullscreen/u);
    expect(hint).not.toHaveTextContent(/Arrow/u);
    expect(container.querySelectorAll("#history-navigation-hint")).toHaveLength(1);
    expect([...hint?.querySelectorAll("kbd") ?? []].map((key) => key.textContent)).toEqual([
      "Ctrl",
      "F",
      "Shift",
      "F",
    ]);
    expect(hint?.querySelector("br")).not.toBeInTheDocument();
    expect(container.querySelector(".history-description")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("Chronology runs left to right. Lines show development ancestry.");
    expect(container).not.toHaveTextContent("Calendar months are aligned; dense periods expand for readability.");
    expect(container).not.toHaveTextContent("Focus or hover a milestone for its exact record details.");
    expect(container.querySelector(".history-detail-surface")).not.toBeInTheDocument();
    expect(surface).toHaveAttribute("aria-describedby", "history-navigation-hint");
    expect(canvas).toHaveAttribute("aria-labelledby", "history-graph-title");
    expect(canvas).toHaveAttribute(
      "aria-describedby",
      "history-graph-description history-navigation-hint",
    );
    expect(container.querySelector("#history-graph-description")).not.toHaveTextContent(/Drag:|Wheel:|Ctrl\+drag|fit current/iu);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Enter fullscreen (Shift+F)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(/\b\d+%\b/u);
  });

  it("integrates the required complete minimap with an exact synchronized viewport rectangle", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    const constraints = canonicalCamera(layout, DEFAULT_VIEWPORT);
    const camera: HistoryCamera = {
      ...constraints.pose,
      viewportWidth: DEFAULT_VIEWPORT.width,
      viewportHeight: DEFAULT_VIEWPORT.height,
      mode: "canonical",
    };

    expect(minimap.querySelectorAll(".history-minimap-edge")).toHaveLength(layout.edges.length);
    expect(minimap.querySelectorAll(".history-minimap-node")).toHaveLength(layout.nodes.length);
    expect(minimap.querySelector("[data-current-marker='outer-ring']")).toBeInTheDocument();
    expect(minimap.querySelector("[data-current-marker='inner-ring']")).toBeInTheDocument();
    expect(minimap.querySelector("[data-current-marker='diamond']")).toBeInTheDocument();
    const shell = view.container.querySelector(".history-minimap-shell");
    expect(shell).toHaveAttribute("data-history-control");
    expect(shell).toHaveStyle({ overflow: "visible" });
    expect(minimap).toHaveAttribute("overflow", "visible");
    expect(minimap.querySelector("[data-minimap-viewport='hit-target']")).toHaveAttribute("stroke-width", "24");
    expect(minimap.querySelector("[data-minimap-viewport='hit-target']")).toHaveAttribute("vector-effect", "non-scaling-stroke");
    expectIntegratedMinimapRect(minimap, camera, constraints.navigationBounds);
  });

  it("serializes minimap click and drag into the main manual camera without main pointer capture", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const mainCapture = installPointerCapture(surface);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedMinimapRect(minimap);
    zoomHistoryIn(surface);
    const constraints = canonicalCamera(layout, DEFAULT_VIEWPORT);
    const projection = createMinimapProjection(constraints.navigationBounds);
    const canonicalHistoryCamera: HistoryCamera = {
      ...constraints.pose,
      viewportWidth: DEFAULT_VIEWPORT.width,
      viewportHeight: DEFAULT_VIEWPORT.height,
      mode: "canonical",
    };

    fireEvent.pointerDown(minimap, {
      pointerId: 130,
      button: 0,
      isPrimary: true,
      clientX: projection.plotBounds.x + 12,
      clientY: projection.plotBounds.y + 12,
    });
    fireEvent.pointerUp(minimap, {
      pointerId: 130,
      clientX: projection.plotBounds.x + 12,
      clientY: projection.plotBounds.y + 12,
    });
    expect(mainCapture.setPointerCapture).not.toHaveBeenCalled();

    for (const target of [
      { x: constraints.navigationBounds.left, y: constraints.navigationBounds.top },
      { x: constraints.navigationBounds.right, y: constraints.navigationBounds.top },
      { x: constraints.navigationBounds.left, y: constraints.navigationBounds.bottom },
      { x: constraints.navigationBounds.right, y: constraints.navigationBounds.bottom },
    ]) {
      const logical = graphToMinimap(target, projection);
      const before = historyCameraFromRenderedViewBox(view.container, DEFAULT_VIEWPORT);
      const beforeVisible = viewBoxCameraCenter(view.container);
      const expected = minimapPointToCamera(
        logical,
        projection,
        before,
        DEFAULT_VIEWPORT,
        constraints.navigationBounds,
      );
      if (expected === undefined) throw new Error("valid minimap corner was rejected");
      fireEvent.click(minimap, { button: 0, clientX: logical.x, clientY: logical.y });
      const actual = historyCameraFromRenderedViewBox(view.container, DEFAULT_VIEWPORT);
      expect(actual.centerX).toBeCloseTo(expected.centerX, 10);
      expect(actual.centerY).toBeCloseTo(expected.centerY, 10);
      const actualVisible = viewBoxCameraCenter(view.container);
      expect(actualVisible.width).toBeCloseTo(beforeVisible.width, 12);
      expect(actualVisible.height).toBeCloseTo(beforeVisible.height, 12);
      expectIntegratedMinimapRect(minimap, actual, constraints.navigationBounds);
    }

    const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
    const minimapCapture = installPointerCapture(hitTarget as unknown as HTMLElement);
    const beforeDrag = historyCameraFromRenderedViewBox(view.container, DEFAULT_VIEWPORT);
    const beforeDragVisible = viewBoxCameraCenter(view.container);
    const origin = {
      x: Number(hitTarget.getAttribute("x")) + Number(hitTarget.getAttribute("width")) / 2,
      y: Number(hitTarget.getAttribute("y")) + Number(hitTarget.getAttribute("height")) / 2,
    };
    fireEvent.pointerDown(hitTarget, {
      pointerId: 131,
      button: 0,
      isPrimary: true,
      clientX: origin.x,
      clientY: origin.y,
    });
    fireEvent.pointerUp(minimap, {
      pointerId: 131,
      clientX: origin.x - 20,
      clientY: origin.y - 10,
    });
    const afterDrag = historyCameraFromRenderedViewBox(view.container, DEFAULT_VIEWPORT);
    const afterDragVisible = viewBoxCameraCenter(view.container);
    expect(afterDragVisible.width).toBeCloseTo(beforeDragVisible.width, 12);
    expect(afterDragVisible.height).toBeCloseTo(beforeDragVisible.height, 12);
    expect(afterDrag.centerX).not.toBeCloseTo(beforeDrag.centerX, 8);
    expect(minimapCapture.releasePointerCapture).toHaveBeenCalledWith(131);
    expect(mainCapture.setPointerCapture).not.toHaveBeenCalled();
    expectIntegratedMinimapRect(minimap, afterDrag, constraints.navigationBounds);
  });

  it("preserves minimap identity and active drag across harmless rerenders, then follows manual resize and recovery", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const mainCapture = installPointerCapture(surface);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedMinimapRect(minimap);
    const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
    const minimapCapture = installPointerCapture(hitTarget as unknown as HTMLElement);
    const originalNode = minimap.querySelector(".history-minimap-node");
    const originalViewBox = view.container.querySelector(".history-canvas")?.getAttribute("viewBox");
    const origin = {
      x: Number(hitTarget.getAttribute("x")) + Number(hitTarget.getAttribute("width")) / 2,
      y: Number(hitTarget.getAttribute("y")) + Number(hitTarget.getAttribute("height")) / 2,
    };

    fireEvent.pointerDown(hitTarget, {
      pointerId: 132,
      button: 0,
      isPrimary: true,
      clientX: origin.x,
      clientY: origin.y,
    });
    fireEvent.pointerMove(minimap, {
      pointerId: 132,
      clientX: origin.x + 18,
      clientY: origin.y,
    });
    expect(animationFrames.size).toBe(1);

    const equivalent = structuredClone(layout);
    document.documentElement.dataset.theme = "dark";
    view.rerender(historyUi(equivalent));
    fireEvent.focus(screen.getByRole("link", { name: /CORE-003/u }));
    expect(screen.getByTestId("history-minimap")).toBe(minimap);
    expect(minimap.querySelector(".history-minimap-node")).toBe(originalNode);
    expect(minimapCapture.releasePointerCapture).not.toHaveBeenCalledWith(132);
    expect(view.container.querySelector(".history-canvas")).toHaveAttribute("viewBox", originalViewBox);

    flushAnimationFrames();
    fireEvent.pointerUp(minimap, {
      pointerId: 132,
      clientX: origin.x + 24,
      clientY: origin.y,
    });
    expect(minimapCapture.releasePointerCapture).toHaveBeenCalledWith(132);
    expect(mainCapture.setPointerCapture).not.toHaveBeenCalled();
    const manual = historyCameraFromRenderedViewBox(view.container, DEFAULT_VIEWPORT);

    const resized = { width: 1_080, height: 640 };
    const expectedResized = transitionHistoryCameraForResize(manual, equivalent, resized);
    measure(resized);
    const actualResized = historyCameraFromRenderedViewBox(view.container, resized);
    expect(actualResized.centerX).toBeCloseTo(expectedResized.centerX, 10);
    expect(actualResized.centerY).toBeCloseTo(expectedResized.centerY, 10);
    expect(actualResized.scale).toBeCloseTo(expectedResized.scale, 10);
    const resizedBounds = canonicalCamera(equivalent, resized).navigationBounds;
    expectIntegratedMinimapRect(minimap, actualResized, resizedBounds);

    const milestone = screen.getByRole("link", { name: /CORE-003/u });
    milestone.focus();
    expect(fireEvent.keyDown(milestone, { key: "f" })).toBe(false);
    expect(milestone).toHaveFocus();
    expect(view.container.querySelector(".history-canvas")).toHaveAttribute(
      "viewBox",
      expectedCanonicalViewBox(equivalent, resized),
    );
    const recovered: HistoryCamera = {
      ...canonicalCamera(equivalent, resized).pose,
      viewportWidth: resized.width,
      viewportHeight: resized.height,
      mode: "canonical",
    };
    expectIntegratedMinimapRect(minimap, recovered, resizedBounds);
    expect(screen.getByRole("status")).toHaveTextContent(/^History view fitted to current state$/u);
  });

  it.each([
    { trigger: "keyboard", emitBeforeFit: false },
    { trigger: "keyboard", emitBeforeFit: true },
    { trigger: "button", emitBeforeFit: false },
    { trigger: "button", emitBeforeFit: true },
  ])("cancels minimap ownership on $trigger Fit with emitted=$emitBeforeFit", ({ trigger, emitBeforeFit }) => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedMinimapRect(minimap);
    const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
    const capture = installPointerCapture(hitTarget as unknown as HTMLElement);
    const origin = {
      x: Number(hitTarget.getAttribute("x")) + Number(hitTarget.getAttribute("width")) / 2,
      y: Number(hitTarget.getAttribute("y")) + Number(hitTarget.getAttribute("height")) / 2,
    };

    fireEvent.pointerDown(hitTarget, {
      pointerId: 140,
      button: 0,
      isPrimary: true,
      clientX: origin.x,
      clientY: origin.y,
    });
    fireEvent.pointerMove(minimap, {
      pointerId: 140,
      clientX: origin.x + 18,
      clientY: origin.y,
    });
    expect(animationFrames.size).toBe(1);
    if (emitBeforeFit) {
      flushAnimationFrames();
      fireEvent.pointerMove(minimap, {
        pointerId: 140,
        clientX: origin.x + 24,
        clientY: origin.y,
      });
      expect(animationFrames.size).toBe(1);
    }

    if (trigger === "keyboard") {
      surface.focus();
      expect(fireEvent.keyDown(surface, { key: "f" })).toBe(false);
      expect(surface).toHaveFocus();
    } else {
      fireEvent.click(screen.getByRole("button", { name: "Fit current (F)" }));
      expect(surface).toHaveFocus();
    }

    expect(animationFrames.size).toBe(0);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(140);
    expect(view.container.querySelector(".history-canvas")).toHaveAttribute(
      "viewBox",
      expectedCanonicalViewBox(layout, DEFAULT_VIEWPORT),
    );
    expect(screen.getByRole("status")).toHaveTextContent(/^History view fitted to current state$/u);
    const canonical: HistoryCamera = {
      ...canonicalCamera(layout, DEFAULT_VIEWPORT).pose,
      viewportWidth: DEFAULT_VIEWPORT.width,
      viewportHeight: DEFAULT_VIEWPORT.height,
      mode: "canonical",
    };
    expectIntegratedMinimapRect(minimap, canonical, canonicalCamera(layout, DEFAULT_VIEWPORT).navigationBounds);

    fireEvent.pointerMove(minimap, { pointerId: 140, clientX: origin.x + 40, clientY: origin.y });
    fireEvent.pointerUp(minimap, { pointerId: 140, clientX: origin.x + 40, clientY: origin.y });
    fireEvent.keyDown(window, { key: "Escape" });
    flushAnimationFrames();
    expect(view.container.querySelector(".history-canvas")).toHaveAttribute(
      "viewBox",
      expectedCanonicalViewBox(layout, DEFAULT_VIEWPORT),
    );
  });

  it.each(["resize", "geometry", "current"] as const)(
    "cancels active minimap ownership when the committed $kind environment changes",
    (kind) => {
      const layout = canonicalHistoryLayout();
      const view = renderHistory(layout);
      measure();
      const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
      fixedMinimapRect(minimap);
      const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
      const capture = installPointerCapture(hitTarget as unknown as HTMLElement);
      const origin = {
        x: Number(hitTarget.getAttribute("x")) + Number(hitTarget.getAttribute("width")) / 2,
        y: Number(hitTarget.getAttribute("y")) + Number(hitTarget.getAttribute("height")) / 2,
      };

      fireEvent.pointerDown(hitTarget, {
        pointerId: 142,
        button: 0,
        isPrimary: true,
        clientX: origin.x,
        clientY: origin.y,
      });
      fireEvent.pointerMove(minimap, {
        pointerId: 142,
        clientX: origin.x + 18,
        clientY: origin.y + 9,
      });
      expect(animationFrames.size).toBe(1);

      let nextLayout = layout;
      let nextViewport = DEFAULT_VIEWPORT;
      if (kind === "resize") {
        nextViewport = { width: 1_080, height: 640 };
        measure(nextViewport);
      } else if (kind === "geometry") {
        nextLayout = {
          ...layout,
          nodes: layout.nodes.map((node) => node.treatment === "current"
            ? { ...node, x: node.x + 500 }
            : node),
        };
        view.rerender(historyUi(nextLayout));
      } else {
        const replacement = layout.nodes.find((node) => node.treatment === "historical");
        if (replacement === undefined) throw new Error("fixture needs a historical replacement current");
        nextLayout = {
          ...layout,
          nodes: layout.nodes.map((node) => {
            if (node.treatment === "current") {
              return { ...node, treatment: "historical" as const, currentState: undefined, calloutLabel: undefined };
            }
            if (node.id === replacement.id) {
              return {
                ...node,
                treatment: "current" as const,
                currentState: "Replacement current",
                calloutLabel: "CURRENT STATE" as const,
              };
            }
            return node;
          }),
        };
        view.rerender(historyUi(nextLayout));
      }

      expect(animationFrames.size).toBe(0);
      expect(capture.releasePointerCapture).toHaveBeenCalledWith(142);
      const canonicalViewBox = expectedCanonicalViewBox(nextLayout, nextViewport);
      expect(view.container.querySelector(".history-canvas")).toHaveAttribute("viewBox", canonicalViewBox);
      const constraints = canonicalCamera(nextLayout, nextViewport);
      const canonical: HistoryCamera = {
        ...constraints.pose,
        viewportWidth: nextViewport.width,
        viewportHeight: nextViewport.height,
        mode: "canonical",
      };
      const currentMinimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
      expectIntegratedMinimapRect(currentMinimap, canonical, constraints.navigationBounds);

      fireEvent.pointerMove(minimap, {
        pointerId: 142,
        clientX: origin.x + 42,
        clientY: origin.y + 20,
      });
      fireEvent.pointerUp(minimap, {
        pointerId: 142,
        clientX: origin.x + 42,
        clientY: origin.y + 20,
      });
      fireEvent.keyDown(window, { key: "Escape" });
      flushAnimationFrames();
      expect(view.container.querySelector(".history-canvas")).toHaveAttribute("viewBox", canonicalViewBox);
    },
  );

  it.each([
    { name: "desktop", width: 240, height: 144 },
    { name: "320-equivalent", width: 160, height: 96 },
  ])("keeps the 24px viewport target interactive beyond a $name corner", ({ width, height }) => {
    const layout = canonicalHistoryLayout();
    renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const mainCapture = installPointerCapture(surface);
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;
    fixedMinimapRect(minimap, width, height);
    const constraints = canonicalCamera(layout, DEFAULT_VIEWPORT);
    const projection = createMinimapProjection(constraints.navigationBounds);
    const scale = width / 240;
    const corner = graphToMinimap(
      { x: constraints.navigationBounds.left, y: constraints.navigationBounds.top },
      projection,
    );
    fireEvent.click(minimap, {
      button: 0,
      clientX: corner.x * scale,
      clientY: corner.y * scale,
    });

    const hitTarget = minimap.querySelector("[data-minimap-viewport='hit-target']") as SVGRectElement;
    const capture = installPointerCapture(hitTarget as unknown as HTMLElement);
    const outsideOutline = {
      x: Number(hitTarget.getAttribute("x")) * scale - 11,
      y: Number(hitTarget.getAttribute("y")) * scale - 11,
    };
    fireEvent.pointerDown(hitTarget, {
      pointerId: 141,
      button: 0,
      isPrimary: true,
      clientX: outsideOutline.x,
      clientY: outsideOutline.y,
    });
    fireEvent.pointerUp(minimap, {
      pointerId: 141,
      clientX: outsideOutline.x + 4,
      clientY: outsideOutline.y,
    });
    expect(capture.setPointerCapture).toHaveBeenCalledWith(141);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(141);
    expect(mainCapture.setPointerCapture).not.toHaveBeenCalled();
    expect(hitTarget).toHaveAttribute("stroke-width", "24");
    expect(hitTarget).toHaveAttribute("vector-effect", "non-scaling-stroke");
  });

  it("reinitializes canonically after a genuine unmount and re-entry", () => {
    const layout = canonicalHistoryLayout();
    const first = renderHistory(layout);
    measure({ width: 800, height: 500 });
    expect(first.container.querySelector("svg")).toHaveAttribute(
      "viewBox",
      expectedCanonicalViewBox(layout, { width: 800, height: 500 }),
    );

    const firstObserver = latestObserver();
    first.unmount();
    expect(firstObserver.disconnect).toHaveBeenCalledOnce();

    const second = renderHistory(layout);
    measure({ width: 1_100, height: 640 });
    expect(second.container.querySelector("svg")).toHaveAttribute(
      "viewBox",
      expectedCanonicalViewBox(layout, { width: 1_100, height: 640 }),
    );
  });

  it("keeps Fit, resize, and native wheel bound to the committed layout after an abandoned transition render", () => {
    const committedLayout = canonicalHistoryLayout();
    const abandonedLayout: TimelineLayout = {
      ...committedLayout,
      nodes: committedLayout.nodes.map((node) => node.treatment === "current"
        ? { ...node, x: node.x + 700 }
        : node),
    };
    const view = render(<InterruptedHistoryHarness initialLayout={committedLayout} />);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    fireEvent.keyDown(surface, { key: "ArrowLeft" });

    act(() => {
      startTransition(() => {
        setInterruptedHistoryState?.({ layout: abandonedLayout, suspend: true });
      });
    });
    expect(screen.queryByTestId("interrupted-fallback")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Navigable project history timeline")).toBe(surface);

    fireEvent.click(screen.getByRole("button", { name: "Fit current (F)" }));
    expect(view.container.querySelector("svg")).toHaveAttribute(
      "viewBox",
      expectedCanonicalViewBox(committedLayout, DEFAULT_VIEWPORT),
    );
    expect(expectedCanonicalViewBox(abandonedLayout, DEFAULT_VIEWPORT)).not.toBe(
      expectedCanonicalViewBox(committedLayout, DEFAULT_VIEWPORT),
    );

    const resized = { width: 1_060, height: 620 };
    measure(resized);
    expect(view.container.querySelector("svg")).toHaveAttribute(
      "viewBox",
      expectedCanonicalViewBox(committedLayout, resized),
    );

    const constraints = canonicalCamera(committedLayout, resized);
    const startCamera: HistoryCamera = {
      ...constraints.pose,
      viewportWidth: resized.width,
      viewportHeight: resized.height,
      mode: "canonical",
    };
    const point = { x: resized.width / 2, y: resized.height / 2 };
    const expectedWheel = zoomHistoryCameraAtScreenPoint(
      startCamera,
      point,
      -80,
      constraints.minScale,
      constraints.maxScale,
      constraints.navigationBounds,
    );
    dispatchNativeWheel(surface, {
      deltaY: -80,
      clientX: point.x,
      clientY: point.y,
    });
    flushAnimationFrames();
    expect(view.container.querySelector("svg")).toHaveAttribute(
      "viewBox",
      historyCameraViewBox(expectedWheel),
    );
  });

  it("preserves camera and observer across equivalent objects, text/status changes, theme, and detail interactions", async () => {
    const user = userEvent.setup();
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const canvas = () => view.container.querySelector("svg");
    const originalViewBox = canvas()?.getAttribute("viewBox");
    const observer = latestObserver();

    const equivalent = structuredClone(layout);
    expect(cameraResetKey(equivalent)).toBe(cameraResetKey(layout));
    view.rerender(historyUi(equivalent));

    const presentationChange: TimelineLayout = {
      ...equivalent,
      nodes: equivalent.nodes.map((node, index) => index === 0
        ? {
            ...node,
            visibleTitle: "A presentation-only title change that must not refit the camera",
            fullTitle: "A presentation-only title change that must not refit the camera",
            status: node.status === "accepted" ? "informational" as const : node.status,
          }
        : node),
    };
    expect(cameraResetKey(presentationChange)).toBe(cameraResetKey(layout));
    expect(expectedCanonicalViewBox(presentationChange, DEFAULT_VIEWPORT)).not.toBe(originalViewBox);
    view.rerender(historyUi(presentationChange));
    document.documentElement.dataset.theme = "dark";
    view.rerender(historyUi(presentationChange));
    await user.hover(screen.getByRole("link", { name: /CORE-003/u }));
    fireEvent.focus(screen.getByRole("link", { name: /CORE-003/u }));

    expect(canvas()).toHaveAttribute("viewBox", originalViewBox);
    expect(MockResizeObserver.instances).toHaveLength(1);
    expect(observer.disconnect).not.toHaveBeenCalled();

    const resizedViewport = { width: 1_180, height: 690 };
    const staleLayoutViewBox = expectedCanonicalViewBox(layout, resizedViewport);
    const latestLayoutViewBox = expectedCanonicalViewBox(presentationChange, resizedViewport);
    expect(latestLayoutViewBox).not.toBe(staleLayoutViewBox);
    measure(resizedViewport);

    expect(canvas()).toHaveAttribute("viewBox", latestLayoutViewBox);
    expect(canvas()).not.toHaveAttribute("viewBox", staleLayoutViewBox);
    expect(MockResizeObserver.instances).toHaveLength(1);
    expect(observer.disconnect).not.toHaveBeenCalled();
  });

  it("canonically resets when graph geometry changes", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const originalViewBox = view.container.querySelector("svg")?.getAttribute("viewBox");
    const changed: TimelineLayout = {
      ...layout,
      nodes: layout.nodes.map((node) => node.treatment === "current"
        ? { ...node, x: node.x + 3_000 }
        : node),
    };

    expect(cameraResetKey(changed)).not.toBe(cameraResetKey(layout));
    view.rerender(historyUi(changed));

    expect(view.container.querySelector("svg")).toHaveAttribute(
      "viewBox",
      expectedCanonicalViewBox(changed, DEFAULT_VIEWPORT),
    );
    expect(view.container.querySelector("svg")?.getAttribute("viewBox")).not.toBe(originalViewBox);
  });

  it("commits native wheel updates against the latest graph reset key after an in-place graph change", () => {
    const layout = canonicalHistoryLayout();
    const onCameraCommit = vi.fn();
    const view = renderHistory(layout, { onCameraCommit });
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    fixedSurfaceRect(surface);
    const changed: TimelineLayout = {
      ...layout,
      nodes: layout.nodes.map((node) => node.treatment === "current"
        ? { ...node, x: node.x + 500 }
        : node),
    };
    const changedResetKey = cameraResetKey(changed);
    expect(changedResetKey).not.toBe(cameraResetKey(layout));

    view.rerender(historyUi(changed, { onCameraCommit }));
    onCameraCommit.mockClear();
    dispatchNativeWheel(surface, {
      deltaY: -120,
      clientX: DEFAULT_VIEWPORT.width / 2,
      clientY: DEFAULT_VIEWPORT.height / 2,
    });
    flushAnimationFrames();

    expect(onCameraCommit).toHaveBeenCalled();
    expect(onCameraCommit.mock.lastCall?.[0]).toMatchObject({ cameraResetKey: changedResetKey });
  });

  it("canonically resets when explicit current identity changes", () => {
    const layout = canonicalHistoryLayout();
    const replacement = layout.nodes.find((node) => node.treatment === "historical");
    if (replacement === undefined) throw new Error("fixture needs a historical replacement current");
    const changed: TimelineLayout = {
      ...layout,
      nodes: layout.nodes.map((node) => {
        if (node.treatment === "current") {
          return { ...node, treatment: "historical" as const, currentState: undefined, calloutLabel: undefined };
        }
        if (node.id === replacement.id) {
          return { ...node, treatment: "current" as const, currentState: "Replacement current", calloutLabel: "CURRENT STATE" as const };
        }
        return node;
      }),
    };
    const view = renderHistory(layout);
    measure();

    view.rerender(historyUi(changed));

    expect(cameraResetKey(changed)).not.toBe(cameraResetKey(layout));
    expect(view.container.querySelector("svg")).toHaveAttribute(
      "viewBox",
      expectedCanonicalViewBox(changed, DEFAULT_VIEWPORT),
    );
  });

  it("recomputes canonical camera pose on resize", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure({ width: 800, height: 500 });
    expect(view.container.querySelector("svg")).toHaveAttribute(
      "viewBox",
      expectedCanonicalViewBox(layout, { width: 800, height: 500 }),
    );

    measure({ width: 1_200, height: 700 });

    expect(view.container.querySelector("svg")).toHaveAttribute(
      "viewBox",
      expectedCanonicalViewBox(layout, { width: 1_200, height: 700 }),
    );
  });

  it("preserves a valid manual pose on resize and minimally clamps invalid scale and center", () => {
    const layout = canonicalHistoryLayout();
    const viewport = { width: 1_000, height: 600 };
    const constraints = canonicalCamera(layout, viewport);
    const centeredPose = clampCamera(
      {
        centerX: (constraints.navigationBounds.left + constraints.navigationBounds.right) / 2,
        centerY: (constraints.navigationBounds.top + constraints.navigationBounds.bottom) / 2,
        scale: 2,
      },
      viewport,
      constraints.navigationBounds,
    );
    const manual: HistoryCamera = {
      ...centeredPose,
      viewportWidth: 700,
      viewportHeight: 480,
      mode: "manual",
    };

    expect(transitionHistoryCameraForResize(manual, layout, viewport)).toEqual({
      ...centeredPose,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      mode: "manual",
    });

    const underscaled: HistoryCamera = {
      centerX: -1_000_000,
      centerY: 1_000_000,
      scale: 0.001,
      viewportWidth: 700,
      viewportHeight: 480,
      mode: "manual",
    };
    const expectedPose = clampCamera(
      { centerX: underscaled.centerX, centerY: underscaled.centerY, scale: constraints.minScale },
      viewport,
      constraints.navigationBounds,
    );
    expect(transitionHistoryCameraForResize(underscaled, layout, viewport)).toEqual({
      ...expectedPose,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      mode: "manual",
    });

    expect(transitionHistoryCameraForResize({ ...manual, scale: 99 }, layout, viewport).scale).toBe(4);
  });

  it("hydrates a stored pose exactly and expands constraints to contain its visible rectangle", () => {
    const layout = canonicalHistoryLayout();
    const viewport = { width: 2_560, height: 1_440 };
    const camera: HistoryCamera = {
      centerX: -4_000,
      centerY: 7_500,
      scale: 0.125,
      viewportWidth: DEFAULT_VIEWPORT.width,
      viewportHeight: DEFAULT_VIEWPORT.height,
      mode: "canonical",
    };

    const result = transitionHistoryCameraPreservingPose(camera, layout, viewport);
    expect(result.camera).toEqual({
      ...camera,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      mode: "manual",
    });
    expect(result.minScale).toBeLessThanOrEqual(camera.scale);
    expect(result.maxScale).toBeGreaterThanOrEqual(camera.scale);
    const visible = visibleGraphRect(result.camera, viewport);
    expect(result.navigationBounds.left).toBeLessThanOrEqual(visible.left);
    expect(result.navigationBounds.top).toBeLessThanOrEqual(visible.top);
    expect(result.navigationBounds.right).toBeGreaterThanOrEqual(visible.right);
    expect(result.navigationBounds.bottom).toBeGreaterThanOrEqual(visible.bottom);
  });

  it("hydrates a matching camera snapshot at a new viewport and commits its exact pose without stored dimensions", () => {
    const layout = canonicalHistoryLayout();
    const resetKey = cameraResetKey(layout);
    const viewport = { width: 1_180, height: 690 };
    const canonical = canonicalCamera(layout, DEFAULT_VIEWPORT);
    const restoredCameraSnapshot: HistoryCameraSnapshot = {
      cameraResetKey: resetKey,
      centerX: canonical.pose.centerX - 36,
      centerY: canonical.pose.centerY + 18,
      scale: canonical.pose.scale * 1.2,
      mode: "manual",
    };
    const onCameraCommit = vi.fn();
    const view = renderHistory(layout, { restoredCameraSnapshot, onCameraCommit });

    measure(viewport);

    const actual = historyCameraFromRenderedViewBox(view.container, viewport);
    expect(actual.centerX).toBeCloseTo(restoredCameraSnapshot.centerX, 10);
    expect(actual.centerY).toBeCloseTo(restoredCameraSnapshot.centerY, 10);
    expect(actual.scale).toBeCloseTo(restoredCameraSnapshot.scale, 10);
    expect(onCameraCommit).toHaveBeenLastCalledWith(restoredCameraSnapshot);
    const expected = transitionHistoryCameraPreservingPose(
      {
        ...restoredCameraSnapshot,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
      },
      layout,
      viewport,
    );
    expectIntegratedMinimapRect(
      screen.getByTestId("history-minimap") as unknown as SVGSVGElement,
      expected.camera,
      expected.navigationBounds,
    );
  });

  it("rejects a stale reset key and overwrites the session with the new canonical camera", () => {
    const layout = canonicalHistoryLayout();
    const onCameraCommit = vi.fn();
    const stale: HistoryCameraSnapshot = {
      cameraResetKey: "stale-graph",
      centerX: -4_000,
      centerY: 7_500,
      scale: 0.125,
      mode: "manual",
    };
    const view = renderHistory(layout, { restoredCameraSnapshot: stale, onCameraCommit });
    measure();

    expect(view.container.querySelector(".history-canvas")).toHaveAttribute(
      "viewBox",
      expectedCanonicalViewBox(layout, DEFAULT_VIEWPORT),
    );
    expect(onCameraCommit).toHaveBeenLastCalledWith({
      cameraResetKey: cameraResetKey(layout),
      ...canonicalCamera(layout, DEFAULT_VIEWPORT).pose,
      mode: "canonical",
    });

    const changed: TimelineLayout = {
      ...layout,
      nodes: layout.nodes.map((node) => node.treatment === "current"
        ? { ...node, x: node.x + 500 }
        : node),
    };
    view.rerender(historyUi(changed, { restoredCameraSnapshot: stale, onCameraCommit }));
    expect(view.container.querySelector(".history-canvas")).toHaveAttribute(
      "viewBox",
      expectedCanonicalViewBox(changed, DEFAULT_VIEWPORT),
    );
    expect(onCameraCommit).toHaveBeenLastCalledWith({
      cameraResetKey: cameraResetKey(changed),
      ...canonicalCamera(changed, DEFAULT_VIEWPORT).pose,
      mode: "canonical",
    });
  });

  it("rejects a provider-held camera after graph reset and starts canonically in a fresh provider", () => {
    const original = canonicalHistoryLayout();
    const changed: TimelineLayout = {
      ...original,
      nodes: original.nodes.map((node) => node.treatment === "current"
        ? { ...node, x: node.x + 500 }
        : node),
    };
    const view = render(historySessionUi(original, true));
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    fireEvent.keyDown(surface, { key: "ArrowLeft" });
    const committedManual = view.container.querySelector(".history-canvas")?.getAttribute("viewBox");
    expect(committedManual).not.toBe(expectedCanonicalViewBox(original, DEFAULT_VIEWPORT));

    view.rerender(historySessionUi(original, false));
    view.rerender(historySessionUi(changed, true));
    measure();
    expect(view.container.querySelector(".history-canvas")).toHaveAttribute(
      "viewBox",
      expectedCanonicalViewBox(changed, DEFAULT_VIEWPORT),
    );
    expect(view.container.querySelector(".history-canvas")).not.toHaveAttribute("viewBox", committedManual);

    view.unmount();
    const fresh = render(historySessionUi(original, true));
    measure();
    expect(fresh.container.querySelector(".history-canvas")).toHaveAttribute(
      "viewBox",
      expectedCanonicalViewBox(original, DEFAULT_VIEWPORT),
    );
    expect(fresh.container.querySelector(".history-canvas")).not.toHaveAttribute("viewBox", committedManual);
  });

  it("commits manual navigation and lets explicit F overwrite it with canonical session state", () => {
    const layout = canonicalHistoryLayout();
    const onCameraCommit = vi.fn();
    renderHistory(layout, { onCameraCommit });
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");

    fireEvent.keyDown(surface, { key: "ArrowLeft" });
    expect(onCameraCommit).toHaveBeenLastCalledWith(expect.objectContaining({
      cameraResetKey: cameraResetKey(layout),
      mode: "manual",
    }));
    fireEvent.keyDown(surface, { key: "f" });
    expect(onCameraCommit).toHaveBeenLastCalledWith({
      cameraResetKey: cameraResetKey(layout),
      ...canonicalCamera(layout, DEFAULT_VIEWPORT).pose,
      mode: "canonical",
    });
  });

  it.each([
    { name: "negative width", viewport: { width: -1, height: 600 } },
    { name: "zero width", viewport: { width: 0, height: 600 } },
    { name: "NaN width", viewport: { width: Number.NaN, height: 600 } },
    { name: "infinite width", viewport: { width: Number.POSITIVE_INFINITY, height: 600 } },
    { name: "negative height", viewport: { width: 1_000, height: -1 } },
    { name: "zero height", viewport: { width: 1_000, height: 0 } },
    { name: "height below padding reserve", viewport: { width: 1_000, height: 47.999 } },
    { name: "height equal to padding reserve", viewport: { width: 1_000, height: 48 } },
    { name: "NaN height", viewport: { width: 1_000, height: Number.NaN } },
    { name: "infinite height", viewport: { width: 1_000, height: Number.POSITIVE_INFINITY } },
  ])("rejects $name in both canonical and manual resize transitions", ({ viewport }) => {
    const layout = canonicalHistoryLayout();
    const canonical: HistoryCamera = {
      centerX: 500,
      centerY: 300,
      scale: 1,
      viewportWidth: 900,
      viewportHeight: 560,
      mode: "canonical",
    };
    const manual: HistoryCamera = { ...canonical, mode: "manual" };

    expect(() => transitionHistoryCameraForResize(canonical, layout, viewport)).toThrow(RangeError);
    expect(() => transitionHistoryCameraForResize(manual, layout, viewport)).toThrow(RangeError);
  });

  it("normalizes pixel, line, and page wheel deltas with deterministic invalid-input rejection", () => {
    expect(HISTORY_WHEEL_LINE_PIXELS).toBe(16);
    expect(normalizeHistoryWheelDelta(24, WheelEvent.DOM_DELTA_PIXEL, 560)).toBe(24);
    expect(normalizeHistoryWheelDelta(-2.5, WheelEvent.DOM_DELTA_LINE, 560)).toBe(-40);
    expect(normalizeHistoryWheelDelta(0.5, WheelEvent.DOM_DELTA_PAGE, 560)).toBe(280);
    expect(normalizeHistoryWheelDelta(Number.NaN, WheelEvent.DOM_DELTA_PIXEL, 560)).toBeUndefined();
    expect(normalizeHistoryWheelDelta(1, 99, 560)).toBeUndefined();
    expect(normalizeHistoryWheelDelta(1, WheelEvent.DOM_DELTA_PAGE, 0)).toBeUndefined();
  });

  it("keeps all nine cursor anchors exact for unclamped zoom and independently derives direction and scale", () => {
    const viewport = { width: 900, height: 560 };
    const navigationBounds = { left: -10_000, top: -10_000, right: 10_000, bottom: 10_000 };
    const camera: HistoryCamera = {
      centerX: 700,
      centerY: 300,
      scale: 1.75,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      mode: "canonical",
    };
    const normalizedDelta = -120;
    const expectedScale = camera.scale * Math.exp(-normalizedDelta * 0.0015);
    const positions: GraphPoint[] = [
      { x: 0, y: 0 },
      { x: viewport.width / 2, y: 0 },
      { x: viewport.width, y: 0 },
      { x: 0, y: viewport.height / 2 },
      { x: viewport.width / 2, y: viewport.height / 2 },
      { x: viewport.width, y: viewport.height / 2 },
      { x: 0, y: viewport.height },
      { x: viewport.width / 2, y: viewport.height },
      { x: viewport.width, y: viewport.height },
    ];

    for (const point of positions) {
      const anchor = {
        x: camera.centerX + (point.x - viewport.width / 2) / camera.scale,
        y: camera.centerY + (point.y - viewport.height / 2) / camera.scale,
      };
      const result = zoomHistoryCameraAtScreenPoint(
        camera,
        point,
        normalizedDelta,
        0.25,
        4,
        navigationBounds,
      );
      const expectedCenter = {
        x: anchor.x - (point.x - viewport.width / 2) / expectedScale,
        y: anchor.y - (point.y - viewport.height / 2) / expectedScale,
      };
      const projected = graphToScreen(anchor, result, viewport);
      expect(result.scale).toBeCloseTo(expectedScale, 12);
      expect(result.centerX).toBeCloseTo(expectedCenter.x, 12);
      expect(result.centerY).toBeCloseTo(expectedCenter.y, 12);
      expect(Math.hypot(projected.x - point.x, projected.y - point.y)).toBeLessThan(1e-9);
      expect(result.mode).toBe("manual");
    }
  });

  it("clamps wheel zoom at min/max and clamps the anchored pose to every navigation side", () => {
    const viewport = { width: 200, height: 100 };
    const bounds = { left: 0, top: 0, right: 1_000, bottom: 800 };
    const camera: HistoryCamera = {
      centerX: 500,
      centerY: 400,
      scale: 2,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      mode: "canonical",
    };
    expect(zoomHistoryCameraAtScreenPoint(camera, { x: 100, y: 50 }, -100_000, 0.5, 4, bounds).scale).toBe(4);
    expect(zoomHistoryCameraAtScreenPoint(camera, { x: 100, y: 50 }, 100_000, 0.5, 4, bounds).scale).toBe(0.5);

    const topLeft = zoomHistoryCameraAtScreenPoint(
      { ...camera, centerX: 50, centerY: 25 },
      { x: 0, y: 0 },
      -300,
      0.5,
      4,
      bounds,
    );
    const topLeftVisible = visibleGraphRect(topLeft, viewport);
    expect(topLeftVisible.left).toBeCloseTo(bounds.left, 10);
    expect(topLeftVisible.top).toBeCloseTo(bounds.top, 10);

    const bottomRight = zoomHistoryCameraAtScreenPoint(
      { ...camera, centerX: 950, centerY: 775 },
      { x: 200, y: 100 },
      -300,
      0.5,
      4,
      bounds,
    );
    const bottomRightVisible = visibleGraphRect(bottomRight, viewport);
    expect(bottomRightVisible.right).toBeCloseTo(bounds.right, 10);
    expect(bottomRightVisible.bottom).toBeCloseTo(bounds.bottom, 10);
  });

  it.each([
    {
      name: "minimum",
      camera: {
        centerX: 1693.7422655520807,
        centerY: 400,
        scale: 0.6391485561942949,
        viewportWidth: 900,
        viewportHeight: 560,
        mode: "canonical" as const,
      },
      point: { x: 316.7273503556591, y: 280 },
      delta: 100,
      minScale: 0.6391485561942949,
      maxScale: 4,
    },
    {
      name: "maximum",
      camera: {
        centerX: -190.51047079468142,
        centerY: 400,
        scale: 4,
        viewportWidth: 900,
        viewportHeight: 560,
        mode: "manual" as const,
      },
      point: { x: 579.2796680633585, y: 280 },
      delta: -100,
      minScale: 0.25,
      maxScale: 4,
    },
  ])("returns the exact $name-limit camera before off-center anchor math", ({
    camera,
    point,
    delta,
    minScale,
    maxScale,
  }) => {
    const result = zoomHistoryCameraAtScreenPoint(
      camera,
      point,
      delta,
      minScale,
      maxScale,
      { left: -10_000, top: -10_000, right: 10_000, bottom: 10_000 },
    );

    expect(result).toBe(camera);
    expect(result.mode).toBe(camera.mode);
  });

  it("does not accumulate cursor drift over 100 alternating unclamped wheel operations", () => {
    const viewport = { width: 900, height: 560 };
    const bounds = { left: -10_000, top: -10_000, right: 10_000, bottom: 10_000 };
    const point = { x: 137, y: 419 };
    const original: HistoryCamera = {
      centerX: 300,
      centerY: -200,
      scale: 1.5,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      mode: "canonical",
    };
    const anchor = screenToGraph(point, original, viewport);
    let camera = original;
    for (let index = 0; index < 100; index += 1) {
      camera = zoomHistoryCameraAtScreenPoint(
        camera,
        point,
        index % 2 === 0 ? -80 : 80,
        0.25,
        4,
        bounds,
      );
      const projected = graphToScreen(anchor, camera, viewport);
      expect(Math.hypot(projected.x - point.x, projected.y - point.y)).toBeLessThan(0.5);
    }
    expect(camera.scale).toBeCloseTo(original.scale, 12);
    expect(camera.centerX).toBeCloseTo(original.centerX, 10);
    expect(camera.centerY).toBeCloseTo(original.centerY, 10);
  });

  it.each([
    { name: "wide", start: { x: 100, y: 150 }, end: { x: 700, y: 250 } },
    { name: "tall", start: { x: 350, y: 50 }, end: { x: 450, y: 510 } },
    { name: "square", start: { x: 200, y: 100 }, end: { x: 500, y: 400 } },
  ])("fits normal and fully reversed $name selections with 24px padding and preserved aspect", ({ start, end }) => {
    const viewport = { width: 900, height: 560 };
    const camera: HistoryCamera = {
      centerX: 500,
      centerY: 400,
      scale: 2,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      mode: "canonical",
    };
    const bounds = { left: -5_000, top: -5_000, right: 5_000, bottom: 5_000 };
    const forward = fitHistoryCameraToScreenSelection(camera, start, end, 0.25, 4, bounds);
    const reversed = fitHistoryCameraToScreenSelection(camera, end, start, 0.25, 4, bounds);
    if (forward === undefined || reversed === undefined) throw new Error("valid selection was rejected");

    const screenWidth = Math.abs(end.x - start.x);
    const screenHeight = Math.abs(end.y - start.y);
    const graphWidth = screenWidth / camera.scale;
    const graphHeight = screenHeight / camera.scale;
    const expectedScale = Math.min(
      4,
      Math.max(0.25, Math.min(
        (viewport.width - HISTORY_SELECTION_PADDING * 2) / graphWidth,
        (viewport.height - HISTORY_SELECTION_PADDING * 2) / graphHeight,
      )),
    );
    const selectionCenter = {
      x: camera.centerX + ((start.x + end.x) / 2 - viewport.width / 2) / camera.scale,
      y: camera.centerY + ((start.y + end.y) / 2 - viewport.height / 2) / camera.scale,
    };
    expect(forward).toEqual(reversed);
    expect(forward.scale).toBeCloseTo(expectedScale, 12);
    expect(forward.centerX).toBeCloseTo(selectionCenter.x, 12);
    expect(forward.centerY).toBeCloseTo(selectionCenter.y, 12);
    expect(forward.mode).toBe("manual");

    const selectedTopLeft = screenToGraph(
      { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) },
      camera,
      viewport,
    );
    const selectedBottomRight = screenToGraph(
      { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y) },
      camera,
      viewport,
    );
    const projectedTopLeft = graphToScreen(selectedTopLeft, forward, viewport);
    const projectedBottomRight = graphToScreen(selectedBottomRight, forward, viewport);
    expect(projectedTopLeft.x).toBeGreaterThanOrEqual(HISTORY_SELECTION_PADDING - 1e-9);
    expect(projectedTopLeft.y).toBeGreaterThanOrEqual(HISTORY_SELECTION_PADDING - 1e-9);
    expect(projectedBottomRight.x).toBeLessThanOrEqual(viewport.width - HISTORY_SELECTION_PADDING + 1e-9);
    expect(projectedBottomRight.y).toBeLessThanOrEqual(viewport.height - HISTORY_SELECTION_PADDING + 1e-9);
  });

  it("clamps selection endpoints, honors exact 8px thresholds, and clamps fitted scale to min/max", () => {
    expect(normalizeHistoryScreenSelection(
      { x: 950, y: -20 },
      { x: -10, y: 600 },
      { width: 900, height: 560 },
    )).toEqual({ left: 0, top: 0, right: 900, bottom: 560 });
    const bounds = { left: -5_000, top: -5_000, right: 5_000, bottom: 5_000 };
    const camera: HistoryCamera = {
      centerX: 500,
      centerY: 400,
      scale: 2,
      viewportWidth: 900,
      viewportHeight: 560,
      mode: "canonical",
    };
    expect(fitHistoryCameraToScreenSelection(camera, { x: 100, y: 100 }, { x: 108, y: 108 }, 0.25, 4, bounds)?.scale).toBe(4);
    expect(fitHistoryCameraToScreenSelection(camera, { x: 100, y: 100 }, { x: 107.999, y: 108 }, 0.25, 4, bounds)).toBeUndefined();
    expect(fitHistoryCameraToScreenSelection(camera, { x: 100, y: 100 }, { x: 108, y: 107.999 }, 0.25, 4, bounds)).toBeUndefined();

    const minimumCamera = { ...camera, scale: 0.5 };
    expect(fitHistoryCameraToScreenSelection(
      minimumCamera,
      { x: 0, y: 0 },
      { x: 900, y: 560 },
      0.5,
      4,
      bounds,
    )?.scale).toBe(0.5);
  });

  it.each([
    { name: "top-left", camera: { centerX: 100, centerY: 50 }, start: { x: 0, y: 0 }, end: { x: 50, y: 25 } },
    { name: "bottom-right", camera: { centerX: 900, centerY: 750 }, start: { x: 150, y: 75 }, end: { x: 200, y: 100 } },
  ])("clamps a $name rectangle fit to every navigation boundary", ({ camera: center, start, end }) => {
    const viewport = { width: 200, height: 100 };
    const bounds = { left: 0, top: 0, right: 1_000, bottom: 800 };
    const camera: HistoryCamera = {
      ...center,
      scale: 1,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      mode: "canonical",
    };
    const result = fitHistoryCameraToScreenSelection(camera, start, end, 0.5, 4, bounds);
    if (result === undefined) throw new Error("boundary selection was rejected");
    const visible = visibleGraphRect(result, viewport);
    expect(visible.left).toBeGreaterThanOrEqual(bounds.left - 1e-10);
    expect(visible.top).toBeGreaterThanOrEqual(bounds.top - 1e-10);
    expect(visible.right).toBeLessThanOrEqual(bounds.right + 1e-10);
    expect(visible.bottom).toBeLessThanOrEqual(bounds.bottom + 1e-10);
    if (center.centerX === 100) {
      expect(visible.left).toBeCloseTo(bounds.left, 12);
      expect(visible.top).toBeCloseTo(bounds.top, 12);
    } else {
      expect(visible.right).toBeCloseTo(bounds.right, 12);
      expect(visible.bottom).toBeCloseTo(bounds.bottom, 12);
    }
  });

  it("anchors native wheel input to offset surface coordinates and composes a burst into one RAF", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 50,
      width: DEFAULT_VIEWPORT.width,
      height: DEFAULT_VIEWPORT.height,
      right: 1_000,
      bottom: 610,
      x: 100,
      y: 50,
      toJSON: () => undefined,
    });
    const constraints = canonicalCamera(layout, DEFAULT_VIEWPORT);
    let expected: HistoryCamera = {
      ...constraints.pose,
      viewportWidth: DEFAULT_VIEWPORT.width,
      viewportHeight: DEFAULT_VIEWPORT.height,
      mode: "canonical",
    };
    const localPoint = { x: 215, y: 330 };
    const initialViewBox = view.container.querySelector("svg")?.getAttribute("viewBox");
    const deltas = [-40, -60, 25];

    for (const deltaY of deltas) {
      const event = dispatchNativeWheel(surface, {
        clientX: localPoint.x + 100,
        clientY: localPoint.y + 50,
        deltaY,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      });
      expect(event.defaultPrevented).toBe(true);
      expected = zoomHistoryCameraAtScreenPoint(
        expected,
        localPoint,
        deltaY,
        constraints.minScale,
        constraints.maxScale,
        constraints.navigationBounds,
      );
    }

    expect(animationFrames.size).toBe(1);
    expect(vi.mocked(requestAnimationFrame)).toHaveBeenCalledOnce();
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", initialViewBox);
    flushAnimationFrames();
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", historyCameraViewBox(expected));
  });

  it("keeps a native off-center minimum-limit wheel as an exact canonical no-op", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const initialViewBox = view.container.querySelector("svg")?.getAttribute("viewBox");

    const event = dispatchNativeWheel(surface, {
      clientX: 137.25,
      clientY: 419.5,
      deltaY: 100,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    });

    expect(event.defaultPrevented).toBe(true);
    expect(animationFrames.size).toBe(0);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", initialViewBox);
    flushAnimationFrames();

    const resized = { width: 1_100, height: 640 };
    measure(resized);
    expect(view.container.querySelector("svg")).toHaveAttribute(
      "viewBox",
      expectedCanonicalViewBox(layout, resized),
    );
  });

  it("preserves an authoritative pending burst through harmless rerenders and blocks stale pan composition", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const capture = installPointerCapture(surface);
    const constraints = canonicalCamera(layout, DEFAULT_VIEWPORT);
    let expected: HistoryCamera = {
      ...constraints.pose,
      viewportWidth: DEFAULT_VIEWPORT.width,
      viewportHeight: DEFAULT_VIEWPORT.height,
      mode: "canonical",
    };
    const point = { x: 310, y: 220 };

    dispatchNativeWheel(surface, { clientX: point.x, clientY: point.y, deltaY: -70 });
    expected = zoomHistoryCameraAtScreenPoint(
      expected,
      point,
      -70,
      constraints.minScale,
      constraints.maxScale,
      constraints.navigationBounds,
    );
    const presentationChange: TimelineLayout = {
      ...layout,
      nodes: layout.nodes.map((node, index) => index === 0
        ? { ...node, status: node.status === "accepted" ? "informational" as const : node.status }
        : node),
    };
    view.rerender(historyUi(presentationChange));
    fireEvent.focus(screen.getByRole("link", { name: /CORE-003/u }));

    dispatchNativeWheel(surface, { clientX: point.x, clientY: point.y, deltaY: -30 });
    expected = zoomHistoryCameraAtScreenPoint(
      expected,
      point,
      -30,
      constraints.minScale,
      constraints.maxScale,
      constraints.navigationBounds,
    );
    fireEvent.pointerDown(surface, { pointerId: 72, button: 0, clientX: 100, clientY: 100 });
    expect(capture.setPointerCapture).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(surface, { key: "ArrowRight" })).toBe(false);
    expect(animationFrames.size).toBe(1);

    flushAnimationFrames();
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", historyCameraViewBox(expected));
  });

  it.each([
    { mode: WheelEvent.DOM_DELTA_PIXEL, delta: -32, normalized: -32 },
    { mode: WheelEvent.DOM_DELTA_LINE, delta: -2, normalized: -32 },
    { mode: WheelEvent.DOM_DELTA_PAGE, delta: -32 / DEFAULT_VIEWPORT.height, normalized: -32 },
  ])("applies native delta mode $mode using the same zoom", ({ mode, delta, normalized }) => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const constraints = canonicalCamera(layout, DEFAULT_VIEWPORT);
    const start: HistoryCamera = {
      ...constraints.pose,
      viewportWidth: DEFAULT_VIEWPORT.width,
      viewportHeight: DEFAULT_VIEWPORT.height,
      mode: "canonical",
    };
    const point = { x: DEFAULT_VIEWPORT.width / 2, y: DEFAULT_VIEWPORT.height / 2 };
    const expected = zoomHistoryCameraAtScreenPoint(
      start,
      point,
      normalized,
      constraints.minScale,
      constraints.maxScale,
      constraints.navigationBounds,
    );
    dispatchNativeWheel(surface, { clientX: point.x, clientY: point.y, deltaY: delta, deltaMode: mode });
    flushAnimationFrames();
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", historyCameraViewBox(expected));
  });

  it("owns only finite nonzero wheel input and installs one stable nonpassive listener with exact cleanup", () => {
    const add = vi.spyOn(HTMLElement.prototype, "addEventListener");
    const remove = vi.spyOn(HTMLElement.prototype, "removeEventListener");
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const wheelAdds = () => add.mock.calls.filter((call) => call[0] === "wheel" && call[2] !== true);
    const customAdds = wheelAdds().filter((call) => (call[2] as AddEventListenerOptions | undefined)?.passive === false);
    expect(customAdds).toHaveLength(1);
    const listener = customAdds[0]?.[1];

    const zero = dispatchNativeWheel(surface, { deltaY: 0, clientX: 10, clientY: 10 });
    const unknown = dispatchNativeWheel(surface, { deltaY: 1, deltaMode: 99, clientX: 10, clientY: 10 });
    expect(zero.defaultPrevented).toBe(false);
    expect(unknown.defaultPrevented).toBe(false);
    expect(animationFrames.size).toBe(0);

    const finite = dispatchNativeWheel(surface, { deltaY: -20, clientX: 10, clientY: 10 });
    expect(finite.defaultPrevented).toBe(true);
    view.rerender(historyUi(structuredClone(layout)));
    document.documentElement.dataset.theme = "dark";
    view.rerender(historyUi(structuredClone(layout)));
    expect(wheelAdds().filter((call) => (call[2] as AddEventListenerOptions | undefined)?.passive === false)).toHaveLength(1);

    view.unmount();
    expect(remove.mock.calls.some((call) => call[0] === "wheel" && call[1] === listener && call[2] === false)).toBe(true);
    expect(animationFrames.size).toBe(0);
  });

  it("cancels queued wheel commits on Fit, geometry replacement, resize, and unmount", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const originalViewBox = view.container.querySelector("svg")?.getAttribute("viewBox");
    const queueWheel = () => {
      dispatchNativeWheel(surface, { deltaY: -100, clientX: 400, clientY: 250 });
      expect(animationFrames.size).toBe(1);
    };

    queueWheel();
    fireEvent.click(screen.getByRole("button", { name: "Fit current (F)" }));
    expect(animationFrames.size).toBe(0);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", originalViewBox);

    queueWheel();
    const changed: TimelineLayout = {
      ...layout,
      nodes: layout.nodes.map((node) => node.treatment === "current" ? { ...node, x: node.x + 500 } : node),
    };
    view.rerender(historyUi(changed));
    expect(animationFrames.size).toBe(0);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", expectedCanonicalViewBox(changed, DEFAULT_VIEWPORT));

    queueWheel();
    const resized = { width: 1_100, height: 640 };
    measure(resized);
    expect(animationFrames.size).toBe(0);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", expectedCanonicalViewBox(changed, resized));

    queueWheel();
    view.unmount();
    expect(animationFrames.size).toBe(0);
    expect(vi.mocked(cancelAnimationFrame)).toHaveBeenCalled();
  });

  it("arbitrates wheel against active and ending pointer pans without stale camera overwrite", () => {
    const view = renderHistory();
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    installPointerCapture(surface);
    const initial = view.container.querySelector("svg")?.getAttribute("viewBox");

    fireEvent.pointerDown(surface, { pointerId: 70, button: 0, clientX: 100, clientY: 100 });
    const pendingPanWheel = dispatchNativeWheel(surface, { deltaY: -100, clientX: 400, clientY: 250 });
    expect(pendingPanWheel.defaultPrevented).toBe(false);
    expect(animationFrames.size).toBe(0);

    fireEvent.pointerMove(surface, { pointerId: 70, clientX: 140, clientY: 100 });
    expect(animationFrames.size).toBe(1);
    const activePanWheel = dispatchNativeWheel(surface, { deltaY: -100, clientX: 400, clientY: 250 });
    expect(activePanWheel.defaultPrevented).toBe(false);
    expect(animationFrames.size).toBe(1);
    flushAnimationFrames();
    const panned = view.container.querySelector("svg")?.getAttribute("viewBox");
    expect(panned).not.toBe(initial);

    fireEvent.pointerUp(surface, { pointerId: 70, clientX: 170, clientY: 100 });
    const endingPanWheel = dispatchNativeWheel(surface, { deltaY: -100, clientX: 400, clientY: 250 });
    expect(endingPanWheel.defaultPrevented).toBe(false);
    expect(animationFrames.size).toBe(1);
    flushAnimationFrames();
    const finalPan = view.container.querySelector("svg")?.getAttribute("viewBox");

    const ownedWheel = dispatchNativeWheel(surface, { deltaY: -100, clientX: 400, clientY: 250 });
    expect(ownedWheel.defaultPrevented).toBe(true);
    expect(animationFrames.size).toBe(1);
    flushAnimationFrames();
    expect(view.container.querySelector("svg")?.getAttribute("viewBox")).not.toBe(finalPan);
  });

  it("renders one clamped reversed selection update per RAF and owns wheel/arrows/new gestures", () => {
    const view = renderHistory();
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const capture = installPointerCapture(surface);
    const focus = vi.spyOn(surface, "focus");
    fixedSurfaceRect(surface, { left: 100, top: 50 });
    const canvas = view.container.querySelector("svg");
    if (canvas === null) throw new Error("History canvas is unavailable");
    const initialViewBox = canvas.getAttribute("viewBox");

    expect(fireEvent.pointerDown(canvas, {
      pointerId: 90,
      button: 0,
      isPrimary: true,
      ctrlKey: true,
      clientX: 300,
      clientY: 250,
    })).toBe(false);
    expect(capture.setPointerCapture).toHaveBeenCalledWith(90);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(surface).toHaveClass("history-selecting");
    fireEvent.pointerMove(surface, { pointerId: 90, clientX: 250, clientY: 180 });
    fireEvent.pointerMove(surface, { pointerId: 90, clientX: 150, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 90, clientX: 50, clientY: 20 });
    expect(animationFrames.size).toBe(1);
    expect(screen.queryByTestId("history-selection-rectangle")).not.toBeInTheDocument();

    const wheel = dispatchNativeWheel(surface, { deltaY: -100, clientX: 400, clientY: 250 });
    expect(wheel.defaultPrevented).toBe(true);
    expect(animationFrames.size).toBe(1);
    expect(fireEvent.keyDown(surface, { key: "ArrowRight", ctrlKey: true })).toBe(false);
    fireEvent.pointerDown(canvas, {
      pointerId: 91,
      button: 0,
      isPrimary: true,
      ctrlKey: true,
      clientX: 400,
      clientY: 250,
    });
    expect(capture.setPointerCapture).not.toHaveBeenCalledWith(91);

    flushAnimationFrames();
    expect(screen.getByTestId("history-selection-rectangle")).toHaveStyle({
      left: "0px",
      top: "0px",
      width: "200px",
      height: "200px",
    });
    expect(canvas).toHaveAttribute("viewBox", initialViewBox);
    expect(fireEvent.keyDown(surface, { key: "Escape" })).toBe(false);
    expect(screen.queryByTestId("history-selection-rectangle")).not.toBeInTheDocument();
    expect(surface).not.toHaveClass("history-selecting");
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(90);
    expect(canvas).toHaveAttribute("viewBox", initialViewBox);
  });

  it("commits the final unflushed rectangle using independently derived fit geometry", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const capture = installPointerCapture(surface);
    fixedSurfaceRect(surface, { left: 75, top: 25 });
    const canvas = view.container.querySelector("svg");
    if (canvas === null) throw new Error("History canvas is unavailable");
    const startBox = viewBoxCameraCenter(view.container);
    const startScale = DEFAULT_VIEWPORT.width / startBox.width;
    const constraints = canonicalCamera(layout, DEFAULT_VIEWPORT);

    fireEvent.pointerDown(canvas, {
      pointerId: 92,
      button: 0,
      isPrimary: true,
      ctrlKey: true,
      clientX: 175,
      clientY: 125,
    });
    fireEvent.pointerMove(surface, { pointerId: 92, clientX: 575, clientY: 225 });
    expect(animationFrames.size).toBe(1);
    expect(fireEvent.pointerUp(surface, {
      pointerId: 92,
      clientX: 775,
      clientY: 325,
    })).toBe(false);

    const selectedWidth = 600 / startScale;
    const selectedHeight = 200 / startScale;
    const expectedScale = Math.min(
      constraints.maxScale,
      Math.max(constraints.minScale, Math.min(
        (DEFAULT_VIEWPORT.width - HISTORY_SELECTION_PADDING * 2) / selectedWidth,
        (DEFAULT_VIEWPORT.height - HISTORY_SELECTION_PADDING * 2) / selectedHeight,
      )),
    );
    const expected: HistoryCamera = {
      centerX: startBox.x + (400 - DEFAULT_VIEWPORT.width / 2) / startScale,
      centerY: startBox.y + (200 - DEFAULT_VIEWPORT.height / 2) / startScale,
      scale: expectedScale,
      viewportWidth: DEFAULT_VIEWPORT.width,
      viewportHeight: DEFAULT_VIEWPORT.height,
      mode: "manual",
    };
    expect(animationFrames.size).toBe(0);
    expect(screen.queryByTestId("history-selection-rectangle")).not.toBeInTheDocument();
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(92);
    const actual = historyCameraFromRenderedViewBox(view.container, DEFAULT_VIEWPORT);
    expect(actual.centerX).toBeCloseTo(expected.centerX, 12);
    expect(actual.centerY).toBeCloseTo(expected.centerY, 12);
    expect(actual.scale).toBeCloseTo(expected.scale, 12);
  });

  it.each([
    { name: "exact 8px", width: 8, height: 8, changes: true },
    { name: "7.999px width", width: 7.999, height: 8, changes: false },
    { name: "7.999px height", width: 8, height: 7.999, changes: false },
  ])("uses CSS border/content-box dimensions for $name selection", ({ width, height, changes }) => {
    const view = renderHistory();
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    installPointerCapture(surface);
    fixedSurfaceRect(surface, { left: 40, top: 20, width: 900, height: 562 });
    Object.defineProperties(surface, {
      clientWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 560 },
      clientLeft: { configurable: true, value: 0 },
      clientTop: { configurable: true, value: 1 },
    });
    const canvas = view.container.querySelector("svg");
    if (canvas === null) throw new Error("History canvas is unavailable");
    const initialViewBox = canvas.getAttribute("viewBox");

    fireEvent.pointerDown(canvas, {
      pointerId: 93,
      button: 0,
      isPrimary: true,
      ctrlKey: true,
      clientX: 140,
      clientY: 121,
    });
    fireEvent.pointerUp(surface, {
      pointerId: 93,
      clientX: 140 + width,
      clientY: 121 + height,
    });

    if (changes) expect(canvas.getAttribute("viewBox")).not.toBe(initialViewBox);
    else expect(canvas).toHaveAttribute("viewBox", initialViewBox);
  });

  it("maps nonzero borders and differing client dimensions to exact overlay and fitted viewBox", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    installPointerCapture(surface);
    fixedSurfaceRect(surface, { left: 100, top: 50, width: 904, height: 566 });
    Object.defineProperties(surface, {
      clientWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 560 },
      clientLeft: { configurable: true, value: 2 },
      clientTop: { configurable: true, value: 3 },
    });
    const canvas = view.container.querySelector("svg");
    if (canvas === null) throw new Error("History canvas is unavailable");
    const start = viewBoxCameraCenter(view.container);
    const startScale = DEFAULT_VIEWPORT.width / start.width;
    const constraints = canonicalCamera(layout, DEFAULT_VIEWPORT);

    fireEvent.pointerDown(canvas, {
      pointerId: 108,
      button: 0,
      isPrimary: true,
      ctrlKey: true,
      clientX: 352,
      clientY: 233,
    });
    fireEvent.pointerMove(surface, { pointerId: 108, clientX: 752, clientY: 433 });
    flushAnimationFrames();
    expect(screen.getByTestId("history-selection-rectangle")).toHaveStyle({
      left: "250px",
      top: "180px",
      width: "400px",
      height: "200px",
    });
    fireEvent.pointerUp(surface, { pointerId: 108, clientX: 752, clientY: 433 });

    const expectedScale = Math.min(
      constraints.maxScale,
      Math.max(constraints.minScale, Math.min(
        (DEFAULT_VIEWPORT.width - 48) / (400 / startScale),
        (DEFAULT_VIEWPORT.height - 48) / (200 / startScale),
      )),
    );
    const expected: HistoryCamera = {
      centerX: start.x,
      centerY: start.y,
      scale: expectedScale,
      viewportWidth: DEFAULT_VIEWPORT.width,
      viewportHeight: DEFAULT_VIEWPORT.height,
      mode: "manual",
    };
    const actual = historyCameraFromRenderedViewBox(view.container, DEFAULT_VIEWPORT);
    expect(actual.centerX).toBeCloseTo(expected.centerX, 12);
    expect(actual.centerY).toBeCloseTo(expected.centerY, 12);
    expect(actual.scale).toBeCloseTo(expected.scale, 12);
    expect(screen.queryByTestId("history-selection-rectangle")).not.toBeInTheDocument();
  });

  it.each(["Escape", "pointercancel", "lostpointercapture"])(
    "cancels an active selection through %s without changing the exact camera",
    (method) => {
      const view = renderHistory();
      measure();
      const surface = screen.getByLabelText("Navigable project history timeline");
      const capture = installPointerCapture(surface);
      fixedSurfaceRect(surface);
      const canvas = view.container.querySelector("svg");
      if (canvas === null) throw new Error("History canvas is unavailable");
      const initialViewBox = canvas.getAttribute("viewBox");
      fireEvent.pointerDown(canvas, {
        pointerId: 94,
        button: 0,
        isPrimary: true,
        ctrlKey: true,
        clientX: 100,
        clientY: 100,
      });
      fireEvent.pointerMove(surface, { pointerId: 94, clientX: 300, clientY: 250 });
      flushAnimationFrames();
      expect(screen.getByTestId("history-selection-rectangle")).toBeInTheDocument();

      if (method === "Escape") fireEvent.keyDown(surface, { key: "Escape" });
      else if (method === "pointercancel") fireEvent.pointerCancel(surface, { pointerId: 94 });
      else {
        capture.lose(94);
        fireEvent.lostPointerCapture(surface, { pointerId: 94 });
      }

      expect(canvas).toHaveAttribute("viewBox", initialViewBox);
      expect(screen.queryByTestId("history-selection-rectangle")).not.toBeInTheDocument();
      expect(animationFrames.size).toBe(0);
    },
  );

  it.each(["Escape", "pointercancel", "lostpointercapture"])(
    "cancels an unflushed selection RAF through %s without a late overlay or camera change",
    (method) => {
      const view = renderHistory();
      measure();
      const surface = screen.getByLabelText("Navigable project history timeline");
      const capture = installPointerCapture(surface);
      fixedSurfaceRect(surface);
      const canvas = view.container.querySelector("svg");
      if (canvas === null) throw new Error("History canvas is unavailable");
      const initialViewBox = canvas.getAttribute("viewBox");
      fireEvent.pointerDown(canvas, {
        pointerId: 109,
        button: 0,
        isPrimary: true,
        ctrlKey: true,
        clientX: 100,
        clientY: 100,
      });
      fireEvent.pointerMove(surface, { pointerId: 109, clientX: 400, clientY: 300 });
      expect(animationFrames.size).toBe(1);
      expect(screen.queryByTestId("history-selection-rectangle")).not.toBeInTheDocument();

      if (method === "Escape") fireEvent.keyDown(surface, { key: "Escape" });
      else if (method === "pointercancel") fireEvent.pointerCancel(surface, { pointerId: 109 });
      else {
        capture.lose(109);
        fireEvent.lostPointerCapture(surface, { pointerId: 109 });
      }

      expect(animationFrames.size).toBe(0);
      expect(capture.hasPointerCapture(109)).toBe(false);
      if (method !== "lostpointercapture") {
        expect(capture.releasePointerCapture).toHaveBeenCalledWith(109);
      }
      expect(canvas).toHaveAttribute("viewBox", initialViewBox);
      expect(screen.queryByTestId("history-selection-rectangle")).not.toBeInTheDocument();
      flushAnimationFrames();
      expect(canvas).toHaveAttribute("viewBox", initialViewBox);
      expect(screen.queryByTestId("history-selection-rectangle")).not.toBeInTheDocument();
    },
  );

  it("rejects links, controls, nonprimary and extra modifiers while a Ctrl background click never routes", () => {
    const view = renderHistory();
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const capture = installPointerCapture(surface);
    fixedSurfaceRect(surface);
    const canvas = view.container.querySelector("svg");
    const link = screen.getByRole("link", { name: /CORE-003/u });
    const control = document.createElement("button");
    surface.append(control);
    if (canvas === null) throw new Error("History canvas is unavailable");

    fireEvent.pointerDown(link, { pointerId: 95, button: 0, isPrimary: true, ctrlKey: true, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(control, { pointerId: 96, button: 0, isPrimary: true, ctrlKey: true, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(canvas, { pointerId: 97, button: 0, isPrimary: false, ctrlKey: true, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(canvas, { pointerId: 98, button: 0, isPrimary: true, ctrlKey: true, altKey: true, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(canvas, { pointerId: 99, button: 0, isPrimary: true, ctrlKey: true, shiftKey: true, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(canvas, { pointerId: 100, button: 0, isPrimary: true, ctrlKey: true, metaKey: true, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(canvas, { pointerId: 101, button: 1, isPrimary: true, ctrlKey: true, clientX: 100, clientY: 100 });
    expect(capture.setPointerCapture).not.toHaveBeenCalled();

    fireEvent.pointerDown(canvas, { pointerId: 102, button: 0, isPrimary: true, ctrlKey: true, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(surface, { pointerId: 102, clientX: 103, clientY: 103 });
    fireEvent.click(canvas, { button: 0, ctrlKey: true, clientX: 103, clientY: 103 });
    expect(screen.getByTestId("history-location")).toHaveTextContent(/^\/$/u);
    expect(capture.setPointerCapture).toHaveBeenCalledTimes(1);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(102);
    expect(surface).not.toHaveClass("history-panning");
  });

  it("composes an immediate arrow and new pan from a just-selected camera before rerender", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    installPointerCapture(surface);
    fixedSurfaceRect(surface);
    const canvas = view.container.querySelector("svg");
    if (canvas === null) throw new Error("History canvas is unavailable");
    const start = viewBoxCameraCenter(view.container);
    const startScale = DEFAULT_VIEWPORT.width / start.width;
    const constraints = canonicalCamera(layout, DEFAULT_VIEWPORT);
    const selectedWidth = 600 / startScale;
    const selectedHeight = 200 / startScale;
    const selectedScale = Math.min(
      constraints.maxScale,
      Math.max(constraints.minScale, Math.min(
        (DEFAULT_VIEWPORT.width - 48) / selectedWidth,
        (DEFAULT_VIEWPORT.height - 48) / selectedHeight,
      )),
    );
    const selectedCenterX = start.x + (400 - DEFAULT_VIEWPORT.width / 2) / startScale;

    act(() => {
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 102,
        button: 0,
        isPrimary: true,
        ctrlKey: true,
        clientX: 100,
        clientY: 100,
      }));
      surface.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId: 102,
        clientX: 700,
        clientY: 300,
      }));
      surface.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "ArrowRight",
      }));
      surface.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 103,
        button: 0,
        isPrimary: true,
        clientX: 100,
        clientY: 100,
      }));
      surface.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        pointerId: 103,
        clientX: 130,
        clientY: 100,
      }));
      surface.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId: 103,
        clientX: 130,
        clientY: 100,
      }));
    });
    flushAnimationFrames();

    expect(viewBoxCameraCenter(view.container).x).toBeCloseTo(
      selectedCenterX + (48 - 30) / selectedScale,
      9,
    );
  });

  it("zooms an immediate wheel from the just-selected camera before rerender", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    installPointerCapture(surface);
    fixedSurfaceRect(surface);
    const canvas = view.container.querySelector("svg");
    if (canvas === null) throw new Error("History canvas is unavailable");
    const start = viewBoxCameraCenter(view.container);
    const startScale = DEFAULT_VIEWPORT.width / start.width;
    const constraints = canonicalCamera(layout, DEFAULT_VIEWPORT);
    const selectedScale = Math.min(
      constraints.maxScale,
      Math.max(constraints.minScale, Math.min(
        (DEFAULT_VIEWPORT.width - 48) / (600 / startScale),
        (DEFAULT_VIEWPORT.height - 48) / (200 / startScale),
      )),
    );
    const wheelPoint = { x: 200, y: 150 };
    const normalizedDelta = -80;
    const expectedScale = Math.min(
      constraints.maxScale,
      Math.max(constraints.minScale, selectedScale * Math.exp(-normalizedDelta * 0.0015)),
    );
    const anchor = {
      x: start.x + (wheelPoint.x - DEFAULT_VIEWPORT.width / 2) / selectedScale,
      y: start.y + (wheelPoint.y - DEFAULT_VIEWPORT.height / 2) / selectedScale,
    };
    const expected: HistoryCamera = {
      centerX: anchor.x - (wheelPoint.x - DEFAULT_VIEWPORT.width / 2) / expectedScale,
      centerY: anchor.y - (wheelPoint.y - DEFAULT_VIEWPORT.height / 2) / expectedScale,
      scale: expectedScale,
      viewportWidth: DEFAULT_VIEWPORT.width,
      viewportHeight: DEFAULT_VIEWPORT.height,
      mode: "manual",
    };
    let wheelEvent: WheelEvent | undefined;

    act(() => {
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 110,
        button: 0,
        isPrimary: true,
        ctrlKey: true,
        clientX: 150,
        clientY: 180,
      }));
      surface.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId: 110,
        clientX: 750,
        clientY: 380,
      }));
      wheelEvent = dispatchNativeWheel(surface, {
        clientX: wheelPoint.x,
        clientY: wheelPoint.y,
        deltaY: normalizedDelta,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      });
    });

    expect(wheelEvent?.defaultPrevented).toBe(true);
    expect(animationFrames.size).toBe(1);
    flushAnimationFrames();
    const actual = viewBoxCameraCenter(view.container);
    expect(actual.x).toBeCloseTo(expected.centerX, 10);
    expect(actual.y).toBeCloseTo(expected.centerY, 10);
    expect(actual.width).toBeCloseTo(DEFAULT_VIEWPORT.width / expected.scale, 10);
    expect(actual.height).toBeCloseTo(DEFAULT_VIEWPORT.height / expected.scale, 10);
  });

  it("fits an immediate second Ctrl selection from the first selected camera before rerender", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const capture = installPointerCapture(surface);
    fixedSurfaceRect(surface);
    const canvas = view.container.querySelector("svg");
    if (canvas === null) throw new Error("History canvas is unavailable");
    const start = viewBoxCameraCenter(view.container);
    const startScale = DEFAULT_VIEWPORT.width / start.width;
    const constraints = canonicalCamera(layout, DEFAULT_VIEWPORT);
    const firstScale = Math.min(
      constraints.maxScale,
      Math.max(constraints.minScale, Math.min(
        (DEFAULT_VIEWPORT.width - 48) / (600 / startScale),
        (DEFAULT_VIEWPORT.height - 48) / (200 / startScale),
      )),
    );
    const secondScale = Math.min(
      constraints.maxScale,
      Math.max(constraints.minScale, Math.min(
        (DEFAULT_VIEWPORT.width - 48) / (300 / firstScale),
        (DEFAULT_VIEWPORT.height - 48) / (160 / firstScale),
      )),
    );
    const expected: HistoryCamera = {
      centerX: start.x,
      centerY: start.y,
      scale: secondScale,
      viewportWidth: DEFAULT_VIEWPORT.width,
      viewportHeight: DEFAULT_VIEWPORT.height,
      mode: "manual",
    };

    act(() => {
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 111,
        button: 0,
        isPrimary: true,
        ctrlKey: true,
        clientX: 150,
        clientY: 180,
      }));
      surface.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId: 111,
        clientX: 750,
        clientY: 380,
      }));
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 112,
        button: 0,
        isPrimary: true,
        ctrlKey: true,
        clientX: 300,
        clientY: 200,
      }));
      surface.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId: 112,
        clientX: 600,
        clientY: 360,
      }));
    });

    expect(capture.setPointerCapture).toHaveBeenNthCalledWith(1, 111);
    expect(capture.setPointerCapture).toHaveBeenNthCalledWith(2, 112);
    const actual = viewBoxCameraCenter(view.container);
    expect(actual.x).toBeCloseTo(expected.centerX, 10);
    expect(actual.y).toBeCloseTo(expected.centerY, 10);
    expect(actual.width).toBeCloseTo(DEFAULT_VIEWPORT.width / expected.scale, 10);
    expect(actual.height).toBeCloseTo(DEFAULT_VIEWPORT.height / expected.scale, 10);
  });

  it("cleans pending selection RAF, overlay, and capture on Fit, geometry, resize, and unmount", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const capture = installPointerCapture(surface);
    fixedSurfaceRect(surface);

    const begin = (pointerId: number) => {
      const canvas = view.container.querySelector("svg");
      if (canvas === null) throw new Error("History canvas is unavailable");
      fireEvent.pointerDown(canvas, {
        pointerId,
        button: 0,
        isPrimary: true,
        ctrlKey: true,
        clientX: 100,
        clientY: 100,
      });
      fireEvent.pointerMove(surface, { pointerId, clientX: 300, clientY: 250 });
      expect(animationFrames.size).toBe(1);
    };

    begin(104);
    fireEvent.click(screen.getByRole("button", { name: "Fit current (F)" }));
    expect(animationFrames.size).toBe(0);
    expect(surface).not.toHaveClass("history-selecting");

    begin(105);
    const changed: TimelineLayout = {
      ...layout,
      nodes: layout.nodes.map((node) => node.treatment === "current" ? { ...node, x: node.x + 500 } : node),
    };
    view.rerender(historyUi(changed));
    expect(animationFrames.size).toBe(0);

    begin(106);
    measure({ width: 1_100, height: 640 });
    expect(animationFrames.size).toBe(0);

    fixedSurfaceRect(surface, { width: 1_100, height: 640 });
    begin(107);
    view.unmount();
    expect(animationFrames.size).toBe(0);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(104);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(105);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(106);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(107);
    expect(vi.mocked(cancelAnimationFrame)).toHaveBeenCalled();
  });

  it("converts 48px and 160px keyboard deltas through scale in all four documented directions", () => {
    const navigationBounds = { left: 0, top: 0, right: 1_000, bottom: 800 };
    const camera: HistoryCamera = {
      centerX: 500,
      centerY: 400,
      scale: 2,
      viewportWidth: 200,
      viewportHeight: 100,
      mode: "canonical",
    };

    expect(panHistoryCameraByScreenDelta(camera, 48, 0, navigationBounds)).toMatchObject({ centerX: 524, centerY: 400, mode: "manual" });
    expect(panHistoryCameraByScreenDelta(camera, -48, 0, navigationBounds)).toMatchObject({ centerX: 476, centerY: 400, mode: "manual" });
    expect(panHistoryCameraByScreenDelta(camera, 0, 48, navigationBounds)).toMatchObject({ centerX: 500, centerY: 424, mode: "manual" });
    expect(panHistoryCameraByScreenDelta(camera, 0, -48, navigationBounds)).toMatchObject({ centerX: 500, centerY: 376, mode: "manual" });
    expect(panHistoryCameraByScreenDelta(camera, 160, 0, navigationBounds).centerX).toBe(580);
    expect(panHistoryCameraByScreenDelta({ ...camera, scale: 0.5 }, 48, 0, navigationBounds).centerX).toBe(596);
  });

  it("clamps screen-delta panning continuously at every navigation edge and corner", () => {
    const navigationBounds = { left: 0, top: 0, right: 1_000, bottom: 800 };
    const camera: HistoryCamera = {
      centerX: 500,
      centerY: 400,
      scale: 2,
      viewportWidth: 200,
      viewportHeight: 100,
      mode: "canonical",
    };

    expect(panHistoryCameraByScreenDelta(camera, -10_000, -10_000, navigationBounds)).toMatchObject({ centerX: 50, centerY: 25 });
    expect(panHistoryCameraByScreenDelta(camera, 10_000, -10_000, navigationBounds)).toMatchObject({ centerX: 950, centerY: 25 });
    expect(panHistoryCameraByScreenDelta(camera, -10_000, 10_000, navigationBounds)).toMatchObject({ centerX: 50, centerY: 775 });
    expect(panHistoryCameraByScreenDelta(camera, 10_000, 10_000, navigationBounds)).toMatchObject({ centerX: 950, centerY: 775 });
  });

  it("handles surface and milestone-descendant arrows, prevents scrolling, and supports Shift fast pan", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    zoomHistoryIn(surface);
    const initial = viewBoxCameraCenter(view.container);
    const scale = DEFAULT_VIEWPORT.width / initial.width;

    expect(fireEvent.keyDown(surface, { key: "ArrowLeft" })).toBe(false);
    expect(viewBoxCameraCenter(view.container).x).toBeCloseTo(initial.x - 48 / scale, 10);

    const afterLeft = viewBoxCameraCenter(view.container);
    expect(fireEvent.keyDown(surface, { key: "ArrowLeft", shiftKey: true })).toBe(false);
    expect(viewBoxCameraCenter(view.container).x).toBeCloseTo(afterLeft.x - 160 / scale, 10);

    const milestone = screen.getByRole("link", { name: /CORE-003/u });
    expect(fireEvent.keyDown(milestone, { key: "ArrowRight" })).toBe(false);
    expect(viewBoxCameraCenter(view.container).x).toBeCloseTo(afterLeft.x - 112 / scale, 10);

    expect(fireEvent.keyDown(surface, { key: "ArrowUp" })).toBe(false);
    expect(fireEvent.keyDown(surface, { key: "ArrowDown" })).toBe(false);
  });

  it("applies all four scoped arrow directions and Shift fast steps from surface or node focus", () => {
    const view = renderHistory();
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const milestone = screen.getByRole("link", { name: /CORE-003/u });
    dispatchNativeWheel(surface, {
      deltaY: -500,
      clientX: DEFAULT_VIEWPORT.width / 2,
      clientY: DEFAULT_VIEWPORT.height / 2,
    });
    flushAnimationFrames();
    const start = viewBoxCameraCenter(view.container);
    const scale = DEFAULT_VIEWPORT.width / start.width;

    expect(fireEvent.keyDown(surface, { key: "ArrowRight" })).toBe(false);
    expect(viewBoxCameraCenter(view.container).x).toBeCloseTo(start.x + 48 / scale, 10);
    expect(fireEvent.keyDown(surface, { key: "ArrowLeft" })).toBe(false);
    expect(viewBoxCameraCenter(view.container).x).toBeCloseTo(start.x, 10);

    milestone.focus();
    expect(fireEvent.keyDown(milestone, { key: "ArrowDown" })).toBe(false);
    expect(viewBoxCameraCenter(view.container).y).toBeCloseTo(start.y + 48 / scale, 10);
    expect(fireEvent.keyDown(milestone, { key: "ArrowUp" })).toBe(false);
    expect(viewBoxCameraCenter(view.container).y).toBeCloseTo(start.y, 10);

    expect(fireEvent.keyDown(milestone, { key: "ArrowRight", shiftKey: true })).toBe(false);
    expect(viewBoxCameraCenter(view.container).x).toBeCloseTo(start.x + 160 / scale, 10);
    expect(fireEvent.keyDown(milestone, { key: "ArrowLeft", shiftKey: true })).toBe(false);
    expect(viewBoxCameraCenter(view.container).x).toBeCloseTo(start.x, 10);
    expect(milestone).toHaveFocus();
  });

  it("ignores editable targets, unsupported keys, and modified arrow combinations", () => {
    const view = renderHistory();
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const initialViewBox = view.container.querySelector("svg")?.getAttribute("viewBox");
    const input = document.createElement("input");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    surface.append(input, editable);

    expect(fireEvent.keyDown(input, { key: "ArrowLeft" })).toBe(true);
    expect(fireEvent.keyDown(editable, { key: "ArrowRight" })).toBe(true);
    expect(fireEvent.keyDown(surface, { key: "ArrowLeft", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(surface, { key: "ArrowLeft", altKey: true })).toBe(true);
    expect(fireEvent.keyDown(surface, { key: "ArrowLeft", metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(surface, { key: "Home" })).toBe(true);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", initialViewBox);
  });

  it("fits only with unmodified F and reserves Shift+F for fullscreen", () => {
    const layout = canonicalHistoryLayout();
    const windowScrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const milestone = screen.getByRole("link", { name: /CORE-003/u });
    const containerScrollTo = vi.fn();
    Object.defineProperty(surface, "scrollTo", { configurable: true, value: containerScrollTo });
    const canonicalViewBox = expectedCanonicalViewBox(layout, DEFAULT_VIEWPORT);

    surface.focus();
    fireEvent.keyDown(surface, { key: "ArrowLeft" });
    expect(view.container.querySelector("svg")).not.toHaveAttribute("viewBox", canonicalViewBox);
    expect(fireEvent.keyDown(surface, { key: "f" })).toBe(false);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", canonicalViewBox);
    expect(surface).toHaveFocus();
    const firstAnnouncement = screen.getByRole("status").querySelector("span");
    expect(firstAnnouncement).toHaveTextContent(/^History view fitted to current state$/u);

    milestone.focus();
    fireEvent.keyDown(milestone, { key: "ArrowLeft" });
    expect(view.container.querySelector("svg")).not.toHaveAttribute("viewBox", canonicalViewBox);
    expect(fireEvent.keyDown(milestone, { key: "F", shiftKey: true })).toBe(false);
    expect(requestFullscreenMock).toHaveBeenCalledOnce();
    expect(view.container.querySelector("svg")).not.toHaveAttribute("viewBox", canonicalViewBox);
    expect(milestone).toHaveFocus();
    expect(screen.getByRole("button", { name: "Enter fullscreen (Shift+F)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("status").querySelector("span")).toBe(firstAnnouncement);
    expect(windowScrollTo).not.toHaveBeenCalled();
    expect(containerScrollTo).not.toHaveBeenCalled();
  });

  it("derives fullscreen state from fullscreenchange and frames normalized zoom through entry, resize, and exit", () => {
    const view = renderHistory();
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    fireEvent.keyDown(surface, { key: "ArrowLeft" });
    const before = viewBoxCameraCenter(view.container);
    const beforeScale = DEFAULT_VIEWPORT.width / before.width;
    const beforeCamera: HistoryCamera = {
      centerX: before.x,
      centerY: before.y,
      scale: beforeScale,
      viewportWidth: DEFAULT_VIEWPORT.width,
      viewportHeight: DEFAULT_VIEWPORT.height,
      mode: "manual",
    };
    const minimap = screen.getByTestId("history-minimap") as unknown as SVGSVGElement;

    expect(fireEvent.keyDown(surface, { key: "F", shiftKey: true })).toBe(false);
    expect(requestFullscreenMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Enter fullscreen (Shift+F)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    const fullscreenViewport = { width: 1_920, height: 1_080 };
    mockFullscreenElement = surface;
    measure(fullscreenViewport);
    dispatchFullscreenChange(surface);
    const entered = viewBoxCameraCenter(view.container);
    const entryFactor = historyFullscreenFramingFactor(DEFAULT_VIEWPORT, fullscreenViewport);
    expect(entered.x).toBeCloseTo(before.x, 10);
    expect(entered.y).toBeCloseTo(before.y, 10);
    expect(fullscreenViewport.width / entered.width).toBeCloseTo(beforeScale * entryFactor, 10);
    const baselineConstraints = canonicalCamera(canonicalHistoryLayout(), DEFAULT_VIEWPORT);
    const fullscreenSession = captureHistoryFullscreenSession(
      beforeCamera,
      baselineConstraints.minScale,
      baselineConstraints.maxScale,
    );
    const enteredTransition = transitionHistoryCameraForFullscreen(
      fullscreenSession,
      canonicalHistoryLayout(),
      fullscreenViewport,
    );
    expectIntegratedMinimapRect(
      minimap,
      { ...enteredTransition.pose, viewportWidth: fullscreenViewport.width, viewportHeight: fullscreenViewport.height, mode: "manual" },
      enteredTransition.navigationBounds,
    );
    expect(screen.getByRole("button", { name: "Exit fullscreen (Esc)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Exit fullscreen (Esc)" })).toHaveAttribute(
      "title",
      "Exit fullscreen (Esc)",
    );
    expect(screen.getByRole("status")).toHaveTextContent(/^History fullscreen entered$/u);

    const resizedFullscreen = { width: 2_560, height: 1_440 };
    measure(resizedFullscreen);
    const resized = viewBoxCameraCenter(view.container);
    const resizedFactor = historyFullscreenFramingFactor(DEFAULT_VIEWPORT, resizedFullscreen);
    expect(resized.x).toBeCloseTo(before.x, 10);
    expect(resized.y).toBeCloseTo(before.y, 10);
    expect(resizedFullscreen.width / resized.width).toBeCloseTo(beforeScale * resizedFactor, 10);
    const resizedTransition = transitionHistoryCameraForFullscreen(
      fullscreenSession,
      canonicalHistoryLayout(),
      resizedFullscreen,
    );
    expectIntegratedMinimapRect(
      minimap,
      { ...resizedTransition.pose, viewportWidth: resizedFullscreen.width, viewportHeight: resizedFullscreen.height, mode: "manual" },
      resizedTransition.navigationBounds,
    );

    fireEvent.click(screen.getByRole("button", { name: "Exit fullscreen (Esc)" }));
    expect(exitFullscreenMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Exit fullscreen (Esc)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    dispatchFullscreenChange(null);
    measure(DEFAULT_VIEWPORT);
    const exited = viewBoxCameraCenter(view.container);
    expect(exited.x).toBeCloseTo(before.x, 10);
    expect(exited.y).toBeCloseTo(before.y, 10);
    expect(DEFAULT_VIEWPORT.width / exited.width).toBeCloseTo(beforeScale, 10);
    expect(screen.getByRole("button", { name: "Enter fullscreen (Shift+F)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("status")).toHaveTextContent(/^History fullscreen exited$/u);
  });

  it("normalizes fullscreen wheel zoom across repeated resizes and captures a fresh second-entry baseline", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    fireEvent.keyDown(surface, { key: "ArrowLeft" });
    const preview = historyCameraFromRenderedViewBox(view.container, DEFAULT_VIEWPORT);

    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen (Shift+F)" }));
    const firstFullscreen = { width: 1_920, height: 1_080 };
    mockFullscreenElement = surface;
    measure(firstFullscreen);
    dispatchFullscreenChange(surface);
    dispatchNativeWheel(surface, {
      deltaY: -180,
      clientX: firstFullscreen.width / 2,
      clientY: firstFullscreen.height / 2,
    });
    flushAnimationFrames();
    const zoomed = historyCameraFromRenderedViewBox(view.container, firstFullscreen);
    const normalizedZoom = zoomed.scale / historyFullscreenFramingFactor(DEFAULT_VIEWPORT, firstFullscreen);

    const resizedFullscreen = { width: 2_560, height: 1_440 };
    measure(resizedFullscreen);
    const resized = historyCameraFromRenderedViewBox(view.container, resizedFullscreen);
    expect(resized.centerX).toBeCloseTo(zoomed.centerX, 10);
    expect(resized.centerY).toBeCloseTo(zoomed.centerY, 10);
    expect(resized.scale).toBeCloseTo(
      normalizedZoom * historyFullscreenFramingFactor(DEFAULT_VIEWPORT, resizedFullscreen),
      10,
    );

    mockFullscreenElement = null;
    measure(DEFAULT_VIEWPORT);
    dispatchFullscreenChange(null);
    const exited = historyCameraFromRenderedViewBox(view.container, DEFAULT_VIEWPORT);
    expect(exited.centerX).toBeCloseTo(zoomed.centerX, 10);
    expect(exited.centerY).toBeCloseTo(zoomed.centerY, 10);
    expect(exited.scale).toBeCloseTo(normalizedZoom, 10);
    expect(exited.scale).toBeGreaterThan(preview.scale);

    const resizedPreview = { width: 1_180, height: 690 };
    measure(resizedPreview);
    const secondBaseline = historyCameraFromRenderedViewBox(view.container, resizedPreview);
    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen (Shift+F)" }));
    mockFullscreenElement = surface;
    measure(firstFullscreen);
    dispatchFullscreenChange(surface);
    const secondEntry = historyCameraFromRenderedViewBox(view.container, firstFullscreen);
    expect(secondEntry.centerX).toBeCloseTo(secondBaseline.centerX, 10);
    expect(secondEntry.centerY).toBeCloseTo(secondBaseline.centerY, 10);
    expect(secondEntry.scale).toBeCloseTo(
      secondBaseline.scale * historyFullscreenFramingFactor(resizedPreview, firstFullscreen),
      10,
    );
    expect(secondEntry.scale).not.toBeCloseTo(
      secondBaseline.scale * historyFullscreenFramingFactor(DEFAULT_VIEWPORT, firstFullscreen),
      6,
    );
  });

  it("restores and disposes a fullscreen session when exit emits no resize measurement", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    zoomHistoryIn(surface, -320);
    fireEvent.keyDown(surface, { key: "ArrowLeft" });

    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen (Shift+F)" }));
    const fullscreenViewport = { width: 1_920, height: 1_080 };
    mockFullscreenElement = surface;
    measure(fullscreenViewport);
    dispatchFullscreenChange(surface);
    dispatchNativeWheel(surface, {
      deltaY: -180,
      clientX: fullscreenViewport.width / 2,
      clientY: fullscreenViewport.height / 2,
    });
    flushAnimationFrames();
    fireEvent.keyDown(surface, { key: "ArrowRight" });
    const fullscreenCamera = historyCameraFromRenderedViewBox(view.container, fullscreenViewport);
    const normalizedZoom = fullscreenCamera.scale /
      historyFullscreenFramingFactor(DEFAULT_VIEWPORT, fullscreenViewport);

    const eventOnlyPreview = { width: 1_376, height: 558 };
    Object.defineProperties(surface, {
      clientWidth: { configurable: true, value: eventOnlyPreview.width },
      clientHeight: { configurable: true, value: eventOnlyPreview.height },
    });
    fixedSurfaceRect(surface, {
      width: eventOnlyPreview.width,
      height: eventOnlyPreview.height + 2,
    });
    dispatchFullscreenChange(null);

    const restored = historyCameraFromRenderedViewBox(view.container, eventOnlyPreview);
    expect(restored.centerX).toBeCloseTo(fullscreenCamera.centerX, 10);
    expect(restored.centerY).toBeCloseTo(fullscreenCamera.centerY, 10);
    expect(restored.scale).toBeCloseTo(normalizedZoom, 10);
    expect(screen.getByRole("button", { name: "Enter fullscreen (Shift+F)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "Fit current (F)" }));
    expect(view.container.querySelector(".history-canvas")).toHaveAttribute(
      "viewBox",
      expectedCanonicalViewBox(layout, eventOnlyPreview),
    );
    const fittedPreview = historyCameraFromRenderedViewBox(view.container, eventOnlyPreview);

    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen (Shift+F)" }));
    mockFullscreenElement = surface;
    measure(fullscreenViewport);
    dispatchFullscreenChange(surface);
    const secondEntry = historyCameraFromRenderedViewBox(view.container, fullscreenViewport);
    expect(secondEntry.centerX).toBeCloseTo(fittedPreview.centerX, 10);
    expect(secondEntry.centerY).toBeCloseTo(fittedPreview.centerY, 10);
    expect(secondEntry.scale).toBeCloseTo(
      fittedPreview.scale * historyFullscreenFramingFactor(eventOnlyPreview, fullscreenViewport),
      10,
    );
  });

  it("preserves pose when browser exit resize arrives before fullscreenchange", () => {
    const view = renderHistory();
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    fireEvent.keyDown(surface, { key: "ArrowLeft" });
    const before = viewBoxCameraCenter(view.container);
    const scale = DEFAULT_VIEWPORT.width / before.width;
    dispatchFullscreenChange(surface);
    measure({ width: 1_800, height: 1_000 });

    mockFullscreenElement = null;
    measure(DEFAULT_VIEWPORT);
    dispatchFullscreenChange(null);
    const exited = viewBoxCameraCenter(view.container);
    expect(exited.x).toBeCloseTo(before.x, 10);
    expect(exited.y).toBeCloseTo(before.y, 10);
    expect(DEFAULT_VIEWPORT.width / exited.width).toBeCloseTo(scale, 10);

    const ordinaryResize = { width: 1_100, height: 640 };
    const expected = transitionHistoryCameraForResize(
      historyCameraFromRenderedViewBox(view.container, DEFAULT_VIEWPORT),
      canonicalHistoryLayout(),
      ordinaryResize,
    );
    measure(ordinaryResize);
    const ordinary = historyCameraFromRenderedViewBox(view.container, ordinaryResize);
    expect(ordinary.centerX).toBeCloseTo(expected.centerX, 10);
    expect(ordinary.centerY).toBeCloseTo(expected.centerY, 10);
    expect(ordinary.scale).toBeCloseTo(expected.scale, 10);
  });

  it("disables unsupported fullscreen and reports request or exit rejection without changing the camera", async () => {
    mockFullscreenEnabled = false;
    const unsupported = renderHistory();
    measure();
    const unsupportedSurface = screen.getByLabelText("Navigable project history timeline");
    const unavailable = screen.getByRole("button", { name: "Fullscreen unavailable" });
    expect(unavailable).toBeDisabled();
    expect(unavailable).toHaveAttribute("title", "Fullscreen unavailable");
    expect(fireEvent.keyDown(unsupportedSurface, { key: "F", shiftKey: true })).toBe(true);
    expect(requestFullscreenMock).not.toHaveBeenCalled();
    unsupported.unmount();

    mockFullscreenEnabled = true;
    requestFullscreenMock.mockRejectedValueOnce(new Error("policy denied"));
    const rejected = renderHistory();
    measure();
    const rejectedSurface = screen.getByLabelText("Navigable project history timeline");
    fireEvent.keyDown(rejectedSurface, { key: "ArrowLeft" });
    const before = rejected.container.querySelector(".history-canvas")?.getAttribute("viewBox");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen (Shift+F)" }));
      await Promise.resolve();
    });
    expect(rejected.container.querySelector(".history-canvas")).toHaveAttribute("viewBox", before);
    expect(screen.getByRole("button", { name: "Enter fullscreen (Shift+F)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("status")).toHaveTextContent(/^Unable to enter fullscreen$/u);
    rejected.unmount();

    const exitRejected = renderHistory();
    measure();
    const exitSurface = screen.getByLabelText("Navigable project history timeline");
    dispatchFullscreenChange(exitSurface);
    const exitBefore = exitRejected.container.querySelector(".history-canvas")?.getAttribute("viewBox");
    exitFullscreenMock.mockRejectedValueOnce(new Error("exit denied"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Exit fullscreen (Esc)" }));
      await Promise.resolve();
    });
    expect(exitRejected.container.querySelector(".history-canvas")).toHaveAttribute("viewBox", exitBefore);
    expect(screen.getByRole("button", { name: "Exit fullscreen (Esc)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("status")).toHaveTextContent(/^Unable to exit fullscreen$/u);
  });

  it("ignores F in editables, with Ctrl/Alt/Meta, and outside the History surface", () => {
    const view = renderHistory();
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const initialViewBox = view.container.querySelector("svg")?.getAttribute("viewBox");
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    surface.append(input, textarea, select, editable);

    for (const target of [input, textarea, select, editable]) {
      expect(fireEvent.keyDown(target, { key: "f" })).toBe(true);
    }
    expect(fireEvent.keyDown(surface, { key: "f", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(surface, { key: "F", altKey: true })).toBe(true);
    expect(fireEvent.keyDown(surface, { key: "f", metaKey: true })).toBe(true);

    const outside = screen.getByTestId("app-main");
    expect(fireEvent.keyDown(outside, { key: "f" })).toBe(true);
    expect(fireEvent.keyDown(outside, { key: "ArrowRight" })).toBe(true);
    expect(fireEvent.keyDown(outside, { key: "Escape" })).toBe(true);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", initialViewBox);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("makes F authoritative over pending wheel, active or ending pan, and rectangle selection", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const capture = installPointerCapture(surface);
    fixedSurfaceRect(surface);
    const canvas = view.container.querySelector("svg");
    if (canvas === null) throw new Error("History canvas is unavailable");
    const canonicalViewBox = expectedCanonicalViewBox(layout, DEFAULT_VIEWPORT);

    dispatchNativeWheel(surface, { deltaY: -100, clientX: 400, clientY: 250 });
    expect(animationFrames.size).toBe(1);
    expect(fireEvent.keyDown(surface, { key: "f" })).toBe(false);
    expect(animationFrames.size).toBe(0);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", canonicalViewBox);

    fireEvent.pointerDown(canvas, { pointerId: 120, button: 0, isPrimary: true, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 120, clientX: 140, clientY: 100 });
    expect(animationFrames.size).toBe(1);
    fireEvent.keyDown(surface, { key: "F" });
    expect(animationFrames.size).toBe(0);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(120);
    expect(surface).not.toHaveClass("history-panning");
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", canonicalViewBox);

    fireEvent.pointerDown(canvas, { pointerId: 121, button: 0, isPrimary: true, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 121, clientX: 140, clientY: 100 });
    flushAnimationFrames();
    fireEvent.pointerUp(surface, { pointerId: 121, clientX: 170, clientY: 100 });
    expect(animationFrames.size).toBe(1);
    fireEvent.keyDown(surface, { key: "f" });
    expect(animationFrames.size).toBe(0);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(121);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", canonicalViewBox);

    fireEvent.pointerDown(canvas, {
      pointerId: 122,
      button: 0,
      isPrimary: true,
      ctrlKey: true,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(surface, { pointerId: 122, clientX: 300, clientY: 240 });
    flushAnimationFrames();
    expect(screen.getByTestId("history-selection-rectangle")).toBeInTheDocument();
    fireEvent.keyDown(surface, { key: "F" });
    expect(animationFrames.size).toBe(0);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(122);
    expect(screen.queryByTestId("history-selection-rectangle")).not.toBeInTheDocument();
    expect(surface).not.toHaveClass("history-selecting");
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", canonicalViewBox);

    flushAnimationFrames();
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", canonicalViewBox);
  });

  it("makes F authoritative after a wheel RAF enters committing state but before React renders", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const canonicalViewBox = expectedCanonicalViewBox(layout, DEFAULT_VIEWPORT);
    const canonicalCenter = viewBoxCameraCenter(view.container);
    const canonicalScale = DEFAULT_VIEWPORT.width / canonicalCenter.width;

    dispatchNativeWheel(surface, {
      deltaY: -120,
      clientX: DEFAULT_VIEWPORT.width / 2,
      clientY: DEFAULT_VIEWPORT.height / 2,
    });
    const queued = [...animationFrames.entries()];
    expect(queued).toHaveLength(1);
    const [frameId, frameCallback] = queued[0]!;
    animationFrames.delete(frameId);
    let keyEvent: KeyboardEvent | undefined;

    act(() => {
      frameCallback(16.67);
      // React has not committed the RAF camera yet; the SVG still proves this
      // is the post-RAF/pre-render committing interval rather than pending RAF.
      expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", canonicalViewBox);
      keyEvent = new KeyboardEvent("keydown", {
        key: "f",
        bubbles: true,
        cancelable: true,
      });
      expect(surface.dispatchEvent(keyEvent)).toBe(false);
      expect(keyEvent.defaultPrevented).toBe(true);
    });

    expect(animationFrames.size).toBe(0);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", canonicalViewBox);
    expect(screen.getByRole("status")).toHaveTextContent(/^History view fitted to current state$/u);
    flushAnimationFrames();
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", canonicalViewBox);

    zoomHistoryIn(surface);
    const zoomedCenter = viewBoxCameraCenter(view.container);
    const zoomedScale = DEFAULT_VIEWPORT.width / zoomedCenter.width;
    expect(fireEvent.keyDown(surface, { key: "ArrowLeft" })).toBe(false);
    const afterArrow = viewBoxCameraCenter(view.container);
    expect(afterArrow.x).toBeCloseTo(zoomedCenter.x - 48 / zoomedScale, 10);
    expect(afterArrow.y).toBeCloseTo(zoomedCenter.y, 10);
  });

  it("preserves a manual pan through presentation/theme/detail rerenders and transitions it from latest bounds on resize", async () => {
    const user = userEvent.setup();
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    fireEvent.keyDown(surface, { key: "ArrowLeft" });
    const manualBox = viewBoxCameraCenter(view.container);
    const manualCamera: HistoryCamera = {
      centerX: manualBox.x,
      centerY: manualBox.y,
      scale: DEFAULT_VIEWPORT.width / manualBox.width,
      viewportWidth: DEFAULT_VIEWPORT.width,
      viewportHeight: DEFAULT_VIEWPORT.height,
      mode: "manual",
    };
    const manualViewBox = view.container.querySelector("svg")?.getAttribute("viewBox");
    const presentationChange: TimelineLayout = {
      ...layout,
      nodes: layout.nodes.map((node, index) => index === 0
        ? {
            ...node,
            visibleTitle: "A very long presentation-only label that changes bounds but must not reset manual navigation",
            fullTitle: "A very long presentation-only label that changes bounds but must not reset manual navigation",
            status: node.status === "accepted" ? "informational" as const : node.status,
          }
        : node),
    };

    view.rerender(historyUi(presentationChange));
    document.documentElement.dataset.theme = "dark";
    view.rerender(historyUi(presentationChange));
    await user.hover(screen.getByRole("link", { name: /CORE-003/u }));
    fireEvent.focus(screen.getByRole("link", { name: /CORE-003/u }));
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", manualViewBox);

    const resizedViewport = { width: 1_180, height: 690 };
    const expectedLatest = transitionHistoryCameraForResize(manualCamera, presentationChange, resizedViewport);
    const staleOriginal = transitionHistoryCameraForResize(manualCamera, layout, resizedViewport);
    expect(historyCameraViewBox(expectedLatest)).not.toBe(historyCameraViewBox(staleOriginal));
    measure(resizedViewport);
    const actualResized = viewBoxCameraCenter(view.container);
    const expectedVisible = visibleGraphRect(expectedLatest, resizedViewport);
    expect(actualResized.x).toBeCloseTo(expectedLatest.centerX, 10);
    expect(actualResized.y).toBeCloseTo(expectedLatest.centerY, 10);
    expect(actualResized.width).toBeCloseTo(expectedVisible.right - expectedVisible.left, 10);
    expect(actualResized.height).toBeCloseTo(expectedVisible.bottom - expectedVisible.top, 10);
  });

  it("keeps milestone click routing native when no background pan starts", async () => {
    const user = userEvent.setup();
    renderHistory();
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const capture = installPointerCapture(surface);
    const milestone = screen.getByRole("link", { name: /CORE-003/u });
    const href = milestone.getAttribute("href");
    if (href === null) throw new Error("milestone href is unavailable");

    await user.click(milestone);

    expect(capture.setPointerCapture).not.toHaveBeenCalled();
    expect(screen.getByTestId("history-location")).toHaveTextContent(href);
  });

  it("starts capture only for a primary background pointer and leaves links and controls native", () => {
    const view = renderHistory();
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const capture = installPointerCapture(surface);
    const focus = vi.spyOn(surface, "focus");
    const link = screen.getByRole("link", { name: /CORE-003/u });
    const control = document.createElement("button");
    surface.append(control);

    fireEvent.pointerDown(surface, { pointerId: 1, button: 2, isPrimary: true, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(surface, { pointerId: 2, button: 0, isPrimary: false, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(link, { pointerId: 3, button: 0, isPrimary: true, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(control, { pointerId: 4, button: 0, isPrimary: true, clientX: 100, clientY: 100 });
    expect(capture.setPointerCapture).not.toHaveBeenCalled();

    const canvas = view.container.querySelector("svg");
    if (canvas === null) throw new Error("History canvas is unavailable");
    fireEvent.pointerDown(canvas, { pointerId: 5, button: 0, isPrimary: true, clientX: 100, clientY: 100 });
    expect(capture.setPointerCapture).toHaveBeenCalledWith(5);
    expect(surface).toHaveFocus();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    fireEvent.pointerUp(surface, { pointerId: 5, button: 0, clientX: 100, clientY: 100 });
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(5);
  });

  it("keeps sub-threshold movement inert, activates at 5px, and coalesces pointer camera commits per frame", () => {
    const view = renderHistory();
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const capture = installPointerCapture(surface);
    zoomHistoryIn(surface);
    const initial = viewBoxCameraCenter(view.container);
    const initialViewBox = view.container.querySelector("svg")?.getAttribute("viewBox");
    const scale = DEFAULT_VIEWPORT.width / initial.width;
    const requestFrame = vi.mocked(requestAnimationFrame);
    requestFrame.mockClear();

    fireEvent.pointerDown(surface, { pointerId: 10, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 10, clientX: 102, clientY: 104 });
    expect(requestFrame).not.toHaveBeenCalled();
    expect(surface).not.toHaveClass("history-panning");
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", initialViewBox);

    fireEvent.pointerMove(surface, { pointerId: 10, clientX: 103, clientY: 104 });
    expect(requestFrame).toHaveBeenCalledOnce();
    expect(surface).toHaveClass("history-panning");
    fireEvent.pointerMove(surface, { pointerId: 10, clientX: 120, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 10, clientX: 130, clientY: 100 });
    expect(requestFrame).toHaveBeenCalledOnce();
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", initialViewBox);

    flushAnimationFrames();
    expect(viewBoxCameraCenter(view.container).x).toBeCloseTo(initial.x - 30 / scale, 10);

    expect(fireEvent.pointerUp(surface, { pointerId: 10, button: 0, clientX: 130, clientY: 100 })).toBe(false);
    expect(capture.releasePointerCapture).not.toHaveBeenCalled();
    expect(surface).toHaveClass("history-panning");
    flushAnimationFrames();
    expect(surface).not.toHaveClass("history-panning");
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(10);
    expect(screen.getByTestId("history-location")).toHaveTextContent(/^\/$/u);
  });

  it("keeps ending ownership until a differing pointerup pose commits, blocking stale arrows and new pointers", () => {
    const view = renderHistory();
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const capture = installPointerCapture(surface);
    zoomHistoryIn(surface);
    const initial = viewBoxCameraCenter(view.container);
    const scale = DEFAULT_VIEWPORT.width / initial.width;

    fireEvent.pointerDown(surface, { pointerId: 30, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 30, clientX: 130, clientY: 100 });
    flushAnimationFrames();
    expect(viewBoxCameraCenter(view.container).x).toBeCloseTo(initial.x - 30 / scale, 10);

    fireEvent.pointerUp(surface, { pointerId: 30, button: 0, clientX: 160, clientY: 100 });
    expect(animationFrames.size).toBe(1);
    expect(capture.releasePointerCapture).not.toHaveBeenCalledWith(30);
    expect(fireEvent.keyDown(surface, { key: "ArrowRight" })).toBe(false);
    fireEvent.pointerDown(surface, { pointerId: 31, button: 0, clientX: 400, clientY: 100 });
    expect(capture.setPointerCapture).not.toHaveBeenCalledWith(31);
    expect(viewBoxCameraCenter(view.container).x).toBeCloseTo(initial.x - 30 / scale, 10);

    flushAnimationFrames();
    expect(viewBoxCameraCenter(view.container).x).toBeCloseTo(initial.x - 60 / scale, 10);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(30);
    expect(surface).not.toHaveClass("history-panning");

    expect(fireEvent.keyDown(surface, { key: "ArrowRight" })).toBe(false);
    expect(viewBoxCameraCenter(view.container).x).toBeCloseTo(initial.x - 12 / scale, 10);
  });

  it("does not restore an ending gesture when capture is lost before its final RAF", () => {
    const view = renderHistory();
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const capture = installPointerCapture(surface);
    zoomHistoryIn(surface);
    const initial = viewBoxCameraCenter(view.container);
    const scale = DEFAULT_VIEWPORT.width / initial.width;

    fireEvent.pointerDown(surface, { pointerId: 32, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 32, clientX: 130, clientY: 100 });
    flushAnimationFrames();
    fireEvent.pointerUp(surface, { pointerId: 32, clientX: 170, clientY: 100 });
    capture.lose(32);
    fireEvent.lostPointerCapture(surface, { pointerId: 32 });

    expect(viewBoxCameraCenter(view.container).x).toBeCloseTo(initial.x - 30 / scale, 10);
    expect(animationFrames.size).toBe(1);
    flushAnimationFrames();
    expect(viewBoxCameraCenter(view.container).x).toBeCloseTo(initial.x - 70 / scale, 10);
    expect(surface).not.toHaveClass("history-panning");
  });

  it("cancels unflushed active RAF through Escape, pointercancel, lost capture, and Fit Current", () => {
    const view = renderHistory();
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const capture = installPointerCapture(surface);
    const originalViewBox = view.container.querySelector("svg")?.getAttribute("viewBox");

    const beginActive = (pointerId: number) => {
      fireEvent.pointerDown(surface, { pointerId, button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(surface, { pointerId, clientX: 130, clientY: 100 });
      expect(animationFrames.size).toBe(1);
    };

    beginActive(33);
    expect(fireEvent.keyDown(surface, { key: "Escape" })).toBe(false);
    expect(animationFrames.size).toBe(0);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", originalViewBox);

    beginActive(34);
    fireEvent.pointerCancel(surface, { pointerId: 34 });
    expect(animationFrames.size).toBe(0);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", originalViewBox);

    beginActive(35);
    capture.lose(35);
    fireEvent.lostPointerCapture(surface, { pointerId: 35 });
    expect(animationFrames.size).toBe(0);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", originalViewBox);

    beginActive(36);
    fireEvent.click(screen.getByRole("button", { name: "Fit current (F)" }));
    expect(animationFrames.size).toBe(0);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", originalViewBox);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(33);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(34);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(36);
  });

  it("cancels an unflushed ending RAF through Escape, pointercancel, Fit, and lifecycle replacement", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    installPointerCapture(surface);
    const originalViewBox = view.container.querySelector("svg")?.getAttribute("viewBox");

    const beginEnding = (pointerId: number) => {
      fireEvent.pointerDown(surface, { pointerId, button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(surface, { pointerId, clientX: 130, clientY: 100 });
      flushAnimationFrames();
      fireEvent.pointerUp(surface, { pointerId, clientX: 160, clientY: 100 });
      expect(animationFrames.size).toBe(1);
    };

    beginEnding(37);
    fireEvent.keyDown(surface, { key: "Escape" });
    expect(animationFrames.size).toBe(0);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", originalViewBox);

    beginEnding(38);
    fireEvent.pointerCancel(surface, { pointerId: 38 });
    expect(animationFrames.size).toBe(0);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", originalViewBox);

    beginEnding(39);
    fireEvent.click(screen.getByRole("button", { name: "Fit current (F)" }));
    expect(animationFrames.size).toBe(0);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", originalViewBox);

    beginEnding(40);
    const changed: TimelineLayout = {
      ...layout,
      nodes: layout.nodes.map((node) => node.treatment === "current" ? { ...node, x: node.x + 500 } : node),
    };
    view.rerender(historyUi(changed));
    expect(animationFrames.size).toBe(0);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", expectedCanonicalViewBox(changed, DEFAULT_VIEWPORT));
  });

  it("uses grab direction and clamps pointer movement at both horizontal boundaries", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    installPointerCapture(surface);
    const constraints = canonicalCamera(layout, DEFAULT_VIEWPORT);
    const halfWidth = DEFAULT_VIEWPORT.width / (2 * constraints.pose.scale);

    fireEvent.pointerDown(surface, { pointerId: 11, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 11, clientX: 1_000_000, clientY: 100 });
    flushAnimationFrames();
    expect(viewBoxCameraCenter(view.container).x).toBeCloseTo(constraints.navigationBounds.left + halfWidth, 8);

    fireEvent.pointerMove(surface, { pointerId: 11, clientX: -1_000_000, clientY: 100 });
    flushAnimationFrames();
    expect(viewBoxCameraCenter(view.container).x).toBeCloseTo(constraints.navigationBounds.right - halfWidth, 8);
    fireEvent.pointerUp(surface, { pointerId: 11, clientX: -1_000_000, clientY: 100 });
    flushAnimationFrames();
  });

  it("restores the exact pre-gesture camera on pointercancel and Escape for pending or active pans", () => {
    const view = renderHistory();
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const capture = installPointerCapture(surface);
    const originalViewBox = view.container.querySelector("svg")?.getAttribute("viewBox");

    fireEvent.pointerDown(surface, { pointerId: 12, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 12, clientX: 104, clientY: 100 });
    expect(fireEvent.keyDown(surface, { key: "Escape" })).toBe(false);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", originalViewBox);

    fireEvent.pointerDown(surface, { pointerId: 13, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 13, clientX: 130, clientY: 100 });
    flushAnimationFrames();
    expect(view.container.querySelector("svg")).not.toHaveAttribute("viewBox", originalViewBox);
    fireEvent.pointerCancel(surface, { pointerId: 13 });
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", originalViewBox);

    fireEvent.pointerDown(surface, { pointerId: 14, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 14, clientX: 130, clientY: 100 });
    flushAnimationFrames();
    expect(fireEvent.keyDown(surface, { key: "Escape" })).toBe(false);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", originalViewBox);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(12);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(13);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(14);
  });

  it("restores on unexpected lost capture and cancels RAF/capture on unmount", () => {
    const first = renderHistory();
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const capture = installPointerCapture(surface);
    const originalViewBox = first.container.querySelector("svg")?.getAttribute("viewBox");

    fireEvent.pointerDown(surface, { pointerId: 15, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 15, clientX: 130, clientY: 100 });
    flushAnimationFrames();
    capture.lose(15);
    fireEvent.lostPointerCapture(surface, { pointerId: 15 });
    expect(first.container.querySelector("svg")).toHaveAttribute("viewBox", originalViewBox);

    fireEvent.pointerDown(surface, { pointerId: 16, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 16, clientX: 130, clientY: 100 });
    expect(animationFrames.size).toBe(1);
    first.unmount();
    expect(animationFrames.size).toBe(0);
    expect(vi.mocked(cancelAnimationFrame)).toHaveBeenCalled();
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(16);
  });

  it("interrupts pending pans on geometry reset and resize without leaving capture, RAF, or cursor state", () => {
    const layout = canonicalHistoryLayout();
    const view = renderHistory(layout);
    measure();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const capture = installPointerCapture(surface);

    fireEvent.pointerDown(surface, { pointerId: 17, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 17, clientX: 130, clientY: 100 });
    const changed: TimelineLayout = {
      ...layout,
      nodes: layout.nodes.map((node) => node.treatment === "current" ? { ...node, x: node.x + 500 } : node),
    };
    view.rerender(historyUi(changed));
    expect(animationFrames.size).toBe(0);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(17);
    expect(surface).not.toHaveClass("history-panning");
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", expectedCanonicalViewBox(changed, DEFAULT_VIEWPORT));

    fireEvent.pointerDown(surface, { pointerId: 18, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 18, clientX: 130, clientY: 100 });
    measure({ width: 1_100, height: 640 });
    expect(animationFrames.size).toBe(0);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(18);
    expect(surface).not.toHaveClass("history-panning");
    expect(view.container.querySelector("svg")).toHaveAttribute(
      "viewBox",
      expectedCanonicalViewBox(changed, { width: 1_100, height: 640 }),
    );
  });

  it("centers currentless History on meaningful content without inferring a current node", () => {
    const layout = currentlessLayout();
    const view = renderHistory(layout);
    measure();

    const canonical = canonicalCamera(layout, DEFAULT_VIEWPORT);
    expect(canonical.currentNodeId).toBeUndefined();
    expect(canonical.pose.centerX).toBeCloseTo(
      (canonical.contentBounds.left + canonical.contentBounds.right) / 2,
      10,
    );
    expect(view.container.querySelector("svg")).toHaveAttribute(
      "viewBox",
      expectedCanonicalViewBox(layout, DEFAULT_VIEWPORT),
    );
    expect(screen.queryByRole("button", { name: "Fit current (F)" })).not.toBeInTheDocument();
    expect(view.container.querySelector(".history-node-current")).not.toBeInTheDocument();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const currentlessViewBox = view.container.querySelector("svg")?.getAttribute("viewBox");
    expect(fireEvent.keyDown(surface, { key: "f" })).toBe(true);
    expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", currentlessViewBox);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("fits current, focuses only canvas, announces recovery, and never scrolls", async () => {
    const user = userEvent.setup();
    const windowScrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    renderHistory();
    measure();
    const viewport = screen.getByLabelText("Navigable project history timeline");
    const containerScrollTo = vi.fn();
    const focus = vi.spyOn(viewport, "focus");
    Object.defineProperty(viewport, "scrollTo", { configurable: true, value: containerScrollTo });

    await user.click(screen.getByRole("button", { name: "Fit current (F)" }));

    expect(viewport).toHaveFocus();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(screen.getByRole("link", { name: /TIM-004/u })).not.toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(/^History view fitted to current state$/u);
    expect(windowScrollTo).not.toHaveBeenCalled();
    expect(containerScrollTo).not.toHaveBeenCalled();
  });

  it("disconnects its ResizeObserver on unmount", () => {
    const view = renderHistory();
    const observer = latestObserver();
    expect(observer.observe).toHaveBeenCalledWith(screen.getByLabelText("Navigable project history timeline"));

    view.unmount();

    expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  it("reveals same compact details through hover and keyboard focus", async () => {
    const user = userEvent.setup();
    const view = renderHistory();
    measure();
    const milestone = screen.getByRole("link", { name: /CORE-003/u });
    expect(view.container.querySelector(".history-detail-surface")).not.toBeInTheDocument();

    await user.hover(milestone);
    const detailSurface = view.container.querySelector(".history-detail-surface");
    expect(detailSurface).toBeVisible();
    expect(detailSurface?.parentElement).toBe(screen.getByLabelText("Navigable project history timeline"));
    expect(screen.getByText("Regression Introduced", { selector: "strong" })).toBeVisible();
    expect(screen.getByText("2026-04-20T16:47:21+02:00")).toBeVisible();
    expect(screen.getByText("Original path · BR-MAIN")).toBeVisible();
    expect(screen.getByText("1", { selector: ".history-detail-surface dd" })).toBeVisible();
    expect(screen.queryByText("Regression Introduced summary")).not.toBeInTheDocument();

    await user.unhover(milestone);
    expect(view.container.querySelector(".history-detail-surface")).not.toBeInTheDocument();
    fireEvent.focus(milestone);
    expect(view.container.querySelector(".history-detail-surface")).toBeVisible();
    expect(screen.getByText("Regression Introduced", { selector: "strong" })).toBeVisible();
  });

  it("shows concise projected details without milestone-only evidence", async () => {
    const user = userEvent.setup();
    const view = renderHistory();
    measure();

    await user.hover(screen.getByRole("link", { name: /RM-001/u }));

    const detailSurface = view.container.querySelector(".history-detail-surface");
    expect(detailSurface).toBeVisible();
    expect(detailSurface).toHaveTextContent("Performance Benchmark");
    expect(detailSurface).toHaveTextContent("Planned2026-05-18");
    expect(detailSurface).toHaveTextContent("Statusactive");
    expect(detailSurface).toHaveTextContent("Timing recovery · BR-TIMING");
    expect(detailSurface).not.toHaveTextContent("Evidence");
    expect(detailSurface).not.toHaveTextContent("Projected active roadmap item");
  });

  it("retains full long titles in accessible links when graph labels are shortened", () => {
    const input = canonicalHistoryInput();
    const fullTitle = "A deliberately long milestone title with timing, replay, validation, and acceptance context";
    const result = layoutTimeline({
      ...input,
      milestones: input.milestones.map((item) => item.id === "CORE-001" ? { ...item, title: fullTitle } : item),
    });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    renderHistory(result.value);
    measure();

    const link = screen.getByRole("link", { name: new RegExp(fullTitle, "u") });
    expect(link).toBeVisible();
    expect(screen.queryByText(fullTitle, { selector: ".history-node-label" })).not.toBeInTheDocument();
    fireEvent.focus(link);
    expect(screen.getByText(fullTitle, { selector: "strong" })).toBeVisible();
  });

  it("has no automatically detectable accessibility violations", async () => {
    const { container } = renderHistory();
    measure();
    const results = await axe.run(container, {
      rules: {
        // jsdom has no canvas-backed computed color model; browser visual checks cover contrast.
        "color-contrast": { enabled: false },
      },
    });
    expect(results.violations).toEqual([]);
  });
});
