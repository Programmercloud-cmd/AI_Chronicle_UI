import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

import { loadChronicle } from "../../../src/data";
import { validateChronicle } from "../../../src/domain";
import type { PublicChronicleSnapshot } from "../../../src/web/app-shell/snapshot";

const CASES = [
  { name: "light-mode", fixture: "linear", theme: "light" },
  { name: "dark-mode", fixture: "linear", theme: "dark" },
  { name: "canonical-branching", fixture: "canonical", theme: "light" },
  { name: "long-label", fixture: "long-label", theme: "light" },
  { name: "four-branch", fixture: "four-branch", theme: "light" },
  { name: "larger-multibranch", fixture: "multibranch", theme: "light" },
] as const;

const GEOMETRY_CASES = CASES.filter(({ fixture }) =>
  fixture === "canonical" || fixture === "long-label" || fixture === "four-branch" || fixture === "multibranch",
);
const browserFailures = new WeakMap<Page, string[]>();
let canonicalSnapshot: PublicChronicleSnapshot;

test.beforeAll(async () => {
  const loaded = await loadChronicle(path.resolve("examples/canonical"));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
  const validated = await validateChronicle(loaded.value);
  if (!validated.ok) throw new Error(JSON.stringify(validated.diagnostics));
  const { rootPath: _rootPath, ...snapshot } = validated.value;
  canonicalSnapshot = JSON.parse(JSON.stringify(snapshot)) as PublicChronicleSnapshot;
});

test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  browserFailures.set(page, failures);
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    failures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`response ${response.status()}: ${response.url()}`);
  });
});

test.afterEach(async ({ page }) => {
  expect(browserFailures.get(page) ?? [], "browser console/page/request failures").toEqual([]);
});

async function openHistory(
  page: Page,
  fixture: string,
  theme: "light" | "dark" = "light",
): Promise<void> {
  await page.goto(`/tests/visual/history/fixture.html?fixture=${fixture}&theme=${theme}`);
  await page.waitForLoadState("networkidle");
  expect(await page.locator("body").evaluate((body) => body.innerText.trim().length > 0)).toBe(true);
  await expect(page.locator("vite-error-overlay, .vite-error-overlay, #webpack-dev-server-client-overlay")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await expect(page.getByLabel("Navigable project history timeline")).toBeVisible();
  await expect(page.locator(".history-canvas")).toBeVisible();
  await expect(page.getByRole("img", { name: "Project history overview minimap" })).toBeVisible();
  await expect(page.locator("#history-navigation-hint")).toHaveText(
    "Drag: pan · Wheel: zoom · Ctrl+drag: zoom area · F: fit current · Shift+F: fullscreen",
  );
  await expect(page.locator(".history-description, .history-scale-note, .history-detail-surface")).toHaveCount(0);
  if (fixture !== "scale") {
    await expect(page.getByText("Focus or hover a milestone for its exact record details.")).toHaveCount(0);
  }
}

function snapshotWithParents(
  snapshot: PublicChronicleSnapshot,
  milestoneId: string,
  parents: readonly string[],
): PublicChronicleSnapshot {
  return {
    ...snapshot,
    milestones: snapshot.milestones.map((record) => record.value.id === milestoneId
      ? { ...record, value: { ...record.value, parents } }
      : record),
  };
}

async function openChronicleDetail(
  page: Page,
  milestoneId: string,
  snapshot: PublicChronicleSnapshot = canonicalSnapshot,
  theme: "light" | "dark" = "light",
): Promise<void> {
  await page.addInitScript(({ selectedTheme }) => {
    window.localStorage.setItem("chronicle-theme-v1", selectedTheme);
  }, { selectedTheme: theme });
  await page.route("**/api/snapshot", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  });
  await page.goto(`/milestones/${encodeURIComponent(milestoneId)}`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("vite-error-overlay, .vite-error-overlay, #webpack-dev-server-client-overlay")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.getByRole("heading", { name: "Milestone neighborhood" })).toBeVisible();
}

