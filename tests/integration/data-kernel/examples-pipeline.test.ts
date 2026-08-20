import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadChronicle } from "../../../src/data";
import { validateChronicle } from "../../../src/domain";

describe("data-kernel example pipeline", () => {
  it.each(["canonical", "difficult"] as const)(
    "loads, projects revisions, validates references, and verifies artifacts for %s",
    async (fixture) => {
      const loaded = await loadChronicle(path.resolve("examples", fixture));
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics, null, 2));

      const validated = await validateChronicle(loaded.value);
      expect(validated.ok).toBe(true);
      if (!validated.ok) throw new Error(JSON.stringify(validated.diagnostics, null, 2));

      expect(validated.value.rootPath).toBe(path.resolve("examples", fixture));
      expect(Object.isFrozen(validated.value)).toBe(true);
      expect(validated.value.evidence.length).toBeGreaterThan(0);
    },
  );

  it("exposes the difficult fixture's guarded amendment through the validated projection", async () => {
    const loaded = await loadChronicle(path.resolve("examples", "difficult"));
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics, null, 2));

    const validated = await validateChronicle(loaded.value);
    if (!validated.ok) throw new Error(JSON.stringify(validated.diagnostics, null, 2));

    const baseline = validated.value.milestones.find(
      (record) => record.value.id === "CORE-002",
    );

    expect(baseline?.original.details?.known_limitations).toBeUndefined();
    expect(baseline?.value.details?.known_limitations).toEqual([
      "The baseline did not contain mixed-clock or delayed-input samples.",
    ]);
    expect(baseline?.amendments.map((amendment) => amendment.revisionId)).toEqual([
      "REV-000001",
    ]);
  });
});
