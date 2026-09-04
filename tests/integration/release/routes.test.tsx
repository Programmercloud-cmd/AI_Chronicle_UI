// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import path from "node:path";

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter, MemoryRouter } from "react-router-dom";

import { loadChronicle } from "../../../src/data";
import { validateChronicle } from "../../../src/domain";
import { AppShell } from "../../../src/web/app-shell/app-shell";
import type { PublicChronicleSnapshot } from "../../../src/web/app-shell/snapshot";
import { historyLayoutFromSnapshot } from "../../../src/web/history/history-data";
import { canonicalCamera } from "../../../src/web/history/history-content-bounds";
import { createMinimapProjection, minimapViewportRect } from "../../../src/web/history/minimap-math";
import { transitionHistoryCameraPreservingPose, type HistoryCamera } from "../../../src/web/history/history-view";
import { visibleGraphRect } from "../../../src/web/history/viewport-math";

let canonical: PublicChronicleSnapshot;
let routeAnimationFrameId = 0;
let routeAnimationFrames = new Map<number, FrameRequestCallback>();

class ReleaseResizeObserver {
  static instances: ReleaseResizeObserver[] = [];

  readonly observe = vi.fn((target: Element) => {
    this.target = target;
  });
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn(() => {
    this.target = undefined;
  });
  private target?: Element;

  constructor(private readonly callback: ResizeObserverCallback) {
    ReleaseResizeObserver.instances.push(this);
  }

  emit(width = 900, height = 560): void {
    if (this.target === undefined) throw new Error("History ResizeObserver target is unavailable");
    const entry = {
      target: this.target,
      contentRect: { width, height },
    } as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }

  isObserving(): boolean {
    return this.target !== undefined;
  }
}

beforeAll(async () => {
  const loaded = await loadChronicle(path.resolve("examples/canonical"));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
  const validated = await validateChronicle(loaded.value);
  if (!validated.ok) throw new Error(JSON.stringify(validated.diagnostics));
  const { rootPath: _rootPath, ...snapshot } = validated.value;
  canonical = JSON.parse(JSON.stringify(snapshot)) as PublicChronicleSnapshot;
});

beforeEach(() => {
  ReleaseResizeObserver.instances = [];
  routeAnimationFrameId = 0;
  routeAnimationFrames = new Map();
  vi.stubGlobal("ResizeObserver", ReleaseResizeObserver);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    routeAnimationFrameId += 1;
    routeAnimationFrames.set(routeAnimationFrameId, callback);
    return routeAnimationFrameId;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => {
    routeAnimationFrames.delete(id);
  }));
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => { values.delete(key); },
      setItem: (key: string, value: string) => { values.set(key, String(value)); },
    } satisfies Storage,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderShell(pathname = "/") {
  return render(<MemoryRouter initialEntries={[pathname]}><AppShell /></MemoryRouter>);
}

function renderBrowserShell(pathname = "/history") {
  window.history.replaceState(null, "", pathname);
  return render(<BrowserRouter><AppShell /></BrowserRouter>);
}

async function latestReleaseObserver(): Promise<ReleaseResizeObserver> {
  return waitFor(() => {
    const observer = ReleaseResizeObserver.instances.findLast((candidate) => candidate.isObserving());
    if (observer === undefined) throw new Error("History did not attach a ResizeObserver target");
    return observer;
  });
}

async function emitLatestReleaseResize(width = 900, height = 560): Promise<ReleaseResizeObserver> {
  const observer = await latestReleaseObserver();
  act(() => observer.emit(width, height));
  return observer;
}

function flushRouteAnimationFrames(): void {
  const callbacks = [...routeAnimationFrames.values()];
  routeAnimationFrames.clear();
  act(() => callbacks.forEach((callback) => callback(16.67)));
}

function cameraFromViewBox(element: Element, viewport: { width: number; height: number }): HistoryCamera {
  const value = element.getAttribute("viewBox");
  if (value === null) throw new Error("History viewBox is unavailable");
  const [left, top, width, height] = value.split(" ").map(Number);
  if (left === undefined || top === undefined || width === undefined || height === undefined) {
    throw new Error(`Invalid History viewBox: ${value}`);
  }
  return {
    centerX: left + width / 2,
    centerY: top + height / 2,
    scale: viewport.width / width,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    mode: "manual",
  };
}

function minimapAttributes(): string[] {
  const outline = screen.getByTestId("history-minimap")
    .querySelector("[data-minimap-viewport='outline']");
  if (outline === null) throw new Error("History minimap outline is unavailable");
  return ["x", "y", "width", "height"].map((name) => outline.getAttribute(name) ?? "");
}

