import { expect, test, type Locator, type Page } from "@playwright/test";

interface HistoryPose {
  readonly centerX: number;
  readonly centerY: number;
  readonly scale: number;
  readonly viewBox: string;
}

interface HistoryGeometry {
  readonly viewBox: string | null;
  readonly surface: { x: number; y: number; width: number; height: number };
  readonly canvas: { x: number; y: number; width: number; height: number };
  readonly graph: { x: number; y: number; width: number; height: number };
  readonly node: { x: number; y: number; width: number; height: number };
}

async function historyPose(page: Page): Promise<HistoryPose> {
  return page.evaluate(() => {
    const surface = document.querySelector<HTMLElement>(".history-scroll");
    const canvas = document.querySelector<SVGSVGElement>(".history-canvas");
    const viewBox = canvas?.getAttribute("viewBox") ?? null;
    if (surface === null || viewBox === null) throw new Error("History camera is unavailable");
    const [left, top, width, height] = viewBox.split(/\s+/u).map(Number);
    if (left === undefined || top === undefined || width === undefined || height === undefined ||
      [left, top, width, height].some((value) => !Number.isFinite(value))) {
      throw new Error(`Invalid History viewBox: ${viewBox}`);
    }
    return {
      centerX: left + width / 2,
      centerY: top + height / 2,
      scale: canvas.getBoundingClientRect().width / width,
      viewBox,
    };
  });
}

async function historyViewport(page: Page): Promise<{ width: number; height: number }> {
  return page.locator(".history-canvas").evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect();
    return {
      width: bounds.width,
      height: bounds.height,
    };
  });
}

async function historyGeometry(page: Page, nodeId: string): Promise<HistoryGeometry> {
  return page.evaluate((selectedNodeId) => {
    const rectangle = (element: Element | null) => {
      if (element === null) throw new Error("History geometry element is unavailable");
      const bounds = element.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    };
    const canvas = document.querySelector(".history-canvas");
    return {
      viewBox: canvas?.getAttribute("viewBox") ?? null,
      surface: rectangle(document.querySelector(".history-scroll")),
      canvas: rectangle(canvas),
      graph: rectangle(document.querySelector(".history-nodes")),
      node: rectangle(document.querySelector(`[data-node-id='${CSS.escape(selectedNodeId)}']`)),
    };
  }, nodeId);
}

async function visibleHistoryNode(page: Page): Promise<{ id: string; core: Locator; link: Locator }> {
  const id = await page.evaluate(() => {
    const surface = document.querySelector<HTMLElement>(".history-scroll");
    if (surface === null) throw new Error("History surface is unavailable");
    const viewport = surface.getBoundingClientRect();
    const node = [...document.querySelectorAll<SVGGElement>("[data-node-id]")].find((candidate) => {
      const bounds = candidate.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 && bounds.left >= viewport.left &&
        bounds.right <= viewport.right && bounds.top >= viewport.top && bounds.bottom <= viewport.bottom;
    });
    const nodeId = node?.dataset.nodeId;
    if (nodeId === undefined) throw new Error("No fully visible History node is available");
    return nodeId;
  });
  return {
    id,
    core: page.locator(`[data-node-id='${id}'] .history-node-core`),
    link: page.locator(`[data-node-id='${id}'] a`),
  };
}

async function summaryMetrics(page: Page): Promise<{
  readonly contained: boolean;
  readonly noOverflow: boolean;
  readonly outsideSvg: boolean;
  readonly parentIsSurface: boolean;
  readonly pointerEvents: string[];
  readonly position: string;
  readonly top: number;
  readonly right: number;
  readonly width: number;
  readonly height: number;
}> {
  return page.locator(".history-detail-surface").evaluate((element) => {
    const surface = element.parentElement;
    if (surface === null) throw new Error("History summary has no parent surface");
    const bounds = element.getBoundingClientRect();
    const viewport = surface.getBoundingClientRect();
    return {
      contained: bounds.left >= viewport.left && bounds.right <= viewport.right &&
        bounds.top >= viewport.top && bounds.bottom <= viewport.bottom,
      noOverflow: element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight,
      outsideSvg: element.closest("svg") === null,
      parentIsSurface: surface.classList.contains("history-scroll"),
      pointerEvents: [element, ...element.querySelectorAll("*")]
        .map((candidate) => getComputedStyle(candidate).pointerEvents),
      position: getComputedStyle(element).position,
      top: bounds.top - viewport.top,
      right: viewport.right - bounds.right,
      width: bounds.width,
      height: bounds.height,
    };
  });
}

