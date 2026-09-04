import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { createServer } from "vite";

import { assertCanonicalEnvironment, assertVisualArgumentsAllowed } from "./canonical-environment.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const fixtureUrl = "http://127.0.0.1:5173/tests/visual/history/fixture.html?fixture=linear&theme=light";
const warmupTimeoutMs = 120_000;
const cleanupTimeoutMs = 10_000;

function withTimeout(operation, timeoutMs, label) {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function warmHistoryFixture({
  launchBrowser = ({ timeout }) => chromium.launch({ headless: true, timeout }),
  url = fixtureUrl,
  timeoutMs = warmupTimeoutMs,
  closeTimeoutMs = cleanupTimeoutMs,
} = {}) {
  let browser;
  const deadline = Date.now() + timeoutMs;
  const remainingTime = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("warm-up deadline expired");
    return remaining;
  };
  const withinWarmup = (operation, label) => withTimeout(operation, remainingTime(), label);
  let primaryError;
  try {
    browser = await withinWarmup(
      () => launchBrowser({ timeout: remainingTime() }),
      "launching Chromium for History fixture warm-up",
    );
    const page = await withinWarmup(() => browser.newPage(), "creating the History fixture warm-up page");
    const response = await withinWarmup(
      () => page.goto(url, { waitUntil: "networkidle", timeout: remainingTime() }),
      "loading and transforming the History fixture",
    );
    if (response === null || !response.ok()) {
      throw new Error(`fixture returned ${response?.status() ?? "no HTTP response"}`);
    }
    await withinWarmup(
      () => page.getByRole("heading", { name: "History" }).waitFor({ state: "visible", timeout: remainingTime() }),
      "waiting for the History fixture heading",
    );
    await withinWarmup(
      () => page.getByLabel("Navigable project history timeline").waitFor({
        state: "visible",
        timeout: remainingTime(),
      }),
      "waiting for the History fixture timeline",
    );
    const overlayCount = await withinWarmup(
      () => page.locator("vite-error-overlay, .vite-error-overlay").count(),
      "checking the History fixture for Vite errors",
    );
    if (overlayCount > 0) {
      throw new Error("Vite reported a fixture transformation error");
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    primaryError = new Error(
      `History visual fixture did not become ready within ${timeoutMs}ms before Playwright started: ${detail}`,
      { cause },
    );
  }

  if (browser !== undefined) {
    try {
      await withTimeout(() => browser.close(), closeTimeoutMs, "closing the History fixture warm-up browser");
    } catch (cleanupError) {
      if (primaryError === undefined) {
        const detail = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        throw new Error(`History visual fixture warm-up cleanup failed: ${detail}`, { cause: cleanupError });
      }
      Object.defineProperty(primaryError, "cleanupError", { value: cleanupError, enumerable: false });
    }
  }

  if (primaryError !== undefined) throw primaryError;
}

function runVisualSuite() {
  return new Promise((resolve, reject) => {
    const cli = path.join(repositoryRoot, "node_modules", "@playwright", "test", "cli.js");
    const config = path.join(repositoryRoot, "tests", "visual", "history", "playwright.config.ts");
    const child = spawn(process.execPath, [cli, "test", "--config", config, "--reporter=line", ...process.argv.slice(2)], {
      cwd: repositoryRoot,
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`History visual suite failed (${code})`));
    });
  });
}

async function main() {
  assertCanonicalEnvironment();
  assertVisualArgumentsAllowed(process.argv.slice(2));
  const vite = await createServer({
    configFile: path.join(repositoryRoot, "vite.config.ts"),
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
  });

  try {
    await vite.listen();
    await warmHistoryFixture();
    await runVisualSuite();
  } finally {
    await vite.close();
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) await main();