async function createPannedZoomedHistoryEvidence() {
  expect(await screen.findByRole("heading", { name: "History" })).toBeVisible();
  const viewport = { width: 900, height: 560 };
  await emitLatestReleaseResize(viewport.width, viewport.height);
  const surface = screen.getByLabelText("Navigable project history timeline");
  const canvas = screen.getByRole("group", { name: "Branching project history" });
  fireEvent.keyDown(surface, { key: "ArrowLeft" });
  const pannedViewBox = canvas.getAttribute("viewBox");
  fireEvent.wheel(surface, { deltaY: -180, clientX: 610, clientY: 230 });
  flushRouteAnimationFrames();
  expect(canvas.getAttribute("viewBox")).not.toBe(pannedViewBox);
  return {
    viewport,
    camera: cameraFromViewBox(canvas, viewport),
    viewBox: canvas.getAttribute("viewBox"),
    minimap: minimapAttributes(),
  };
}

async function openDetailChain(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("link", { name: /^TIM-003\./u }));
  expect(await screen.findByRole("heading", { name: "Validation Passed" })).toBeVisible();
  const childSection = screen.getByRole("heading", { name: "Child milestones" }).closest("section");
  if (childSection === null) throw new Error("Child milestones section is unavailable");
  await user.click(within(childSection).getByRole("link", { name: "Stable Implementation Accepted" }));
  expect(await screen.findByRole("heading", { name: "Stable Implementation Accepted" })).toBeVisible();
}

async function nativeBrowserBack(): Promise<void> {
  await act(async () => {
    const popped = new Promise<void>((resolve) => {
      window.addEventListener("popstate", () => resolve(), { once: true });
    });
    window.history.back();
    await popped;
  });
}

