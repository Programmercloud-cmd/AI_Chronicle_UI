import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadChronicle } from "../../src/data";

const temporaryRoots: string[] = [];

async function tempRoot(label: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `chronicle-loader-${label}-`));
  temporaryRoots.push(root);
  return root;
}

async function writeJson(root: string, relativePath: string, value: unknown): Promise<void> {
  const target = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createMinimalChronicle(label: string): Promise<string> {
  const root = await tempRoot(label);
  await Promise.all([
    mkdir(path.join(root, "branches")),
    mkdir(path.join(root, "milestones")),
    mkdir(path.join(root, "engineering-events")),
    mkdir(path.join(root, "evidence", "records"), { recursive: true }),
  ]);
  await writeJson(root, "project.yaml", {
    schema_version: 1,
    project: { id: "minimal", title: "Minimal" },
    display: { timezone: "UTC" },
  });
  await writeJson(root, "roadmap.yaml", {
    schema_version: 1,
    updated_at: "2026-08-19T12:00:00Z",
    items: [],
  });
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("loadChronicle examples", () => {
  it.each([
    ["canonical", 2, 8, 6, 10, 0],
    ["difficult", 5, 14, 8, 16, 1],
  ] as const)(
    "loads the %s example structurally",
    async (name, branchCount, milestoneCount, eventCount, evidenceCount, revisionCount) => {
      const root = path.resolve("examples", name);
      const result = await loadChronicle(root);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.branches).toHaveLength(branchCount);
      expect(result.value.milestones).toHaveLength(milestoneCount);
      expect(result.value.engineeringEvents).toHaveLength(eventCount);
      expect(result.value.evidence).toHaveLength(evidenceCount);
      expect(result.value.revisions).toHaveLength(revisionCount);
      expect(result.value.current).toBeDefined();
    },
  );

  it("returns records in deterministic ordinal filename order", async () => {
    const root = await createMinimalChronicle("ordering");
    await writeJson(root, "branches/BR-ZETA.yaml", {
      schema_version: 1,
      id: "BR-ZETA",
      title: "Zeta",
    });
    await writeJson(root, "branches/BR-ALPHA.yaml", {
      schema_version: 1,
      id: "BR-ALPHA",
      title: "Alpha",
    });

    const result = await loadChronicle(root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.branches.map((record) => record.value.id)).toEqual([
      "BR-ALPHA",
      "BR-ZETA",
    ]);
  });
});

describe("loadChronicle failure behavior", () => {
  it("fails closed without a partial snapshot", async () => {
    const root = await createMinimalChronicle("closed");
    await writeFile(path.join(root, "project.yaml"), "schema_version: 1\nproject: [\n");

    const result = await loadChronicle(root);
    expect(result.ok).toBe(false);
    expect("value" in result).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((item) => item.sourcePath === "project.yaml")).toBe(
      true,
    );
  });

  it("reports a missing required file", async () => {
    const root = await createMinimalChronicle("missing-file");
    await rm(path.join(root, "roadmap.yaml"));

    const result = await loadChronicle(root);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "missing-required",
        sourcePath: "roadmap.yaml",
      }),
    );
  });

  it("reports a missing required directory", async () => {
    const root = await createMinimalChronicle("missing-directory");
    await rm(path.join(root, "milestones"), { recursive: true });

    const result = await loadChronicle(root);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "missing-required",
        sourcePath: "milestones",
      }),
    );
  });

  it("rejects wrong extensions rather than silently skipping them", async () => {
    const root = await createMinimalChronicle("extension");
    await writeFile(path.join(root, "branches", "BR-MAIN.yml"), "ignored: false\n");

    const result = await loadChronicle(root);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unexpected-entry",
        sourcePath: "branches/BR-MAIN.yml",
      }),
    );
  });

  it("requires record filename and ID to match exactly", async () => {
    const root = await createMinimalChronicle("filename");
    await writeJson(root, "branches/BR-WRONG.yaml", {
      schema_version: 1,
      id: "BR-MAIN",
      title: "Main",
    });

    const result = await loadChronicle(root);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "filename-id-mismatch",
        sourcePath: "branches/BR-WRONG.yaml",
        recordId: "BR-MAIN",
      }),
    );
  });

  it("propagates stable source-aware structural diagnostics", async () => {
    const root = await createMinimalChronicle("shape");
    await writeJson(root, "branches/BR-MAIN.yaml", {
      schema_version: 1,
      id: "BR-MAIN",
      title: "Main",
      color: "orange",
    });

    const first = await loadChronicle(root);
    const second = await loadChronicle(root);
    expect(first).toEqual(second);
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "shape-invalid",
        sourcePath: "branches/BR-MAIN.yaml",
        recordKind: "branch",
        recordId: "BR-MAIN",
        keyword: "additionalProperties",
      }),
    );
  });

  it("rejects case-colliding filenames where the filesystem supports both", async (context) => {
    if (process.platform === "win32" || process.platform === "darwin") {
      context.skip();
      return;
    }
    const root = await createMinimalChronicle("case-file");
    await writeJson(root, "branches/BR-MAIN.yaml", {
      schema_version: 1,
      id: "BR-MAIN",
      title: "Main",
    });
    await writeJson(root, "branches/br-main.yaml", {
      schema_version: 1,
      id: "BR-MAIN",
      title: "Duplicate spelling",
    });

    const result = await loadChronicle(root);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((item) => item.code === "case-collision")).toBe(true);
  });

  it("rejects case-colliding declared artifact locators", async () => {
    const root = await createMinimalChronicle("case-artifact");
    const baseEvidence = {
      schema_version: 1,
      captured_at: "2026-08-19T12:00:00Z",
      kind: "log",
      title: "Log",
    };
    await writeJson(root, "evidence/records/EVD-0001.yaml", {
      ...baseEvidence,
      id: "EVD-0001",
      source: {
        kind: "artifact",
        path: "evidence/artifacts/Report.txt",
        media_type: "text/plain",
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      },
    });
    await writeJson(root, "evidence/records/EVD-0002.yaml", {
      ...baseEvidence,
      id: "EVD-0002",
      source: {
        kind: "artifact",
        path: "evidence/artifacts/report.txt",
        media_type: "text/plain",
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      },
    });

    const result = await loadChronicle(root);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((item) => item.code === "case-collision")).toBe(true);
  });

  it("rejects symlinked authoritative record files", async (context) => {
    const root = await createMinimalChronicle("record-link");
    const target = path.join(root, "evidence", "target.yaml");
    await writeFile(target, "schema_version: 1\nid: BR-MAIN\ntitle: Main\n");

    try {
      await symlink(target, path.join(root, "branches", "BR-MAIN.yaml"), "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip();
        return;
      }
      throw error;
    }

    const result = await loadChronicle(root);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unexpected-entry",
        sourcePath: "branches/BR-MAIN.yaml",
      }),
    );
  });

  it("does not perform cross-record semantic validation", async () => {
    const root = await createMinimalChronicle("structural-only");
    await writeJson(root, "branches/BR-EMPTY.yaml", {
      schema_version: 1,
      id: "BR-EMPTY",
      title: "No milestones yet",
    });
    await writeJson(root, "current.yaml", {
      schema_version: 1,
      updated_at: "2026-08-19T12:00:00Z",
      milestone_id: "CORE-999",
      state: "Structurally valid but unresolved.",
    });

    const result = await loadChronicle(root);
    expect(result.ok).toBe(true);
  });

  it("rejects unexpected root entries", async () => {
    const root = await createMinimalChronicle("root-entry");
    await writeFile(path.join(root, "notes.txt"), "not part of Chronicle");

    const result = await loadChronicle(root);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unexpected-entry",
        sourcePath: "notes.txt",
      }),
    );
  });
});
