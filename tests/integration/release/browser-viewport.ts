import type { Page } from "@playwright/test";

export async function resizeChromiumViewport(
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  if (await page.evaluate(() => document.fullscreenElement === null)) {
    await page.setViewportSize({ width, height });
    return;
  }

  // Chromium rejects Browser.setWindowBounds while its window is fullscreen.
  // Device-metrics emulation still delivers the viewport resize that the app
  // must handle, without attempting the invalid native-window operation.
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    });
  } finally {
    await session.detach();
  }
}
