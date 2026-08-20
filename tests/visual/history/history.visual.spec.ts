import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const CASES = [
  { name: "light-mode", fixture: "linear", theme: "light" },
  { name: "dark-mode", fixture: "linear", theme: "dark" },
  { name: "canonical-branching", fixture: "canonical", theme: "light" },
  { name: "long-label", fixture: "long-label", theme: "light" },
  { name: "larger-multibranch", fixture: "multibranch", theme: "light" },
] as const;

const GEOMETRY_CASES = CASES.filter(({ fixture }) =>
  fixture === "canonical" || fixture === "long-label" || fixture === "multibranch",
);

function boxesIntersect(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y;
}

for (const visualCase of CASES) {
  test(visualCase.name, async ({ page }) => {
    await page.goto(`/tests/visual/history/fixture.html?fixture=${visualCase.fixture}&theme=${visualCase.theme}`);
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    await expect(page.locator(".history-page")).toHaveScreenshot(`${visualCase.name}.png`);
  });
}

for (const visualCase of GEOMETRY_CASES) {
  test(`${visualCase.name} keeps titles clear of timestamps`, async ({ page }) => {
    await page.goto(`/tests/visual/history/fixture.html?fixture=${visualCase.fixture}&theme=${visualCase.theme}`);
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
    await page.goto(`/tests/visual/history/fixture.html?fixture=canonical&theme=${theme}`);
    await expect(page.getByRole("main")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("250-milestone browser scale remains navigable", async ({ page }) => {
  const startedAt = Date.now();
  await page.goto("/tests/visual/history/fixture.html?fixture=scale&theme=light");
  await expect(page.locator(".history-node")).toHaveCount(280);
  const renderDurationMs = Date.now() - startedAt;
  expect(renderDurationMs).toBeLessThan(10_000);

  const viewport = page.getByLabel("Scrollable project history timeline");
  await expect(viewport).toBeVisible();
  const extent = await viewport.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(extent.scrollWidth).toBeGreaterThan(extent.clientWidth);

  await page.getByRole("button", { name: "Jump to current state" }).click();
  await expect(page.getByRole("link", { name: /S-249\. Scale milestone 249/u })).toBeFocused();
});
