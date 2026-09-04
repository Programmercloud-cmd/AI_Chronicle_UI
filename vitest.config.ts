import { defineConfig } from "vitest/config";

import { canonicalMarker } from "./scripts/canonical-environment.mjs";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    ...(process.env.CHRONICLE_CANONICAL_ENVIRONMENT === canonicalMarker ? { maxWorkers: 2 } : {}),
  },
});