function mockCanonical(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "/api/snapshot") {
      return new Response(JSON.stringify(canonical), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  return fetchMock;
}

describe("accepted page route integration", () => {
  it("navigates Current, History, and Roadmap through one immutable snapshot", async () => {
    const fetchMock = mockCanonical();
    const user = userEvent.setup();
    renderShell();

    expect(await screen.findByRole("heading", { name: "Current" })).toBeVisible();
    expect(screen.getByText("Stable timestamp handling is accepted on the canonical replay.")).toBeVisible();
    await user.click(screen.getByRole("link", { name: "History" }));
    expect(await screen.findByRole("heading", { name: "History" })).toBeVisible();
    const surface = screen.getByLabelText("Navigable project history timeline");
    expect(surface).toBeVisible();
    const observer = await latestReleaseObserver();
    expect(observer.observe).toHaveBeenCalledWith(surface);
    act(() => observer.emit());
    expect(screen.getByText((_, element) =>
      element?.id === "history-navigation-hint" &&
      element.textContent === "Drag: pan · Wheel: zoom · Ctrl+drag: zoom area · F: fit current · Shift+F: fullscreen"
    )).toBeVisible();
    expect(screen.getByRole("group", { name: "Branching project history" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Project history overview minimap" })).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Roadmap" }));
    expect(await screen.findByRole("heading", { name: "Roadmap" })).toBeVisible();
    expect(screen.getByRole("list", { name: "Project roadmap" })).toBeVisible();
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("opens accepted milestone detail and preserves a controlled not-found route", async () => {
    mockCanonical();
    const detail = renderShell("/milestones/TIM-003");
    expect(await screen.findByRole("heading", { name: "Validation Passed" })).toBeVisible();
    detail.unmount();

    renderShell("/missing-view");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  it("restores the exact History camera through production BrowserRouter detail and Back traversal", async () => {
    mockCanonical();
    const user = userEvent.setup();
    const view = renderBrowserShell();
    expect(await screen.findByRole("heading", { name: "History" })).toBeVisible();
    await emitLatestReleaseResize();
    const surface = screen.getByLabelText("Navigable project history timeline");
    const canvas = screen.getByRole("group", { name: "Branching project history" });
    const minimapOutline = screen.getByTestId("history-minimap")
      .querySelector("[data-minimap-viewport='outline']");
    if (minimapOutline === null) throw new Error("History minimap outline is unavailable");

    fireEvent.keyDown(surface, { key: "ArrowLeft" });
    const preservedViewBox = canvas.getAttribute("viewBox");
    const preservedMinimap = ["x", "y", "width", "height"].map((name) => minimapOutline.getAttribute(name));

    await user.click(screen.getByRole("link", { name: /^TIM-003\./u }));
    expect(await screen.findByRole("heading", { name: "Validation Passed" })).toBeVisible();
    const childHeading = screen.getByRole("heading", { name: "Child milestones" });
    const childSection = childHeading.closest("section");
    if (childSection === null) throw new Error("Child milestones section is unavailable");
    await user.click(within(childSection).getByRole("link", { name: "Stable Implementation Accepted" }));
    expect(await screen.findByRole("heading", { name: "Stable Implementation Accepted" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Validation Passed" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "History" })).toBeVisible();
    await emitLatestReleaseResize();
    const restoredCanvas = screen.getByRole("group", { name: "Branching project history" });
    const restoredOutline = screen.getByTestId("history-minimap")
      .querySelector("[data-minimap-viewport='outline']");
    expect(restoredCanvas).toHaveAttribute("viewBox", preservedViewBox);
    expect(["x", "y", "width", "height"].map((name) => restoredOutline?.getAttribute(name)))
      .toEqual(preservedMinimap);

    view.unmount();
    renderBrowserShell();
    expect(await screen.findByRole("heading", { name: "History" })).toBeVisible();
    await emitLatestReleaseResize();
    expect(screen.getByRole("group", { name: "Branching project history" }))
      .not.toHaveAttribute("viewBox", preservedViewBox);
  });

  it.each([
    { name: "native Back B→A then Chronicle Back A→History", nativeFirst: true },
    { name: "Chronicle Back B→A then native Back A→History", nativeFirst: false },
  ])("restores exact panned/zoomed History after $name", async ({ nativeFirst }) => {
    mockCanonical();
    const user = userEvent.setup();
    renderBrowserShell();
    const original = await createPannedZoomedHistoryEvidence();
    await openDetailChain(user);

    if (nativeFirst) await nativeBrowserBack();
    else await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Validation Passed" })).toBeVisible();

    if (nativeFirst) await user.click(screen.getByRole("button", { name: "Back" }));
    else await nativeBrowserBack();
    expect(await screen.findByRole("heading", { name: "History" })).toBeVisible();
    await emitLatestReleaseResize(original.viewport.width, original.viewport.height);

    expect(screen.getByRole("group", { name: "Branching project history" }))
      .toHaveAttribute("viewBox", original.viewBox);
    expect(minimapAttributes()).toEqual(original.minimap);
  });

  it("preserves graph center and scale and resynchronizes the minimap when route remount measures a new viewport", async () => {
    mockCanonical();
    const user = userEvent.setup();
    renderBrowserShell();
    const original = await createPannedZoomedHistoryEvidence();

    await user.click(screen.getByRole("link", { name: /^TIM-003\./u }));
    expect(await screen.findByRole("heading", { name: "Validation Passed" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "History" })).toBeVisible();

    const resizedViewport = { width: 1_180, height: 690 };
    await emitLatestReleaseResize(resizedViewport.width, resizedViewport.height);
    const canvas = screen.getByRole("group", { name: "Branching project history" });
    const restored = cameraFromViewBox(canvas, resizedViewport);
    expect(restored.centerX).toBeCloseTo(original.camera.centerX, 10);
    expect(restored.centerY).toBeCloseTo(original.camera.centerY, 10);
    expect(restored.scale).toBeCloseTo(original.camera.scale, 10);

    const layout = historyLayoutFromSnapshot(canonical);
    if (!layout.ok) throw new Error(JSON.stringify(layout.diagnostics));
    const expected = transitionHistoryCameraPreservingPose(
      { ...original.camera, viewportWidth: resizedViewport.width, viewportHeight: resizedViewport.height },
      layout.value,
      resizedViewport,
    );
    const expectedRect = minimapViewportRect(
      expected.camera,
      resizedViewport,
      createMinimapProjection(expected.navigationBounds),
    );
    const actualRect = minimapAttributes().map(Number);
    expect(actualRect[0]).toBeCloseTo(expectedRect.x, 10);
    expect(actualRect[1]).toBeCloseTo(expectedRect.y, 10);
    expect(actualRect[2]).toBeCloseTo(expectedRect.width, 10);
    expect(actualRect[3]).toBeCloseTo(expectedRect.height, 10);
  });

  it("uses a canonical camera for direct-detail Back fallback with no app-lifetime session", async () => {
    mockCanonical();
    const user = userEvent.setup();
    renderBrowserShell("/milestones/TIM-003");
    expect(await screen.findByRole("heading", { name: "Validation Passed" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "History" })).toBeVisible());
    await emitLatestReleaseResize();
    const historyCanvas = screen.getByRole("group", { name: "Branching project history" });
    const layout = historyLayoutFromSnapshot(canonical);
    if (!layout.ok) throw new Error(JSON.stringify(layout.diagnostics));
    const viewport = { width: 900, height: 560 };
    const camera = canonicalCamera(layout.value, viewport);
    const visible = visibleGraphRect(camera.pose, viewport);
    expect(historyCanvas).toHaveAttribute(
      "viewBox",
      `${visible.left} ${visible.top} ${visible.right - visible.left} ${visible.bottom - visible.top}`,
    );
    expect(screen.getByText("CURRENT STATE")).toBeVisible();
  });
});
