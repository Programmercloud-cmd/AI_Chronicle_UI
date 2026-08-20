import { describe, expect, it } from "vitest";

import {
  type ChronicleRecordKind,
  validateRecordShape,
} from "../../src/schema";
import { cloneFixture, validRecords } from "./fixtures";

describe("validateRecordShape valid records", () => {
  for (const [kind, value] of Object.entries(validRecords) as [
    ChronicleRecordKind,
    unknown,
  ][]) {
    it(`accepts a representative ${kind} record`, () => {
      const result = validateRecordShape(kind, value, {
        sourcePath: `chronicle/${kind}.yaml`,
      });

      expect(result).toEqual({ ok: true, value });
    });
  }

  it("accepts every evidence source discriminator", () => {
    const urlEvidence = cloneFixture("evidence") as Record<string, unknown>;
    urlEvidence.source = { kind: "url", url: "https://example.test/report/42" };

    const repositoryEvidence = cloneFixture("evidence") as Record<string, unknown>;
    repositoryEvidence.source = {
      kind: "repository_ref",
      path: "src/timestamps/normalize.ts",
      revision: "abc123",
    };

    expect(
      validateRecordShape("evidence", urlEvidence, { sourcePath: "url.yaml" }).ok,
    ).toBe(true);
    expect(
      validateRecordShape("evidence", repositoryEvidence, {
        sourcePath: "repository.yaml",
      }).ok,
    ).toBe(true);
  });

  it("accepts every revision operation discriminator", () => {
    const revision = cloneFixture("revision") as Record<string, unknown>;
    revision.changes = [
      { operation: "add", path: "/description", value: "Added later." },
      {
        operation: "replace",
        path: "/title",
        from: "Old title",
        value: "New title",
      },
      { operation: "remove", path: "/description", from: "Added later." },
    ];

    expect(
      validateRecordShape("revision", revision, { sourcePath: "revision.yaml" }).ok,
    ).toBe(true);
  });

  it("accepts an external blocker summary without a fabricated reference", () => {
    const current = cloneFixture("current") as Record<string, unknown>;
    current.blocked = [{ summary: "Waiting for external approval." }];

    expect(
      validateRecordShape("current", current, { sourcePath: "current.yaml" }).ok,
    ).toBe(true);
  });

  it("accepts the conditional superseded roadmap shape", () => {
    const roadmap = cloneFixture("roadmap") as {
      items: Record<string, unknown>[];
    };
    roadmap.items = [
      {
        id: "RM-006",
        title: "Old release path",
        status: "superseded",
        order: 60,
        superseded_by: "RM-007",
      },
    ];

    expect(
      validateRecordShape("roadmap", roadmap, { sourcePath: "roadmap.yaml" }).ok,
    ).toBe(true);
  });

  it("accepts an uppercase milestone domain without an arbitrary length cap", () => {
    const milestone = cloneFixture("milestone") as Record<string, unknown>;
    milestone.id = "EXTREMELYLONGDOMAIN123-001";

    expect(
      validateRecordShape("milestone", milestone, {
        sourcePath: "milestones/EXTREMELYLONGDOMAIN123-001.yaml",
      }).ok,
    ).toBe(true);
  });
});

interface InvalidFixture {
  name: string;
  kind: ChronicleRecordKind;
  value: unknown;
  expectedPath?: string;
  expectedKeyword?: string;
}

const withProperty = (
  kind: ChronicleRecordKind,
  property: string,
  value: unknown,
): unknown => ({ ...(cloneFixture(kind) as object), [property]: value });

