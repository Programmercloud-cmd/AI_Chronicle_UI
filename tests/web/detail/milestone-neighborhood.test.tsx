// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import axe from "axe-core";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";

import type { PublicChronicleSnapshot } from "../../../src/web/app-shell/snapshot";
import {
  buildMilestoneNeighborhood,
  type MilestoneNeighborhoodRecord,
} from "../../../src/web/detail/milestone-neighborhood-model";
import { MilestoneNeighborhood } from "../../../src/web/detail/milestone-neighborhood";

function milestone(
  id: string,
  parents: readonly string[] = [],
  occurredAt = "2025-01-01T00:00:00Z",
  title = `Title ${id}`,
): MilestoneNeighborhoodRecord {
  const value = {
    schema_version: 1 as const,
    id,
    occurred_at: occurredAt,
    recorded_at: occurredAt,
    title,
    summary: `Summary ${id}`,
    branch_id: "BR-MAIN",
    parents: [...parents],
    status: "accepted" as const,
  };
  return {
    sourcePath: `milestones/${id}.yaml`,
    value,
    original: value,
    amendments: [],
  };
}

function renderNeighborhood(...milestones: readonly MilestoneNeighborhoodRecord[]) {
  const center = milestones.find((record) => record.value.id === "CENTER");
  if (center === undefined) throw new Error("CENTER fixture missing");
  const snapshot = { milestones } as unknown as PublicChronicleSnapshot;
  const model = buildMilestoneNeighborhood(snapshot, center.value.id);
  if (model === undefined) throw new Error("neighborhood model missing");
  return render(
    <MemoryRouter>
      <MilestoneNeighborhood model={model} />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("MilestoneNeighborhood", () => {
  it("renders complete ancestry with deterministic top-to-bottom model ordering", () => {
    const view = renderNeighborhood(
      milestone("P-1"),
      milestone("P-2"),
      milestone("P-3"),
      milestone("CENTER", ["P-3", "P-1", "P-2"]),
      milestone("K-Z", ["CENTER"], "2025-03-03T00:00:00Z"),
      milestone("K-A", ["CENTER"], "2025-03-01T00:00:00Z"),
      milestone("K-B", ["CENTER"], "2025-03-02T00:00:00Z"),
    );

    const parents = [...view.container.querySelectorAll('[data-neighborhood-relation="parent"]')];
    const children = [...view.container.querySelectorAll('[data-neighborhood-relation="child"]')];
    expect(parents.map((node) => node.getAttribute("data-neighborhood-id"))).toEqual(["P-3", "P-1", "P-2"]);
    expect(children.map((node) => node.getAttribute("data-neighborhood-id"))).toEqual(["K-A", "K-B", "K-Z"]);
    expect(parents.map((node) => Number(/translate\([^ ]+ ([^)]+)\)/u.exec(node.getAttribute("transform") ?? "")?.[1])))
      .toEqual([...parents].map((_, index) => Number(/translate\([^ ]+ ([^)]+)\)/u.exec(parents[index]?.getAttribute("transform") ?? "")?.[1])).sort((a, b) => a - b));
    expect(children.map((node) => Number(/translate\([^ ]+ ([^)]+)\)/u.exec(node.getAttribute("transform") ?? "")?.[1])))
      .toEqual([...children].map((_, index) => Number(/translate\([^ ]+ ([^)]+)\)/u.exec(children[index]?.getAttribute("transform") ?? "")?.[1])).sort((a, b) => a - b));

    const edges = [...view.container.querySelectorAll("[data-edge-source]")];
    expect(edges).toHaveLength(6);
    expect(edges.map((edge) => [edge.getAttribute("data-edge-source"), edge.getAttribute("data-edge-target")])).toEqual([
      ["P-3", "CENTER"], ["P-1", "CENTER"], ["P-2", "CENTER"],
      ["CENTER", "K-A"], ["CENTER", "K-B"], ["CENTER", "K-Z"],
    ]);
  });

  it("makes every neighbor a descriptive routed link in keyboard order", async () => {
    const user = userEvent.setup();
    renderNeighborhood(
      milestone("PARENT"),
      milestone("CENTER", ["PARENT"]),
      milestone("CHILD", ["CENTER"]),
    );

    const parent = screen.getByRole("link", { name: "Open parent milestone: Title PARENT (PARENT)" });
    const child = screen.getByRole("link", { name: "Open child milestone: Title CHILD (CHILD)" });
    expect(parent).toHaveAttribute("href", "/milestones/PARENT");
    expect(child).toHaveAttribute("href", "/milestones/CHILD");

    await user.tab();
    expect(screen.getByRole("region", { name: "Direct parent and child milestone topology" })).toHaveFocus();
    await user.tab();
    expect(parent).toHaveFocus();
    await user.tab();
    expect(child).toHaveFocus();
  });

  it("marks the noninteractive center with text, shape, and current semantics", () => {
    const view = renderNeighborhood(milestone("CENTER"));

    const center = screen.getByRole("img", { name: "Current milestone: Title CENTER (CENTER)" });
    expect(center).toHaveAttribute("aria-current", "true");
    expect(within(center).getByText("CURRENT")).toBeVisible();
    expect(center.querySelector("rect")).not.toBeNull();
    expect(view.container.querySelectorAll('[data-neighborhood-relation]')).toHaveLength(0);
    expect(view.container.querySelectorAll("[data-edge-source]")).toHaveLength(0);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("truncates visible labels while retaining full tooltip and accessible text", () => {
    const longTitle = "A deliberately long neighboring milestone title for truncation";
    renderNeighborhood(
      milestone("PARENT-WITH-A-DELIBERATELY-LONG-STABLE-ID", [], undefined, longTitle),
      milestone("CENTER", ["PARENT-WITH-A-DELIBERATELY-LONG-STABLE-ID"]),
    );

    const link = screen.getByRole("link", {
      name: `Open parent milestone: ${longTitle} (PARENT-WITH-A-DELIBERATELY-LONG-STABLE-ID)`,
    });
    expect(link).toHaveAttribute("href", "/milestones/PARENT-WITH-A-DELIBERATELY-LONG-STABLE-ID");
    expect(link.querySelector("title")).toHaveTextContent(`${longTitle} (PARENT-WITH-A-DELIBERATELY-LONG-STABLE-ID)`);
    expect(link.querySelector(".milestone-neighborhood-node-title")).toHaveTextContent("\u2026");
    expect(link.querySelector(".milestone-neighborhood-node-id")).toHaveTextContent("\u2026");
  });

  it("keeps high-degree nodes at fixed size in a bounded scroll region", () => {
    const children = Array.from({ length: 12 }, (_, index) => (
      milestone(`CHILD-${String(index).padStart(2, "0")}`, ["CENTER"], `2025-02-${String(index + 1).padStart(2, "0")}T00:00:00Z`)
    ));
    const view = renderNeighborhood(milestone("CENTER"), ...children);
    const region = screen.getByRole("region", { name: "Direct parent and child milestone topology" });
    const svg = region.querySelector("svg");

    expect(region).toHaveClass("milestone-neighborhood-scroll");
    expect(Number(region.getAttribute("data-logical-height"))).toBeGreaterThan(384);
    expect(svg).toHaveAttribute("height", region.getAttribute("data-logical-height"));
    expect(svg).toHaveAttribute("viewBox", `0 0 360 ${region.getAttribute("data-logical-height")}`);
    expect(view.container.querySelectorAll('[data-neighborhood-relation="child"]')).toHaveLength(12);
    expect(view.container.querySelectorAll('[data-edge-source="CENTER"]')).toHaveLength(12);
    for (const shape of view.container.querySelectorAll(".milestone-neighborhood-node-shape")) {
      expect(shape).toHaveAttribute("width", "100");
      expect(shape).toHaveAttribute("height", "60");
    }
  });

  it("has no automated accessibility violations", async () => {
    const view = renderNeighborhood(
      milestone("PARENT"),
      milestone("CENTER", ["PARENT"]),
      milestone("CHILD", ["CENTER"]),
    );
    expect((await axe.run(view.container)).violations).toEqual([]);
  });
});
