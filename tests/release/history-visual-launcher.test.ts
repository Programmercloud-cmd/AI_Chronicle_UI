import { afterEach, describe, expect, it, vi } from "vitest";

import { warmHistoryFixture } from "../../scripts/history-visual.mjs";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function fixtureBrowser(overrides: Record<string, unknown> = {}) {
  const response = { ok: vi.fn(() => true), status: vi.fn(() => 200) };
  const page = {
    goto: vi.fn(async () => response),
    getByRole: vi.fn(() => ({ waitFor: vi.fn(async () => undefined) })),
    getByLabel: vi.fn(() => ({ waitFor: vi.fn(async () => undefined) })),
    locator: vi.fn(() => ({ count: vi.fn(async () => 0) })),
    ...overrides,
  };
  const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => undefined) };
  return { browser, page, response };
}

describe("History visual fixture warm-up", () => {
  afterEach(() => vi.useRealTimers());

  it("loads the transformed fixture and verifies its ready UI before returning", async () => {
    const { browser, page } = fixtureBrowser();
    const launchBrowser = vi.fn(async () => browser);

    await warmHistoryFixture({ launchBrowser, url: "http://fixture.test/fixture.html", timeoutMs: 42_000 });

    expect(page.goto).toHaveBeenCalledWith("http://fixture.test/fixture.html", {
      waitUntil: "networkidle",
      timeout: expect.any(Number),
    });
    expect(page.goto.mock.calls[0]?.[1]?.timeout).toBeLessThanOrEqual(42_000);
    expect(page.goto.mock.calls[0]?.[1]?.timeout).toBeGreaterThan(0);
    expect(page.getByRole).toHaveBeenCalledWith("heading", { name: "History" });
    expect(page.getByLabel).toHaveBeenCalledWith("Navigable project history timeline");
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("fails actionably and closes Chromium when the fixture cannot become ready", async () => {
    const { browser } = fixtureBrowser({
      goto: vi.fn(async () => {
        throw new Error("navigation timed out");
      }),
    });

    await expect(warmHistoryFixture({
      launchBrowser: async () => browser,
      timeoutMs: 12_345,
    })).rejects.toThrow(
      "History visual fixture did not become ready within 12345ms before Playwright started: navigation timed out",
    );
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("applies the overall warm-up deadline to page creation", async () => {
    vi.useFakeTimers();
    const pendingPage = deferred<never>();
    const browser = {
      newPage: vi.fn(() => pendingPage.promise),
      close: vi.fn(async () => undefined),
    };
    const result = warmHistoryFixture({ launchBrowser: async () => browser, timeoutMs: 100, closeTimeoutMs: 20 });
    const assertion = expect(result).rejects.toThrow(
      /did not become ready within 100ms.*creating the History fixture warm-up page timed out/su,
    );

    await vi.advanceTimersByTimeAsync(100);

    await assertion;
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("applies the overall warm-up deadline to the Vite overlay check", async () => {
    vi.useFakeTimers();
    const pendingCount = deferred<never>();
    const { browser } = fixtureBrowser({
      locator: vi.fn(() => ({ count: vi.fn(() => pendingCount.promise) })),
    });
    const result = warmHistoryFixture({ launchBrowser: async () => browser, timeoutMs: 100, closeTimeoutMs: 20 });
    const assertion = expect(result).rejects.toThrow(
      /did not become ready within 100ms.*checking the History fixture for Vite errors timed out/su,
    );

    await vi.advanceTimersByTimeAsync(100);

    await assertion;
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("bounds cleanup when closing the warm-up browser stalls", async () => {
    vi.useFakeTimers();
    const pendingClose = deferred<never>();
    const { browser } = fixtureBrowser();
    browser.close = vi.fn(() => pendingClose.promise);
    const result = warmHistoryFixture({ launchBrowser: async () => browser, timeoutMs: 100, closeTimeoutMs: 25 });
    const assertion = expect(result).rejects.toThrow(
      "History visual fixture warm-up cleanup failed: closing the History fixture warm-up browser timed out after 25ms",
    );

    await vi.advanceTimersByTimeAsync(25);

    await assertion;
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("preserves the primary readiness error when bounded cleanup also fails", async () => {
    vi.useFakeTimers();
    const pendingClose = deferred<never>();
    const { browser } = fixtureBrowser({
      goto: vi.fn(async () => {
        throw new Error("primary transform failure");
      }),
    });
    browser.close = vi.fn(() => pendingClose.promise);
    const result = warmHistoryFixture({ launchBrowser: async () => browser, timeoutMs: 100, closeTimeoutMs: 25 });
    const assertion = expect(result).rejects.toMatchObject({
      message: expect.stringContaining("primary transform failure"),
      cleanupError: expect.objectContaining({
        message: "closing the History fixture warm-up browser timed out after 25ms",
      }),
    });

    await vi.advanceTimersByTimeAsync(25);

    await assertion;
    expect(browser.close).toHaveBeenCalledOnce();
  });
});
