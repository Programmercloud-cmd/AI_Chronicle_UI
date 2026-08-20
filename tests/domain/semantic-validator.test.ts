import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { loadChronicle, readContainedArtifact, type ChronicleSnapshot } from "../../src/data";
import { cloneJson, validateChronicle } from "../../src/domain";

async function load(name: "canonical" | "difficult"): Promise<ChronicleSnapshot> {
  const result = await loadChronicle(path.resolve(`examples/${name}`));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

async function expectCode(snapshot: ChronicleSnapshot, code: string): Promise<void> {
  const result = await validateChronicle(snapshot);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.diagnostics.some((item) => item.code === code)).toBe(true);
}

describe("Chronicle semantic validation", () => {
  it.each(["canonical", "difficult"] as const)("accepts the %s project", async (name) => {
    const result = await validateChronicle(await load(name));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(result.value.warnings.every((item) => item.severity === "warning")).toBe(true);
  });

  it("returns independent projected objects even with no revisions", async () => {
    const snapshot = await load("canonical");
    const result = await validateChronicle(snapshot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.milestones[0]!.value).not.toBe(snapshot.milestones[0]!.value);
    expect(result.value.milestones[0]!.original).not.toBe(result.value.milestones[0]!.value);
  });

  it("rejects missing and non-earlier milestone parents", async () => {
    const missing = cloneJson(await load("canonical"));
    missing.milestones[1]!.value.parents = ["NOPE-999"];
    await expectCode(missing, "parent-missing");
    const later = cloneJson(await load("canonical"));
    later.milestones[1]!.value.parents = [later.milestones.at(-1)!.value.id];
    await expectCode(later, "parent-not-earlier");
  });

  it("rejects empty branches and invalid branch continuation", async () => {
    const empty = cloneJson(await load("canonical"));
    empty.branches.push({ sourcePath: "branches/BR-EMPTY.yaml", value: { schema_version: 1, id: "BR-EMPTY", title: "Empty" } });
    await expectCode(empty, "branch-empty");
    const continuation = cloneJson(await load("canonical"));
    continuation.milestones.find((item) => item.value.id === "TIM-002")!.value.parents = ["CORE-004"];
    await expectCode(continuation, "branch-continuation-missing-parent");
  });

  it("rejects an unaccepted current milestone", async () => {
    const snapshot = cloneJson(await load("canonical"));
    snapshot.current!.value.milestone_id = "CORE-004";
    await expectCode(snapshot, "current-milestone-not-accepted");
  });

  it("rejects a broken projected roadmap chain and roadmap cycles", async () => {
    const broken = cloneJson(await load("canonical"));
    const first = broken.roadmap.value.items.find((item) => item.id === "RM-003")!;
    first.follows = { type: "roadmap", id: "RM-004" };
    await expectCode(broken, "projection-chain-invalid");
    const cycle = cloneJson(await load("canonical"));
    cycle.roadmap.value.items.find((item) => item.id === "RM-001")!.parent_id = "RM-002";
    cycle.roadmap.value.items.find((item) => item.id === "RM-002")!.parent_id = "RM-001";
    await expectCode(cycle, "roadmap-parent-cycle");
  });

  it("rejects artifact digest mismatch using supplied bytes", async () => {
    const snapshot = await load("canonical");
    const result = await validateChronicle(snapshot, {
      artifactReader: async () => ({ ok: true, bytes: Buffer.from("tampered") }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.some((item) => item.code === "artifact-sha256-mismatch")).toBe(true);
  });

  it("rejects code changes whose evidence is not an artifact diff", async () => {
    const snapshot = cloneJson(await load("canonical"));
    snapshot.milestones.find((item) => item.value.id === "TIM-002")!.value.code_changes![0]!.diff_evidence_id = "EVD-0004";
    await expectCode(snapshot, "diff-evidence-invalid");
  });

  it("rejects invalid historical times and relations", async () => {
    const time = cloneJson(await load("canonical"));
    time.milestones[0]!.value.recorded_at = "2026-04-05T09:25:00+02:00";
    await expectCode(time, "recorded-before-occurred");

    const relation = cloneJson(await load("canonical"));
    const record = relation.milestones.find((item) => item.value.id === "TIM-001")!;
    record.value.relations!.push(cloneJson(record.value.relations![0]!));
    await expectCode(relation, "duplicate-relation");
  });

  it("rejects malformed projection dates, status, and branch ownership", async () => {
    const datedAfterUndated = cloneJson(await load("canonical"));
    delete datedAfterUndated.roadmap.value.items.find((item) => item.id === "RM-003")!.planned_for;
    await expectCode(datedAfterUndated, "projection-dated-after-undated");

    const oldDate = cloneJson(await load("canonical"));
    oldDate.roadmap.value.items.find((item) => item.id === "RM-003")!.planned_for = "2026-05-04";
    await expectCode(oldDate, "projection-date-before-current");

    const wrongBranch = cloneJson(await load("canonical"));
    wrongBranch.roadmap.value.items.find((item) => item.id === "RM-003")!.branch_id = "BR-MAIN";
    await expectCode(wrongBranch, "projection-branch-mismatch");

    const completed = cloneJson(await load("canonical"));
    completed.roadmap.value.items.find((item) => item.id === "RM-003")!.status = "completed";
    await expectCode(completed, "projection-status-invalid");
  });

  it("rejects missing roadmap and event references plus blocker cycles", async () => {
    const missingRoadmap = cloneJson(await load("canonical"));
    missingRoadmap.roadmap.value.items[0]!.parent_id = "RM-999";
    await expectCode(missingRoadmap, "roadmap-parent-missing");

    const missingEvent = cloneJson(await load("canonical"));
    missingEvent.engineeringEvents[0]!.value.evidence = ["EVD-9999"];
    await expectCode(missingEvent, "event-evidence-missing");

    const blockers = cloneJson(await load("canonical"));
    const third = blockers.roadmap.value.items.find((item) => item.id === "RM-003")!;
    const fourth = blockers.roadmap.value.items.find((item) => item.id === "RM-004")!;
    const fifth = blockers.roadmap.value.items.find((item) => item.id === "RM-005")!;
    third.blocked_by = [{ type: "roadmap", id: fifth.id }];
    fourth.blocked_by = [{ type: "roadmap", id: third.id }];
    await expectCode(blockers, "roadmap-blocker-cycle");
  });

  it("keeps non-fatal audit conditions as deterministic warnings", async () => {
    const snapshot = cloneJson(await load("canonical"));
    const event = snapshot.engineeringEvents[0]!;
    event.value.occurred_at = "2026-05-03T09:00:00+02:00";
    event.value.recorded_at = "2026-05-03T09:01:00+02:00";
    const result = await validateChronicle(snapshot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.warnings.some((item) => item.code === "event-after-milestone")).toBe(true);
    expect(result.value.warnings.some((item) => item.code === "external-url-unverified")).toBe(true);
  });

  it("keeps correctly hashed media valid when its declared type is not preview-eligible", async () => {
    const snapshot = cloneJson(await load("canonical"));
    const evidence = snapshot.evidence.find((item) => item.value.id === "EVD-0001")!;
    if (evidence.value.source.kind !== "artifact") throw new Error("fixture must be artifact-backed");
    evidence.value.source.media_type = "image/png";
    const bytes = Buffer.from("not a png");
    evidence.value.source.sha256 = createHash("sha256").update(bytes).digest("hex");
    const result = await validateChronicle(snapshot, { artifactReader: async (loaded, record) => {
      if (record.value.id === evidence.value.id) return { ok: true, bytes };
      if (record.value.source.kind !== "artifact") throw new Error("reader called for non-artifact evidence");
      const read = await readContainedArtifact(
        { inputPath: loaded.rootPath, realPath: loaded.rootPath }, record.value.source.path, record.sourcePath,
      );
      return read.ok
        ? { ok: true, bytes: read.value.bytes }
        : { ok: false, diagnostics: read.diagnostics.map((issue) => ({
            severity: "error" as const, phase: "evidence" as const, code: issue.code,
            sourcePath: issue.sourcePath, message: issue.message,
          })) };
    } });
    expect(result.ok).toBe(true);
  });

  it("reports roadmap cycles identically when YAML item order changes", async () => {
    const first = cloneJson(await load("canonical"));
    first.roadmap.value.items.find((item) => item.id === "RM-001")!.parent_id = "RM-002";
    first.roadmap.value.items.find((item) => item.id === "RM-002")!.parent_id = "RM-001";
    const second = cloneJson(first);
    second.roadmap.value.items.reverse();
    const firstResult = await validateChronicle(first);
    const secondResult = await validateChronicle(second);
    expect(firstResult.ok).toBe(false);
    expect(secondResult.ok).toBe(false);
    if (!firstResult.ok && !secondResult.ok) expect(secondResult.diagnostics).toEqual(firstResult.diagnostics);
  });

  it("sorts diagnostics deterministically", async () => {
    const snapshot = cloneJson(await load("canonical"));
    snapshot.milestones[0]!.value.evidence = ["EVD-9999"];
    snapshot.milestones[1]!.value.parents = ["NOPE-999"];
    const first = await validateChronicle(snapshot);
    const second = await validateChronicle(snapshot);
    expect(first).toEqual(second);
  });
});