function boxesIntersect(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y;
}

function viewBoxValues(value: string | null): [number, number, number, number] {
  if (value === null) throw new Error("History canvas viewBox is unavailable");
  const values = value.split(/\s+/u).map(Number);
  if (values.length !== 4 || values.some((entry) => !Number.isFinite(entry))) {
    throw new Error(`Invalid History viewBox: ${value}`);
  }
  return values as [number, number, number, number];
}

for (const visualCase of CASES) {
  test(visualCase.name, async ({ page }) => {
    await openHistory(page, visualCase.fixture, visualCase.theme);
    await expect(page.locator(".history-page")).toHaveScreenshot(`${visualCase.name}.png`);
  });
}

test("panned camera", async ({ page }) => {
  await openHistory(page, "canonical");
  const surface = page.getByLabel("Navigable project history timeline");
  const canvas = page.locator(".history-canvas");
  const minimapRect = page.locator("[data-minimap-viewport='outline']");
  const originalViewBox = await canvas.getAttribute("viewBox");
  const originalMinimapX = await minimapRect.getAttribute("x");

  await surface.focus();
  await surface.press("ArrowLeft");
  await expect.poll(() => canvas.getAttribute("viewBox")).not.toBe(originalViewBox);
  await expect.poll(() => minimapRect.getAttribute("x")).not.toBe(originalMinimapX);
  await expect(page.locator(".history-page")).toHaveScreenshot("panned.png");
});

test("cursor-anchored zoomed camera", async ({ page }) => {
  await openHistory(page, "canonical");
  const surface = page.getByLabel("Navigable project history timeline");
  const canvas = page.locator(".history-canvas");
  const surfaceBox = await surface.boundingBox();
  if (surfaceBox === null) throw new Error("History surface has no browser bounds");
  const before = viewBoxValues(await canvas.getAttribute("viewBox"));

  await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.7, surfaceBox.y + surfaceBox.height * 0.42);
  await page.mouse.wheel(0, -520);
  await expect.poll(async () => viewBoxValues(await canvas.getAttribute("viewBox"))[2]).toBeLessThan(before[2]);
  await expect(page.locator(".history-page")).toHaveScreenshot("zoomed.png");
});

test("active rectangle selection", async ({ page }) => {
  await openHistory(page, "canonical");
  const surface = page.getByLabel("Navigable project history timeline");
  const surfaceBox = await surface.boundingBox();
  if (surfaceBox === null) throw new Error("History surface has no browser bounds");
  const start = {
    x: surfaceBox.x + surfaceBox.width * 0.55,
    y: surfaceBox.y + surfaceBox.height * 0.2,
  };
  const end = {
    x: surfaceBox.x + surfaceBox.width * 0.83,
    y: surfaceBox.y + surfaceBox.height * 0.64,
  };

  await page.keyboard.down("Control");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await expect(page.getByTestId("history-selection-rectangle")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator(".history-page")).toHaveScreenshot("active-rectangle-selection.png");
  await surface.press("Escape");
  await page.mouse.up();
  await page.keyboard.up("Control");
  await expect(page.getByTestId("history-selection-rectangle")).toHaveCount(0);
});

