import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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
  await expect(page.getByLabel("Scrollable project history timeline")).toBeVisible();
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
