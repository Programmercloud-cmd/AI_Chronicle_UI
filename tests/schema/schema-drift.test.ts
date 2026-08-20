import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, it } from "vitest";

it("keeps generated TypeScript declarations in sync with JSON Schema", () => {
  const script = path.resolve("scripts/schema-types.mjs");
  const output = execFileSync(process.execPath, [script, "--check"], {
    encoding: "utf8",
  });

  expect(output).toContain("Schema type drift check passed");
});