for (const responsive of [
  { name: "responsive-760", width: 760, height: 900 },
  { name: "responsive-320", width: 320, height: 780 },
] as const) {
  test(responsive.name, async ({ page }) => {
    await page.setViewportSize({ width: responsive.width, height: responsive.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHistory(page, "canonical");
    await expect(page.locator(".history-page")).toHaveScreenshot(`${responsive.name}.png`);
  });
}

test("minimap navigation stays synchronized and recovery does not scroll the document", async ({ page }) => {
  await openHistory(page, "canonical");
  const surface = page.getByLabel("Navigable project history timeline");
  const canvas = page.locator(".history-canvas");
  const minimap = page.getByRole("img", { name: "Project history overview minimap" });
  const canonicalViewBox = await canvas.getAttribute("viewBox");
  const surfaceBox = await surface.boundingBox();
  if (surfaceBox === null) throw new Error("History surface has no browser bounds");
  await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.65, surfaceBox.y + surfaceBox.height * 0.4);
  await page.mouse.wheel(0, -420);
  await expect.poll(() => canvas.getAttribute("viewBox")).not.toBe(canonicalViewBox);
  const zoomedViewBox = await canvas.getAttribute("viewBox");
  const zoomedWidth = viewBoxValues(zoomedViewBox)[2];
  const minimapBox = await minimap.boundingBox();
  if (minimapBox === null) throw new Error("History minimap has no browser bounds");

  await minimap.click({ position: { x: minimapBox.width * 0.22, y: minimapBox.height * 0.5 } });
  await expect.poll(() => canvas.getAttribute("viewBox")).not.toBe(zoomedViewBox);
  expect(viewBoxValues(await canvas.getAttribute("viewBox"))[2]).toBeCloseTo(zoomedWidth, 8);
  const afterClick = await canvas.getAttribute("viewBox");

  const hitTarget = page.locator("[data-minimap-viewport='hit-target']");
  const hitBox = await hitTarget.boundingBox();
  if (hitBox === null) throw new Error("Minimap viewport hit target has no browser bounds");
  await page.mouse.move(hitBox.x + hitBox.width / 2, hitBox.y + hitBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(hitBox.x + hitBox.width / 2 + 28, hitBox.y + hitBox.height / 2 + 14);
  await page.mouse.up();
  await expect.poll(() => canvas.getAttribute("viewBox")).not.toBe(afterClick);
  expect(viewBoxValues(await canvas.getAttribute("viewBox"))[2]).toBeCloseTo(zoomedWidth, 8);

  const beforeTheme = await canvas.getAttribute("viewBox");
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await expect(canvas).toHaveAttribute("viewBox", beforeTheme ?? "");

  const outerScroll = await page.evaluate(() => window.scrollY);
  await surface.focus();
  await surface.press("f");
  await expect(canvas).toHaveAttribute("viewBox", canonicalViewBox ?? "");
  await expect(surface).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("History view fitted to current state");
  expect(await page.evaluate(() => window.scrollY)).toBe(outerScroll);

  await page.getByRole("button", { name: "Fit current (F)" }).click();
  await expect(surface).toBeFocused();
  await expect(canvas).toHaveAttribute("viewBox", canonicalViewBox ?? "");
  expect(await page.evaluate(() => window.scrollY)).toBe(outerScroll);
});

for (const fullscreenCase of [
  { name: "4k dark", width: 3840, height: 2160, theme: "dark" as const, maximumMinimapWidth: 352 },
  { name: "narrow light", width: 320, height: 780, theme: "light" as const, maximumMinimapWidth: 224 },
] as const) {
  test(`${fullscreenCase.name} fullscreen grows the minimap within bounded themed controls`, async ({ page }) => {
    await page.setViewportSize({ width: fullscreenCase.width, height: fullscreenCase.height });
    await openHistory(page, "canonical", fullscreenCase.theme);
    test.skip(!(await page.evaluate(() => document.fullscreenEnabled)), "Native fullscreen unavailable in runner");

    const surface = page.getByLabel("Navigable project history timeline");
    const minimap = page.getByRole("img", { name: "Project history overview minimap" });
    const normalMinimap = await minimap.boundingBox();
    if (normalMinimap === null) throw new Error("Normal minimap has no browser bounds");
    expect(await minimap.getAttribute("viewBox")).toBe("0 0 240 144");

    const enterControl = page.getByRole("button", { name: "Enter fullscreen (Shift+F)" });
    await enterControl.focus();
    await expect(enterControl).toBeFocused();
    expect(await enterControl.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe("3px");
    await enterControl.click();
    await expect.poll(() => surface.evaluate((element) => document.fullscreenElement === element)).toBe(true);
    const exitControl = page.getByRole("button", { name: "Exit fullscreen (Esc)" });
    await expect(exitControl).toHaveAttribute("aria-pressed", "true");
    await expect(exitControl).toHaveAttribute("title", "Exit fullscreen (Esc)");

    const surfaceBox = await surface.boundingBox();
    const fullscreenMinimap = await minimap.boundingBox();
    const controlBox = await exitControl.boundingBox();
    if (surfaceBox === null || fullscreenMinimap === null || controlBox === null) {
      throw new Error("Fullscreen controls have no browser bounds");
    }
    expect(surfaceBox.x).toBeCloseTo(0, 1);
    expect(surfaceBox.y).toBeCloseTo(0, 1);
    expect(surfaceBox.width).toBeCloseTo(fullscreenCase.width, 1);
    expect(surfaceBox.height).toBeCloseTo(fullscreenCase.height, 1);
    expect(fullscreenMinimap.width).toBeGreaterThan(normalMinimap.width);
    expect(fullscreenMinimap.width).toBeLessThanOrEqual(fullscreenCase.maximumMinimapWidth);
    expect(fullscreenMinimap.x).toBeGreaterThanOrEqual(surfaceBox.x);
    expect(fullscreenMinimap.y + fullscreenMinimap.height).toBeLessThanOrEqual(
      surfaceBox.y + surfaceBox.height,
    );
    expect(controlBox.x + controlBox.width).toBeLessThanOrEqual(surfaceBox.x + surfaceBox.width);
    expect(controlBox.y + controlBox.height).toBeLessThanOrEqual(surfaceBox.y + surfaceBox.height);
    expect(boxesIntersect(fullscreenMinimap, controlBox)).toBe(false);
    expect(await minimap.getAttribute("viewBox")).toBe("0 0 240 144");
    const themeColors = await page.evaluate(() => {
      const surfaceElement = document.querySelector<HTMLElement>(".history-scroll");
      const canvasElement = document.querySelector<HTMLElement>(".history-canvas");
      return {
        theme: document.documentElement.dataset.theme,
        surface: surfaceElement === null ? "" : getComputedStyle(surfaceElement).backgroundColor,
        canvas: canvasElement === null ? "" : getComputedStyle(canvasElement).backgroundColor,
      };
    });
    expect(themeColors.theme).toBe(fullscreenCase.theme);
    expect(themeColors.surface).toBe(themeColors.canvas);
    const controlColors = await exitControl.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, foreground: style.color, border: style.borderTopColor };
    });
    expect(controlColors.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(controlColors.foreground).not.toBe(controlColors.background);
    expect(controlColors.border).not.toBe(controlColors.background);

    if (fullscreenCase.name === "narrow light") {
      await expect(surface).toHaveScreenshot("fullscreen-narrow-light.png");
    }

    await exitControl.click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBe(null);
    await expect(page.getByRole("button", { name: "Enter fullscreen (Shift+F)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
}

test("desktop header Back control", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openChronicleDetail(page, "TIM-003");
  await expect(page.locator(".site-header")).toHaveScreenshot("header-back-desktop.png");
});

test("mobile header Back control", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChronicleDetail(page, "TIM-003");
  await expect(page.locator(".site-header")).toHaveScreenshot("header-back-mobile.png");
});

test("linear milestone neighborhood in light theme", async ({ page }) => {
  await openChronicleDetail(page, "TIM-003");
  await expect(page.locator(".detail-hero")).toHaveScreenshot("detail-linear-light.png");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("branch milestone neighborhood in dark theme", async ({ page }) => {
  const branchSnapshot = snapshotWithParents(canonicalSnapshot, "TIM-001", ["CORE-002"]);
  await openChronicleDetail(page, "CORE-002", branchSnapshot, "dark");
  await expect(page.locator(".detail-hero")).toHaveScreenshot("detail-branch-dark.png");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("merge milestone neighborhood preserves declared parent order", async ({ page }) => {
  const mergeSnapshot = snapshotWithParents(canonicalSnapshot, "TIM-001", ["CORE-002", "CORE-003"]);
  await openChronicleDetail(page, "TIM-001", mergeSnapshot);
  const parentIds = await page.locator("[data-neighborhood-relation='parent']")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-neighborhood-id")));
  expect(parentIds).toEqual(["CORE-002", "CORE-003"]);
  await expect(page.locator(".detail-hero")).toHaveScreenshot("detail-merge-light.png");
});

test("narrow branch milestone neighborhood stacks below readable heading content", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const branchSnapshot = snapshotWithParents(canonicalSnapshot, "TIM-001", ["CORE-002"]);
  await openChronicleDetail(page, "CORE-002", branchSnapshot, "dark");
  const contentBox = await page.locator(".detail-hero-content").boundingBox();
  const neighborhoodBox = await page.locator(".milestone-neighborhood").boundingBox();
  if (contentBox === null || neighborhoodBox === null) throw new Error("Narrow detail regions are unavailable");
  expect(neighborhoodBox.y).toBeGreaterThanOrEqual(contentBox.y + contentBox.height);
  await expect(page.locator(".detail-hero")).toHaveScreenshot("detail-branch-narrow-dark.png");
});

for (const visualCase of GEOMETRY_CASES) {
  test(`${visualCase.name} keeps titles clear of timestamps`, async ({ page }) => {
    await openHistory(page, visualCase.fixture, visualCase.theme);
    const nodes = page.locator(".history-node");
    const titles: { id: string; box: { x: number; y: number; width: number; height: number } }[] = [];
    const timestamps: { id: string; box: { x: number; y: number; width: number; height: number } }[] = [];
    const collisions: string[] = [];

    for (let index = 0; index < await nodes.count(); index += 1) {
      const node = nodes.nth(index);
      const id = await node.getAttribute("data-node-id") ?? `node-${index}`;
      const title = node.locator(".history-node-label");
      if (await title.count() === 0) continue;
      const titleBox = await title.boundingBox();
      if (titleBox !== null) titles.push({ id, box: titleBox });
      const nodeTimestamps = node.locator(".history-node-time");
      for (let timestampIndex = 0; timestampIndex < await nodeTimestamps.count(); timestampIndex += 1) {
        const timestampBox = await nodeTimestamps.nth(timestampIndex).boundingBox();
        if (timestampBox !== null) timestamps.push({ id, box: timestampBox });
      }
    }

    for (const title of titles) {
      for (const timestamp of timestamps) {
        if (boxesIntersect(title.box, timestamp.box)) collisions.push(`${title.id}/${timestamp.id}`);
      }
    }

    expect(collisions, "title/timestamp intersections").toEqual([]);
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} fixture has no browser axe violations`, async ({ page }) => {
    await openHistory(page, "canonical", theme);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("250-milestone difficult scale remains camera-navigable", async ({ page }) => {
  const startedAt = Date.now();
  await openHistory(page, "scale");
  await expect(page.locator(".history-node")).toHaveCount(280);
  expect(Date.now() - startedAt).toBeLessThan(10_000);
  const surface = page.getByLabel("Navigable project history timeline");
  const canvas = page.locator(".history-canvas");
  const minimap = page.getByRole("img", { name: "Project history overview minimap" });
  await expect(minimap.locator(".history-minimap-node")).toHaveCount(280);
  const initialViewBox = await canvas.getAttribute("viewBox");
  const extent = await surface.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(extent.scrollWidth).toBe(extent.clientWidth);
  await expect(page.locator(".history-page")).toHaveScreenshot("difficult-scale.png");

  await surface.focus();
  await surface.press("ArrowLeft");
  await expect.poll(() => canvas.getAttribute("viewBox")).not.toBe(initialViewBox);
  const outerScroll = await page.evaluate(() => window.scrollY);
  await surface.press("f");
  await expect(canvas).toHaveAttribute("viewBox", initialViewBox ?? "");
  await expect(surface).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("History view fitted to current state");
  expect(await page.evaluate(() => window.scrollY)).toBe(outerScroll);
});
