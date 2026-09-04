import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "history.visual.spec.ts",
  snapshotPathTemplate: "{testDir}/snapshots/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      maxDiffPixelRatio: 0.002,
    },
  },
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    headless: true,
    colorScheme: "light",
    deviceScaleFactor: 1,
    locale: "en-US",
    reducedMotion: "reduce",
    timezoneId: "UTC",
    viewport: { width: 2048, height: 1000 },
  },
});