const invalidFixtures: InvalidFixture[] = [
  {
    name: "unknown top-level property",
    kind: "branch",
    value: withProperty("branch", "color", "orange"),
    expectedKeyword: "additionalProperties",
  },
  {
    name: "unknown nested property",
    kind: "project",
    value: {
      ...(cloneFixture("project") as object),
      display: { timezone: "Europe/Paris", locale: "fr-FR" },
    },
    expectedPath: "/display",
    expectedKeyword: "additionalProperties",
  },
  {
    name: "unsupported schema version",
    kind: "branch",
    value: withProperty("branch", "schema_version", 2),
    expectedPath: "/schema_version",
    expectedKeyword: "const",
  },
  {
    name: "malformed project ID",
    kind: "project",
    value: {
      ...(cloneFixture("project") as object),
      project: { id: "Not Portable", title: "Project" },
    },
    expectedPath: "/project/id",
    expectedKeyword: "pattern",
  },
  {
    name: "malformed branch ID",
    kind: "branch",
    value: withProperty("branch", "id", "main"),
    expectedPath: "/id",
    expectedKeyword: "pattern",
  },
  {
    name: "malformed milestone ID",
    kind: "milestone",
    value: withProperty("milestone", "id", "core-6"),
    expectedPath: "/id",
    expectedKeyword: "pattern",
  },
  {
    name: "reserved milestone domain",
    kind: "milestone",
    value: withProperty("milestone", "id", "RM-004"),
    expectedPath: "/id",
    expectedKeyword: "pattern",
  },
  {
    name: "malformed evidence ID",
    kind: "evidence",
    value: withProperty("evidence", "id", "EVD-8"),
    expectedPath: "/id",
    expectedKeyword: "pattern",
  },
  {
    name: "malformed engineering event ID",
    kind: "engineering-event",
    value: withProperty("engineering-event", "id", "EVT-14"),
    expectedPath: "/id",
    expectedKeyword: "pattern",
  },
  {
    name: "malformed revision ID",
    kind: "revision",
    value: withProperty("revision", "id", "REV-3"),
    expectedPath: "/id",
    expectedKeyword: "pattern",
  },
  {
    name: "offsetless milestone timestamp",
    kind: "milestone",
    value: withProperty("milestone", "occurred_at", "2026-05-05T14:30:52"),
    expectedPath: "/occurred_at",
  },
  {
    name: "date-only engineering timestamp",
    kind: "engineering-event",
    value: withProperty("engineering-event", "recorded_at", "2026-05-05"),
    expectedPath: "/recorded_at",
  },
  {
    name: "plausible but nonexistent IANA timezone",
    kind: "project",
    value: {
      ...(cloneFixture("project") as object),
      display: { timezone: "Mars/Olympus" },
    },
    expectedPath: "/display/timezone",
    expectedKeyword: "format",
  },
  {
    name: "missing required title",
    kind: "branch",
    value: { schema_version: 1, id: "BR-MAIN" },
    expectedKeyword: "required",
  },
  {
    name: "invalid milestone enum",
    kind: "milestone",
    value: withProperty("milestone", "status", "superseded"),
    expectedPath: "/status",
    expectedKeyword: "enum",
  },
  {
    name: "parents must be an array",
    kind: "milestone",
    value: withProperty("milestone", "parents", "CORE-005"),
    expectedPath: "/parents",
    expectedKeyword: "type",
  },
  {
    name: "history projection IDs are structurally unique",
    kind: "current",
    value: withProperty("current", "history_projection", ["RM-004", "RM-004"]),
    expectedPath: "/history_projection",
    expectedKeyword: "uniqueItems",
  },
  {
    name: "present blocked_by cannot be empty",
    kind: "current",
    value: withProperty("current", "blocked", [
      { summary: "External blocker", blocked_by: [] },
    ]),
    expectedPath: "/blocked/0/blocked_by",
    expectedKeyword: "minItems",
  },
  {
    name: "blocked roadmap item requires summary",
    kind: "roadmap",
    value: {
      schema_version: 1,
      updated_at: "2026-05-05T15:00:00+02:00",
      items: [{ id: "RM-004", title: "Blocked", status: "blocked", order: 1 }],
    },
    expectedPath: "/items/0",
    expectedKeyword: "required",
  },
  {
    name: "non-superseded roadmap item rejects superseded_by",
    kind: "roadmap",
    value: {
      schema_version: 1,
      updated_at: "2026-05-05T15:00:00+02:00",
      items: [
        {
          id: "RM-004",
          title: "Active",
          status: "active",
          order: 1,
          superseded_by: "RM-005",
        },
      ],
    },
    expectedPath: "/items/0",
  },
  {
    name: "superseded roadmap item requires superseded_by",
    kind: "roadmap",
    value: {
      schema_version: 1,
      updated_at: "2026-05-05T15:00:00+02:00",
      items: [{ id: "RM-004", title: "Old", status: "superseded", order: 1 }],
    },
    expectedPath: "/items/0",
    expectedKeyword: "required",
  },
  {
    name: "evidence source rejects mixed union properties",
    kind: "evidence",
    value: {
      ...(cloneFixture("evidence") as object),
      source: {
        kind: "url",
        url: "https://example.test/report",
        path: "report.txt",
      },
    },
    expectedPath: "/source",
    expectedKeyword: "oneOf",
  },
  {
    name: "evidence source rejects unknown discriminator",
    kind: "evidence",
    value: {
      ...(cloneFixture("evidence") as object),
      source: { kind: "database", id: "42" },
    },
    expectedPath: "/source",
    expectedKeyword: "oneOf",
  },
  {
    name: "evidence URL rejects unsafe scheme",
    kind: "evidence",
    value: {
      ...(cloneFixture("evidence") as object),
      source: { kind: "url", url: "file:///etc/passwd" },
    },
    expectedPath: "/source",
  },
  {
    name: "artifact source rejects traversal",
    kind: "evidence",
    value: {
      ...(cloneFixture("evidence") as object),
      source: {
        kind: "artifact",
        path: "../secret.txt",
        media_type: "text/plain",
        sha256: "53f3d9a6c2130000000000000000000000000000000000000000000000000000",
      },
    },
    expectedPath: "/source",
  },
  {
    name: "origin rejects unknown keys",
    kind: "evidence",
    value: {
      ...(cloneFixture("evidence") as object),
      origin: { tool: "git", shell: true },
    },
    expectedPath: "/origin",
    expectedKeyword: "additionalProperties",
  },
  {
    name: "typed reference enforces discriminator-specific ID",
    kind: "current",
    value: withProperty("current", "blocked", [
      {
        summary: "Blocked",
        blocked_by: [{ type: "milestone", id: "RM-004" }],
      },
    ]),
    expectedPath: "/blocked/0/blocked_by/0",
    expectedKeyword: "oneOf",
  },
  {
    name: "invalid engineering outcome enum",
    kind: "engineering-event",
    value: withProperty("engineering-event", "outcome", "maybe"),
    expectedPath: "/outcome",
    expectedKeyword: "enum",
  },
  {
    name: "revision target enforces discriminator-specific ID",
    kind: "revision",
    value: withProperty("revision", "target", {
      type: "branch",
      id: "CORE-003",
    }),
    expectedPath: "/target",
    expectedKeyword: "oneOf",
  },
  {
    name: "add revision rejects from guard",
    kind: "revision",
    value: withProperty("revision", "changes", [
      { operation: "add", path: "/title", from: "old", value: "new" },
    ]),
    expectedPath: "/changes/0",
    expectedKeyword: "oneOf",
  },
  {
    name: "replace revision requires from guard",
    kind: "revision",
    value: withProperty("revision", "changes", [
      { operation: "replace", path: "/title", value: "new" },
    ]),
    expectedPath: "/changes/0",
    expectedKeyword: "oneOf",
  },
  {
    name: "remove revision rejects value",
    kind: "revision",
    value: withProperty("revision", "changes", [
      { operation: "remove", path: "/title", from: "old", value: null },
    ]),
    expectedPath: "/changes/0",
    expectedKeyword: "oneOf",
  },
  {
    name: "revision changes cannot be empty",
    kind: "revision",
    value: withProperty("revision", "changes", []),
    expectedPath: "/changes",
    expectedKeyword: "minItems",
  },
];

