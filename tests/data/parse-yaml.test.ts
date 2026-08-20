import { describe, expect, it } from "vitest";

import { parseChronicleYaml } from "../../src/data";

describe("parseChronicleYaml", () => {
  it("parses one YAML 1.2 document into inert data", () => {
    const result = parseChronicleYaml("enabled: yes\ncount: 2\n", "project.yaml");

    expect(result).toEqual({ ok: true, value: { enabled: "yes", count: 2 } });
  });

  it.each([
    ["duplicate keys", "id: one\nid: two\n", "yaml-invalid"],
    ["alias", "base: &base { value: 1 }\ncopy: *base\n", "yaml-forbidden"],
    ["merge key", "base: &base { value: 1 }\ncopy:\n  <<: *base\n", "yaml-forbidden"],
    ["custom tag", "value: !danger payload\n", "yaml-forbidden"],
    ["multiple documents", "one: 1\n---\ntwo: 2\n", "yaml-invalid"],
    ["malformed structure", "value: [1, 2\n", "yaml-invalid"],
  ])("rejects %s", (_name, source, expectedCode) => {
    const result = parseChronicleYaml(source, "fixture.yaml");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((entry) => entry.code === expectedCode)).toBe(true);
    expect(result.diagnostics.every((entry) => entry.sourcePath === "fixture.yaml")).toBe(
      true,
    );
  });
});