async function panToHorizontalLimit(page: Page, key: "ArrowLeft" | "ArrowRight"): Promise<void> {
  const surface = page.getByLabel("Navigable project history timeline");
  await surface.focus();
  for (let index = 0; index < 120; index += 1) await surface.press(`Shift+${key}`);
  const canvas = page.locator(".history-canvas");
  const limit = await canvas.getAttribute("viewBox");
  await surface.press(`Shift+${key}`);
  await expect(canvas).toHaveAttribute("viewBox", limit ?? "");
}

async function safeArea(page: Page): Promise<{
  readonly count: number;
  readonly labels: string[];
  readonly minimumLeft: number;
  readonly minimumRight: number;
  readonly violations: { text: string; left: number; right: number }[];
}> {
  return page.evaluate(() => {
    const surface = document.querySelector<HTMLElement>(".history-scroll");
    if (surface === null) throw new Error("History surface is unavailable");
    const viewport = surface.getBoundingClientRect();
    const visible = [...document.querySelectorAll<SVGTextElement>(".history-canvas text")]
      .map((element) => ({ element, bounds: element.getBoundingClientRect() }))
      .filter(({ element, bounds }) => {
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" &&
          bounds.width > 0 && bounds.height > 0 &&
          bounds.right > viewport.left && bounds.left < viewport.right &&
          bounds.bottom > viewport.top && bounds.top < viewport.bottom;
      });
    const measurements = visible.map(({ element, bounds }) => ({
      text: element.textContent?.trim() ?? "",
      left: bounds.left - viewport.left,
      right: viewport.right - bounds.right,
    }));
    return {
      count: measurements.length,
      labels: measurements.map(({ text }) => text),
      minimumLeft: Math.min(...measurements.map(({ left }) => left)),
      minimumRight: Math.min(...measurements.map(({ right }) => right)),
      violations: measurements.filter(({ left, right }) => left < 23.5 || right < 23.5),
    };
  });
}

