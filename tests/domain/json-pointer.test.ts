import { describe, expect, it } from "vitest";

import { applyGuardedChange } from "../../src/domain";

describe("guarded JSON Pointer changes", () => {
  it("applies add, replace, and remove without mutating input", () => {
    const input = { id: "CORE-001", schema_version: 1, recorded_at: "2026-01-01T00:00:00+00:00", details: { title: "old", tags: ["a"] } };
    const replaced = applyGuardedChange(input, { operation: "replace", path: "/details/title", from: "old", value: "new" });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.value.details.title).toBe("new");
    expect(input.details.title).toBe("old");

    const added = applyGuardedChange(replaced.value, { operation: "add", path: "/details/note", value: "late" });
    expect(added.ok && (added.value.details as Record<string, unknown>).note).toBe("late");
    const removed = applyGuardedChange(added.ok ? added.value : replaced.value, { operation: "remove", path: "/details/tags", from: ["a"] });
    expect(removed.ok && Object.hasOwn(removed.value.details, "tags")).toBe(false);
  });

  it.each([
    ["/id", "immutable-field"],
    ["/schema_version", "immutable-field"],
    ["/recorded_at", "immutable-field"],
    ["/details/tags/0", "pointer-array-index"],
    ["/details/~2bad", "pointer-invalid-escape"],
    ["/details/__proto__/polluted", "pointer-unsafe"],
  ])("rejects unsafe pointer %s", (path, code) => {
    const result = applyGuardedChange(
      { id: "CORE-001", schema_version: 1, recorded_at: "2026-01-01T00:00:00+00:00", details: { tags: ["a"] } },
      { operation: "add", path, value: "x" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe(code);
  });

  it("requires guarded values to match deeply", () => {
    const result = applyGuardedChange(
      { details: { value: { a: 1, b: 2 } } },
      { operation: "replace", path: "/details/value", from: { a: 1, b: 3 }, value: null },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("guard-mismatch");
  });
});