describe("validateRecordShape invalid matrix", () => {
  for (const fixture of invalidFixtures) {
    it(`rejects ${fixture.name}`, () => {
      const result = validateRecordShape(fixture.kind, fixture.value, {
        sourcePath: `fixtures/invalid/${fixture.name}.yaml`,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      if (fixture.expectedPath !== undefined) {
        expect(
          result.diagnostics.some((diagnostic) =>
            diagnostic.instancePath.startsWith(fixture.expectedPath!),
          ),
        ).toBe(true);
      }
      if (fixture.expectedKeyword !== undefined) {
        expect(
          result.diagnostics.some(
            (diagnostic) => diagnostic.keyword === fixture.expectedKeyword,
          ),
        ).toBe(true);
      }
    });
  }
});

describe("source-aware diagnostics", () => {
  it("reports source, kind, inferred record ID, path, and actionable message", () => {
    const result = validateRecordShape(
      "branch",
      withProperty("branch", "unexpected", true),
      { sourcePath: "chronicle/branches/BR-TIMING.yaml" },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.diagnostics[0]).toMatchObject({
      sourcePath: "chronicle/branches/BR-TIMING.yaml",
      recordKind: "branch",
      recordId: "BR-TIMING",
      instancePath: "",
      keyword: "additionalProperties",
      message: 'must not contain unknown property "unexpected"',
    });
  });

  it("uses an explicit record ID when the malformed value has none", () => {
    const result = validateRecordShape("branch", null, {
      sourcePath: "chronicle/branches/BR-MISSING.yaml",
      recordId: "BR-MISSING",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.every((entry) => entry.recordId === "BR-MISSING")).toBe(
      true,
    );
  });
});

describe("structural boundary", () => {
  it("does not perform cross-record, chronology, or filesystem checks", () => {
    const milestone = cloneFixture("milestone") as Record<string, unknown>;
    milestone.parents = [milestone.id];
    milestone.occurred_at = "2026-05-06T12:00:00+02:00";
    milestone.recorded_at = "2026-05-05T12:00:00+02:00";

    const current = cloneFixture("current") as Record<string, unknown>;
    current.milestone_id = "CORE-999";

    const evidence = cloneFixture("evidence") as Record<string, unknown>;
    evidence.source = {
      kind: "artifact",
      path: "evidence/artifacts/does-not-exist.txt",
      media_type: "text/plain",
      sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    };

    expect(
      validateRecordShape("milestone", milestone, { sourcePath: "milestone.yaml" }).ok,
    ).toBe(true);
    expect(
      validateRecordShape("current", current, { sourcePath: "current.yaml" }).ok,
    ).toBe(true);
    expect(
      validateRecordShape("evidence", evidence, { sourcePath: "evidence.yaml" }).ok,
    ).toBe(true);
  });
});
