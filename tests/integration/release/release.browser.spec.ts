import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

interface RenderedHistoryPose {
  readonly centerX: number;
  readonly centerY: number;
  readonly scale: number;
  readonly viewBox: string;
  readonly minimap: readonly string[];
}

async function renderedHistoryPose(page: Page): Promise<RenderedHistoryPose> {
  const viewBox = await page.locator(".history-canvas").getAttribute("viewBox");
  if (viewBox === null) throw new Error("History viewBox is unavailable");
  const [left, top, width, height] = viewBox.split(/\s+/u).map(Number);
  if (left === undefined || top === undefined || width === undefined || height === undefined ||
    [left, top, width, height].some((value) => !Number.isFinite(value))) {
    throw new Error(`Invalid History viewBox: ${viewBox}`);
  }
  const renderedWidth = await page.locator(".history-canvas")
    .evaluate((element) => element.getBoundingClientRect().width);
  const minimapOutline = page.locator("[data-minimap-viewport='outline']");
  const minimap = await Promise.all(["x", "y", "width", "height"].map(async (name) =>
    await minimapOutline.getAttribute(name) ?? ""));
  return {
    centerX: left + width / 2,
    centerY: top + height / 2,
    scale: renderedWidth / width,
    viewBox,
    minimap,
  };
}

async function expectExactHistoryPose(page: Page, expected: RenderedHistoryPose): Promise<void> {
  await expect.poll(async () => (await renderedHistoryPose(page)).viewBox).toBe(expected.viewBox);
  const actual = await renderedHistoryPose(page);
  expect(actual.centerX).toBeCloseTo(expected.centerX, 10);
  expect(actual.centerY).toBeCloseTo(expected.centerY, 10);
  expect(actual.scale).toBeCloseTo(expected.scale, 10);
  expect(actual.minimap).toEqual(expected.minimap);
}

async function openHistoryMilestone(page: Page, label: RegExp): Promise<void> {
  const link: Locator = page.getByRole("link", { name: label });
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
}

test.skip(process.env.CHRONICLE_RELEASE_FIXTURE === "difficult", "canonical packaged-app flow");

test("packaged Chronicle routes remain usable under production CSP", async ({ page }) => {
  // Four full-view axe scans plus the lazy diff renderer exceed Playwright's
  // 30-second aggregate test budget on the Windows verification host.
  // Locator and assertion timeouts remain at their normal defaults.
  test.setTimeout(120_000);
  const applicationOrigin = new URL(process.env.CHRONICLE_RELEASE_ORIGIN!).origin;
  const errors: string[] = [];
  const failedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      errors.push(`${message.text()}${location.url === "" ? "" : ` (${location.url})`}`);
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => errors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));
  page.on("response", (response) => {
    if (response.status() >= 400 && new URL(response.url()).origin === applicationOrigin) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Current", exact: true })).toBeVisible();
  await expect(page.getByText("Stable timestamp handling is accepted on the canonical replay.")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("link", { name: "History" }).click();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await expect(page.getByLabel("Navigable project history timeline")).toBeVisible();
  await expect(page.locator("#history-navigation-hint")).toHaveText(
    "Drag: pan · Wheel: zoom · Ctrl+drag: zoom area · F: fit current · Shift+F: fullscreen",
  );
  await expect(page.getByRole("group", { name: "Branching project history" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Project history overview minimap" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("link", { name: "Roadmap" }).click();
  await expect(page.getByRole("heading", { name: "Roadmap" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Project roadmap" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.goto("/milestones/TIM-002");
  await expect(page.getByRole("heading", { name: "Alternative Fix" })).toBeVisible();
  await expect(page.getByLabel("Actual diff EVD-0008")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toContain("dark");
  expect(await page.locator("[style]").count()).toBe(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(failedResponses).toEqual([]);
  expect(errors).toEqual([]);
});

test("packaged fullscreen, neighborhood, mixed Back, and camera-session flow stays exact", async ({ page }) => {
  test.setTimeout(120_000);
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
  await expect(surface).toBeVisible();
  const canonicalPose = await renderedHistoryPose(page);
  await surface.focus();
  await page.keyboard.press("ArrowLeft");
  const surfaceBox = await surface.boundingBox();
  if (surfaceBox === null) throw new Error("History surface has no browser bounds");
  await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.62, surfaceBox.y + surfaceBox.height * 0.44);
  await page.mouse.wheel(0, -360);
  await expect.poll(async () => (await renderedHistoryPose(page)).viewBox).not.toBe(canonicalPose.viewBox);
  const manualPose = await renderedHistoryPose(page);
  expect(manualPose.scale).not.toBeCloseTo(canonicalPose.scale, 10);

  let routePose = manualPose;
  if (await page.evaluate(() => document.fullscreenEnabled)) {
    await surface.focus();
    await page.keyboard.press("Shift+F");
    await expect.poll(() => surface.evaluate((element) => document.fullscreenElement === element)).toBe(true);
    const enteredPose = await renderedHistoryPose(page);
    expect(enteredPose.centerX).toBeCloseTo(manualPose.centerX, 10);
    expect(enteredPose.centerY).toBeCloseTo(manualPose.centerY, 10);
    expect(enteredPose.scale).toBeCloseTo(manualPose.scale, 10);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(() => surface.evaluate((element) => document.fullscreenElement === element)).toBe(true);
    await expect.poll(() => surface.evaluate((element) => [element.clientWidth, element.clientHeight])).toEqual([1280, 800]);
    const resizedFullscreenPose = await renderedHistoryPose(page);
    expect(resizedFullscreenPose.centerX).toBeCloseTo(manualPose.centerX, 10);
    expect(resizedFullscreenPose.centerY).toBeCloseTo(manualPose.centerY, 10);
    expect(resizedFullscreenPose.scale).toBeCloseTo(manualPose.scale, 10);
    expect(resizedFullscreenPose.minimap.every((value) => Number.isFinite(Number(value)))).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.getByRole("button", { name: "Exit fullscreen (Esc)" }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBe(null);
    routePose = await renderedHistoryPose(page);
    expect(routePose.centerX).toBeCloseTo(manualPose.centerX, 10);
    expect(routePose.centerY).toBeCloseTo(manualPose.centerY, 10);
    expect(routePose.scale).toBeCloseTo(manualPose.scale, 10);
  } else {
    test.info().annotations.push({
      type: "fullscreen",
      description: "Native Fullscreen API unavailable; packaged navigation/camera assertions still ran.",
    });
  }

  await openHistoryMilestone(page, /^TIM-003\./u);
  await expect(page.getByRole("heading", { name: "Validation Passed" })).toBeVisible();
  await page.getByRole("link", { name: /Open child milestone: Stable Implementation Accepted/u }).click();
  await expect(page.getByRole("heading", { name: "Stable Implementation Accepted" })).toBeVisible();
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Validation Passed" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await expectExactHistoryPose(page, routePose);

  await page.goForward();
  await expect(page.getByRole("heading", { name: "Validation Passed" })).toBeVisible();
  await page.getByRole("link", { name: /Open child milestone: Stable Implementation Accepted/u }).click();
  await expect(page.getByRole("heading", { name: "Stable Implementation Accepted" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Validation Passed" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await expectExactHistoryPose(page, routePose);

  await page.goto("/milestones/TIM-004");
  await expect(page.getByRole("heading", { name: "Stable Implementation Accepted" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/history$/u);

  expect(failedResponses).toEqual([]);
  expect(errors).toEqual([]);
});
