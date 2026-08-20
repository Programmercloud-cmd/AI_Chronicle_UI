// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { readFile } from "node:fs/promises";
import path from "node:path";

import axe from "axe-core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { loadChronicle } from "../../../src/data";
import { validateChronicle } from "../../../src/domain";
import { SnapshotProvider, type PublicChronicleSnapshot } from "../../../src/web/app-shell/snapshot";
import { MilestoneDetailPage } from "../../../src/web/detail";

let canonical: PublicChronicleSnapshot;
let difficult: PublicChronicleSnapshot;
let canonicalDiff: string;

async function publicSnapshot(name: "canonical" | "difficult"): Promise<PublicChronicleSnapshot> {
  const loaded = await loadChronicle(path.resolve(`examples/${name}`));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
  const validated = await validateChronicle(loaded.value);
  if (!validated.ok) throw new Error(JSON.stringify(validated.diagnostics));
  const { rootPath: _rootPath, ...snapshot } = validated.value;
  return JSON.parse(JSON.stringify(snapshot)) as PublicChronicleSnapshot;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockApi(snapshot: PublicChronicleSnapshot, diff = canonicalDiff): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "/api/snapshot") return jsonResponse(snapshot);
    if (/\/api\/evidence\/EVD-[0-9]+\/raw$/u.test(url)) {
      return new Response(diff, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
    }
    return jsonResponse({ error: "not-found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderDetail(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/milestones/${id}`]}>
      <SnapshotProvider>
        <Routes><Route path="/milestones/:milestoneId" element={<MilestoneDetailPage />} /></Routes>
      </SnapshotProvider>
    </MemoryRouter>,
  );
}

beforeAll(async () => {
  [canonical, difficult, canonicalDiff] = await Promise.all([
    publicSnapshot("canonical"),
    publicSnapshot("difficult"),
    readFile(path.resolve("examples/canonical/evidence/artifacts/diffs/TIM-002.patch"), "utf8"),
  ]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

afterAll(() => vi.restoreAllMocks());

describe("milestone detail", () => {
  it("explains a revised milestone with ancestry, children, roadmap, and visible amendment", async () => {
    mockApi(difficult);
    renderDetail("CORE-002");

    expect(await screen.findByRole("heading", { name: "Deterministic Baseline Accepted" })).toBeVisible();
    expect(screen.getAllByText("2025-02-01T11:15:00+01:00").length).toBeGreaterThan(0);
    expect(screen.getByText("The baseline did not contain mixed-clock or delayed-input samples.")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Parent milestones" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Initial Replay Architecture" })).toHaveAttribute("href", "/milestones/CORE-001");
    expect(screen.getByRole("link", { name: "Executor Hypothesis Accepted" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Registration Degeneracy Suspected" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Capture deterministic baseline" })).toHaveAttribute("href", "/roadmap#RM-001");
    expect(screen.getByRole("heading", { name: "Visible amendments" })).toBeVisible();
    expect(screen.getByText("REV-000001")).toBeVisible();
    expect(screen.getByText(/Clarify the known scope/u)).toBeVisible();
  });

  it("keeps developer and critic iterations subordinate to their human milestone", async () => {
    mockApi(canonical);
    renderDetail("TIM-003");

    expect(await screen.findByRole("heading", { name: "Validation Passed" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Engineering and review events" })).toBeVisible();
    expect(screen.getByText("Added the first mixed-clock replay fixture.")).toBeVisible();
    expect(screen.getByText("Accepted the repair with full replay evidence.")).toBeVisible();
    expect(screen.getByRole("link", { name: "EVD-0010" })).toHaveAttribute("href", "#evidence-EVD-0010");
  });

  it("renders the actual fetched unified patch as React diff elements", async () => {
    const fetchMock = mockApi(canonical);
    renderDetail("TIM-002");

    expect(await screen.findByRole("heading", { name: "Alternative Fix" })).toBeVisible();
    expect(screen.getByText("Raw source timestamps came from different clock domains.")).toBeVisible();
    expect(await screen.findByLabelText("Actual diff EVD-0008")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Code changes", level: 2 })).toBeVisible();
    expect(screen.getByRole("heading", { name: /Actual patch EVD-0008/u, level: 3 })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Risks", level: 4 })).toBeVisible();
    expect(screen.getAllByText(/normalized_timestamp/u).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Download original EVD-0008" })).toHaveAttribute("href", "/api/evidence/EVD-0008/raw");
    expect(fetchMock).toHaveBeenCalledWith("/api/evidence/EVD-0008/raw", expect.objectContaining({ cache: "no-store" }));
  });

  it("renders malicious diff lines as text and never creates artifact elements", async () => {
    const maliciousDiff = [
      "diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -0,0 +1,2 @@",
      "+<script>alert('diff')</script>", "+<img src=x onerror=alert(1)>", "",
    ].join("\n");
    mockApi(canonical, maliciousDiff);
    const view = renderDetail("TIM-002");

    expect(await screen.findByLabelText("Actual diff EVD-0008")).toBeVisible();
    expect(view.container.querySelector("script")).toBeNull();
    expect(view.container.querySelector("img")).toBeNull();
    expect(screen.getByText(/<script>alert/u)).toBeVisible();
  });

  it("refuses unsafe external URLs even if a compromised snapshot supplies one", async () => {
    const compromised = JSON.parse(JSON.stringify(canonical)) as PublicChronicleSnapshot;
    const evidence = compromised.evidence.find((record) => record.value.id === "EVD-0004");
    if (evidence === undefined || evidence.value.source.kind !== "url") throw new Error("fixture URL evidence missing");
    (evidence.value.source as { url: string }).url = "javascript:alert(1)";
    mockApi(compromised);
    const view = renderDetail("CORE-003");

    expect(await screen.findByText("External URL is not safe to open.")).toBeVisible();
    expect(view.container.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it("provides keyboard-reachable relationship and evidence actions", async () => {
    mockApi(difficult);
    const user = userEvent.setup();
    renderDetail("CORE-002");
    await screen.findByRole("heading", { name: "Deterministic Baseline Accepted" });

    await user.tab();
    expect(document.activeElement).toHaveAttribute("href", "/milestones/CORE-001");
    for (let attempts = 0; attempts < 10 && document.activeElement?.textContent !== "Open safe preview"; attempts += 1) await user.tab();
    expect(document.activeElement).toHaveTextContent("Open safe preview");
  });

  it("has no automated accessibility violations in the representative detail", async () => {
    mockApi(difficult);
    const view = renderDetail("CORE-002");
    await screen.findByRole("heading", { name: "Deterministic Baseline Accepted" });
    const results = await axe.run(view.container);
    expect(results.violations).toEqual([]);
  });

  it("has no automated heading-order violation when an actual diff is expanded", async () => {
    mockApi(canonical);
    const view = renderDetail("TIM-002");
    await screen.findByLabelText("Actual diff EVD-0008");
    const results = await axe.run(view.container);
    expect(results.violations).toEqual([]);
  });

  it("shows an explicit not-found state without guessing a milestone", async () => {
    mockApi(canonical);
    renderDetail("CORE-999");
    expect(await screen.findByRole("heading", { name: "Milestone not found" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Return to History" })).toHaveAttribute("href", "/history");
  });

  it("never interprets milestone metadata as HTML", async () => {
    const compromised = JSON.parse(JSON.stringify(canonical)) as PublicChronicleSnapshot;
    const milestone = compromised.milestones.find((record) => record.value.id === "CORE-001");
    if (milestone === undefined) throw new Error("fixture milestone missing");
    (milestone.value as { title: string }).title = "<img src=x onerror=alert(1)>";
    mockApi(compromised);
    const view = renderDetail("CORE-001");
    expect(await screen.findByRole("heading", { name: "<img src=x onerror=alert(1)>" })).toBeVisible();
    expect(view.container.querySelector("img")).toBeNull();
  });
});
