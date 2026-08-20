import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadChronicle, type ChronicleSnapshot } from "../../src/data";
import { cloneJson, projectRevisions } from "../../src/domain";

const difficultRoot = path.resolve("examples/difficult");

async function difficult(): Promise<ChronicleSnapshot> {
  const result = await loadChronicle(difficultRoot);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

describe("revision projection", () => {
  it("applies the difficult fixture amendment and retains immutable original and metadata", async () => {
    const snapshot = await difficult();
    const result = projectRevisions(snapshot);
    expect(result.diagnostics).toEqual([]);
    const record = result.projection?.milestones.find((item) => item.value.id === "CORE-002");
    expect(record?.value.details?.known_limitations).toEqual([
      "The baseline did not contain mixed-clock or delayed-input samples.",
    ]);
    expect(record?.original.details?.known_limitations).toBeUndefined();
    expect(record?.amendments.map((item) => item.revisionId)).toEqual(["REV-000001"]);
  });

  it("rejects a forked revision chain", async () => {
    const snapshot = cloneJson(await difficult());
    const base = snapshot.revisions[0]!;
    snapshot.revisions.push({
      sourcePath: "revisions/REV-000002.yaml",
      value: { ...cloneJson(base.value), id: "REV-000002", previous_revision: "REV-000001", recorded_at: "2026-06-12T09:00:00+02:00" },
    }, {
      sourcePath: "revisions/REV-000003.yaml",
      value: { ...cloneJson(base.value), id: "REV-000003", previous_revision: "REV-000001", recorded_at: "2026-06-13T09:00:00+02:00" },
    });
    const result = projectRevisions(snapshot);
    expect(result.projection).toBeUndefined();
    expect(result.diagnostics.some((item) => item.code === "revision-chain-fork")).toBe(true);
  });

  it("discards an entire revision when a later operation fails", async () => {
    const snapshot = cloneJson(await difficult());
    snapshot.revisions[0]!.value.changes.push({ operation: "remove", path: "/summary", from: "wrong" });
    const result = projectRevisions(snapshot);
    expect(result.projection).toBeUndefined();
    expect(result.diagnostics.some((item) => item.code === "guard-mismatch" && item.changeIndex === 1)).toBe(true);
  });

  it("rejects wrong-target predecessors and revisions before timestamped targets", async () => {
    const wrongTarget = cloneJson(await difficult());
    const original = wrongTarget.revisions[0]!;
    wrongTarget.revisions.push({
      sourcePath: "revisions/REV-000002.yaml",
      value: {
        ...cloneJson(original.value), id: "REV-000002", target: { type: "milestone", id: "CORE-003" },
        previous_revision: "REV-000001", recorded_at: "2026-06-12T09:00:00+02:00",
      },
    });
    expect(projectRevisions(wrongTarget).diagnostics.some((item) => item.code === "revision-predecessor-wrong-target")).toBe(true);

    const early = cloneJson(await difficult());
    early.revisions[0]!.value.recorded_at = "2025-01-01T09:00:00+01:00";
    expect(projectRevisions(early).diagnostics.some((item) => item.code === "revision-before-target")).toBe(true);
  });

  it("rejects a revision whose atomic result violates the target schema", async () => {
    const snapshot = cloneJson(await difficult());
    snapshot.revisions[0]!.value.changes = [{ operation: "remove", path: "/title", from: "Deterministic Baseline Accepted" }];
    const result = projectRevisions(snapshot);
    expect(result.projection).toBeUndefined();
    expect(result.diagnostics.some((item) => item.code === "projected-shape-invalid")).toBe(true);
  });

  it("produces stable ID order when loader arrays are shuffled", async () => {
    const snapshot = cloneJson(await difficult());
    snapshot.milestones.reverse();
    snapshot.branches.reverse();
    snapshot.engineeringEvents.reverse();
    const result = projectRevisions(snapshot);
    expect(result.projection?.milestones.map((item) => item.value.id)).toEqual(
      [...snapshot.milestones.map((item) => item.value.id)].sort(),
    );
  });
});