test("packaged History hover and repeated-fullscreen camera flow stays bounded", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const failedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => errors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().startsWith(process.env.CHRONICLE_RELEASE_ORIGIN!)) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto("/history");
  const surface = page.getByLabel("Navigable project history timeline");
  const canvas = page.locator(".history-canvas");
  const minimap = page.getByRole("img", { name: "Project history overview minimap" });
  await expect(surface).toBeVisible();
  await expect(minimap).toBeVisible();
  test.skip(!(await page.evaluate(() => document.fullscreenEnabled)), "Native fullscreen unavailable in runner");

  const firstNode = await visibleHistoryNode(page);
  const geometryBefore = await historyGeometry(page, firstNode.id);
  await firstNode.core.hover();
  const summary = page.locator(".history-detail-surface");
  await expect(summary).toBeVisible();
  expect(await historyGeometry(page, firstNode.id)).toEqual(geometryBefore);
  const coreBox = await firstNode.core.boundingBox();
  if (coreBox === null) throw new Error("Hover target has no browser bounds");
  const hoveredSummary = await summaryMetrics(page);
  expect(hoveredSummary).toMatchObject({
    contained: true,
    noOverflow: true,
    outsideSvg: true,
    parentIsSurface: true,
    position: "absolute",
  });
  expect(hoveredSummary.top).toBeGreaterThanOrEqual(15);
  expect(hoveredSummary.top).toBeLessThanOrEqual(18);
  expect(hoveredSummary.right).toBeGreaterThanOrEqual(15);
  expect(hoveredSummary.right).toBeLessThanOrEqual(18);
  expect(hoveredSummary.pointerEvents.every((value) => value === "none")).toBe(true);
  await page.mouse.move(coreBox.x + coreBox.width / 2 + 1, coreBox.y + coreBox.height / 2 + 1);
  await expect(summary).toBeVisible();
  expect(await historyGeometry(page, firstNode.id)).toEqual(geometryBefore);

  const firstPreviewViewport = await historyViewport(page);
  const firstPreview = await historyPose(page);
  await page.getByRole("button", { name: "Enter fullscreen (Shift+F)" }).click();
  await expect.poll(() => surface.evaluate((element) => document.fullscreenElement === element)).toBe(true);
  const firstFullscreenSurface = await surface.boundingBox();
  if (firstFullscreenSurface === null) throw new Error("Fullscreen History surface has no browser bounds");
  const firstFullscreenViewport = await historyViewport(page);
  const firstFactor = Math.min(
    firstFullscreenViewport.width / firstPreviewViewport.width,
    firstFullscreenViewport.height / firstPreviewViewport.height,
  );
  const firstEntry = await historyPose(page);
  expect(firstEntry.centerX).toBeCloseTo(firstPreview.centerX, 8);
  expect(firstEntry.centerY).toBeCloseTo(firstPreview.centerY, 8);
  expect(firstEntry.scale).toBeCloseTo(firstPreview.scale * firstFactor, 8);
  await expect(minimap).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(() => surface.evaluate((element) => [element.clientWidth, element.clientHeight])).toEqual([1280, 800]);
  const resizedFullscreenSurface = await surface.boundingBox();
  if (resizedFullscreenSurface === null) throw new Error("Resized fullscreen surface has no browser bounds");
  const resizedFullscreenViewport = await historyViewport(page);
  const resizedFactor = Math.min(
    resizedFullscreenViewport.width / firstPreviewViewport.width,
    resizedFullscreenViewport.height / firstPreviewViewport.height,
  );
  const resizedFullscreen = await historyPose(page);
  expect(resizedFullscreen.centerX).toBeCloseTo(firstPreview.centerX, 8);
  expect(resizedFullscreen.centerY).toBeCloseTo(firstPreview.centerY, 8);
  expect(resizedFullscreen.scale).toBeCloseTo(firstPreview.scale * resizedFactor, 8);

  await page.mouse.move(resizedFullscreenSurface.x + resizedFullscreenSurface.width * 0.62,
    resizedFullscreenSurface.y + resizedFullscreenSurface.height * 0.44);
  await page.mouse.wheel(0, -480);
  await expect.poll(async () => (await historyPose(page)).scale).toBeGreaterThan(resizedFullscreen.scale);
  await surface.focus();
  await surface.press("Shift+ArrowLeft");
  const changedFullscreen = await historyPose(page);
  const changedNormalizedZoom = changedFullscreen.scale / resizedFactor;

  await page.getByRole("button", { name: "Exit fullscreen (Esc)" }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBe(null);
  await expect.poll(async () => (await historyPose(page)).scale)
    .toBeCloseTo(changedNormalizedZoom, 8);
  const firstExit = await historyPose(page);
  expect(firstExit.centerX).toBeCloseTo(changedFullscreen.centerX, 8);
  expect(firstExit.centerY).toBeCloseTo(changedFullscreen.centerY, 8);
  expect(firstExit.scale).toBeCloseTo(changedNormalizedZoom, 8);

  const normalSurfaceBeforeResize = await surface.boundingBox();
  if (normalSurfaceBeforeResize === null) throw new Error("Restored History surface has no browser bounds");
  await page.setViewportSize({ width: 1000, height: 760 });
  await expect.poll(async () => (await surface.boundingBox())?.width).not.toBeCloseTo(normalSurfaceBeforeResize.width, 1);
  const secondPreviewSurface = await surface.boundingBox();
  if (secondPreviewSurface === null) throw new Error("Second preview surface has no browser bounds");
  const secondPreviewViewport = await historyViewport(page);
  await page.mouse.move(secondPreviewSurface.x + secondPreviewSurface.width / 2,
    secondPreviewSurface.y + secondPreviewSurface.height / 2);
  await page.mouse.wheel(0, 8_000);
  const normalMinimum = await historyPose(page);
  await page.mouse.wheel(0, 8_000);
  await expect(canvas).toHaveAttribute("viewBox", normalMinimum.viewBox);
  await page.mouse.wheel(0, -420);
  await expect.poll(async () => (await historyPose(page)).scale).toBeGreaterThan(normalMinimum.scale);
  const secondPreview = await historyPose(page);

  await page.getByRole("button", { name: "Enter fullscreen (Shift+F)" }).click();
  await expect.poll(() => surface.evaluate((element) => document.fullscreenElement === element)).toBe(true);
  const secondFullscreenSurface = await surface.boundingBox();
  if (secondFullscreenSurface === null) throw new Error("Second fullscreen surface has no browser bounds");
  const secondFullscreenViewport = await historyViewport(page);
  const secondFactor = Math.min(
    secondFullscreenViewport.width / secondPreviewViewport.width,
    secondFullscreenViewport.height / secondPreviewViewport.height,
  );
  const secondEntry = await historyPose(page);
  expect(secondEntry.centerX).toBeCloseTo(secondPreview.centerX, 8);
  expect(secondEntry.centerY).toBeCloseTo(secondPreview.centerY, 8);
  expect(secondEntry.scale).toBeCloseTo(secondPreview.scale * secondFactor, 8);

  const focusedNode = await visibleHistoryNode(page);
  await focusedNode.link.focus();
  await expect(focusedNode.link).toBeFocused();
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute("aria-live", "polite");
  await expect(summary).toHaveAttribute("aria-atomic", "true");
  const focusedSummary = await summaryMetrics(page);
  expect(focusedSummary.contained).toBe(true);
  expect(focusedSummary.noOverflow).toBe(true);
  expect(focusedSummary.pointerEvents.every((value) => value === "none")).toBe(true);

  await page.mouse.move(secondFullscreenSurface.x + secondFullscreenSurface.width / 2,
    secondFullscreenSurface.y + secondFullscreenSurface.height / 2);
  await page.mouse.wheel(0, 8_000);
  await expect.poll(async () => (await historyPose(page)).scale)
    .toBeCloseTo(normalMinimum.scale * secondFactor, 6);
  const fullscreenMinimum = await historyPose(page);
  await page.mouse.wheel(0, 8_000);
  await expect(canvas).toHaveAttribute("viewBox", fullscreenMinimum.viewBox);
  const zoomedSummary = await summaryMetrics(page);
  expect(zoomedSummary.top).toBeCloseTo(focusedSummary.top, 6);
  expect(zoomedSummary.right).toBeCloseTo(focusedSummary.right, 6);
  expect(zoomedSummary.width).toBeCloseTo(focusedSummary.width, 6);
  expect(zoomedSummary.height).toBeCloseTo(focusedSummary.height, 6);

  await panToHorizontalLimit(page, "ArrowLeft");
  const left = await safeArea(page);
  expect(left.count).toBeGreaterThan(0);
  expect(left.violations, "left-limit visible SVG text safe area").toEqual([]);
  await panToHorizontalLimit(page, "ArrowRight");
  const right = await safeArea(page);
  expect(right.count).toBeGreaterThan(0);
  expect(right.violations, "right-limit visible SVG text safe area").toEqual([]);
  expect([...left.labels, ...right.labels].some((label) => /CURRENT STATE|Current:/u.test(label))).toBe(true);
  await expect(minimap).toBeVisible();
  await expect(page.getByRole("button", { name: "Exit fullscreen (Esc)" })).toBeVisible();

  await page.getByRole("button", { name: "Exit fullscreen (Esc)" }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBe(null);
  console.log(JSON.stringify({
    fixture: process.env.CHRONICLE_RELEASE_FIXTURE,
    firstEntry: { factor: firstFactor, preview: firstPreview.scale, rendered: firstEntry.scale },
    firstResize: { factor: resizedFactor, rendered: resizedFullscreen.scale },
    firstExit: { normalized: changedNormalizedZoom, rendered: firstExit.scale },
    secondEntry: { factor: secondFactor, preview: secondPreview.scale, rendered: secondEntry.scale },
    transformedMinimum: { normalized: normalMinimum.scale, rendered: fullscreenMinimum.scale },
    summary: hoveredSummary,
    safeArea: {
      leftLimit: { count: left.count, minimumLeft: left.minimumLeft, minimumRight: left.minimumRight },
      rightLimit: { count: right.count, minimumLeft: right.minimumLeft, minimumRight: right.minimumRight },
    },
  }));
  expect(failedResponses).toEqual([]);
  expect(errors).toEqual([]);
});
