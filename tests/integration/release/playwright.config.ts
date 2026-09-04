import { defineConfig } from "@playwright/test";

const baseURL = process.env.CHRONICLE_RELEASE_ORIGIN;
if (baseURL === undefined) throw new Error("CHRONICLE_RELEASE_ORIGIN is required");

export default defineConfig({
  testDir: ".",
  testMatch: "*.browser.spec.ts",
  workers: 1,
  use: {
    baseURL,
    browserName: "chromium",
    headless: true,
    colorScheme: "light",
    deviceScaleFactor: 1,
    locale: "en-US",
    reducedMotion: "reduce",
    timezoneId: "UTC",
    viewport: { width: 1600, height: 1000 },
  },
});
