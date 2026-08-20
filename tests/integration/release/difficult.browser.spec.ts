import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.skip(process.env.CHRONICLE_RELEASE_FIXTURE !== "difficult", "difficult packaged-app flow");

test("difficult project remains understandable through the packaged application", async ({ page }) => {
  test.setTimeout(120_000);
  const failures: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("requestfailed", (request) => failures.push(`${request.method()} ${request.url()}`));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Current", exact: true })).toBeVisible();
  await expect(page.getByText("The merged recovery path is accepted after clock-domain evidence disproved the executor hypothesis.")).toBeVisible();
  await expect(page.getByRole("link", { name: "REC-003" })).toBeVisible();

  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.getByRole("link", { name: /CORE-005\. Mainline Reverted to Baseline/u })).toBeVisible();
  await expect(page.getByRole("link", { name: /EXEC-001\. Scheduler Isolation Rejected/u })).toBeVisible();
  await expect(page.getByRole("link", { name: /EXEC-002\. Executor Path Abandoned/u })).toBeVisible();
  await expect(page.getByRole("link", { name: /REC-002\. Recovery Merge Accepted/u })).toBeVisible();
  await expect(page.getByRole("link", { name: /REC-003\. Executor Hypothesis Disproved/u })).toBeVisible();

  await page.getByRole("link", { name: "Roadmap", exact: true }).click();
  await expect(page.getByRole("heading", { name: "RM-002 Tune executor scheduling" })).toBeVisible();
  await expect(page.getByText("superseded", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "RM-004 Integration Validation" })).toBeVisible();
  await expect(page.getByText("Cross-platform benchmark acceptance is pending.")).toBeVisible();

  await page.goto("/milestones/TIM-002");
  await expect(page.getByRole("heading", { name: "Normalization Fix Accepted" })).toBeVisible();
  await expect(page.getByText("EVT-000002")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rejected missing validation for unknown and non-finite clock metadata." })).toBeVisible();
  await expect(page.getByText("EVT-000004")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rejected nondeterministic ties and missing duplicate-sequence coverage." })).toBeVisible();
  await expect(page.getByText("EVT-000007")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Accepted the third implementation with test and diff evidence." })).toBeVisible();
  await expect(page.getByLabel("Actual diff EVD-0007")).toContainText("normalized");

  await page.goto("/milestones/CORE-002");
  await expect(page.getByRole("heading", { name: "Visible amendments" })).toBeVisible();
  await expect(page.getByText("REV-000001")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(failures).toEqual([]);
});
