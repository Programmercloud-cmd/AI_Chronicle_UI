// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import axe from "axe-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { layoutTimeline } from "../../../src/timeline";
import { HistoryView } from "../../../src/web/history/history-view";
import { canonicalHistoryInput, canonicalHistoryLayout } from "./fixtures";

function renderHistory(layout = canonicalHistoryLayout()) {
  return render(
    <MemoryRouter>
      <HistoryView layout={layout} />
    </MemoryRouter>,
  );
}

describe("History view", () => {
  afterEach(() => cleanup());

  it("renders the canonical topology from layout output without fixed node coordinates", () => {
    const layout = canonicalHistoryLayout();
    const { container } = renderHistory(layout);

    expect(screen.getByRole("heading", { name: "History" })).toBeVisible();
    expect(container.querySelectorAll(".history-node")).toHaveLength(11);
    expect(container.querySelectorAll(".history-edge-branch-origin")).toHaveLength(1);
    expect(container.querySelector("[data-node-id='TIM-004']")).toHaveClass("history-node-current");
    expect(container.querySelectorAll(".history-node-planned-dated")).toHaveLength(3);
    expect(container.querySelector(".history-edge-projection")).toBeInTheDocument();
    expect(container.querySelectorAll(".history-months > g")).toHaveLength(3);
    expect(container.querySelector("svg")).toHaveAttribute("width", String(layout.width));
    expect(screen.getByText("2026-05-05 · 14:30:52")).toBeInTheDocument();
    expect(screen.getByText("CURRENT STATE")).toBeInTheDocument();
    expect(screen.getByText("Stable implementation accepted")).toBeInTheDocument();
  });

  it("reveals the same compact details through hover and keyboard focus", async () => {
    const user = userEvent.setup();
    renderHistory();
    const milestone = screen.getByRole("link", { name: /CORE-003/u });

    await user.hover(milestone);
    expect(screen.getByText("Regression Introduced", { selector: "strong" })).toBeVisible();
    expect(screen.getByText("2026-04-20T16:47:21+02:00")).toBeVisible();
    expect(screen.getByText("Original path · BR-MAIN")).toBeVisible();

    await user.unhover(milestone);
    fireEvent.focus(milestone);
    expect(screen.getByText("Regression Introduced", { selector: "strong" })).toBeVisible();
  });

  it("centers and focuses the explicit current milestone on request", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.fn();
    renderHistory();
    const viewport = screen.getByLabelText("Scrollable project history timeline");
    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(viewport, "scrollTo", { configurable: true, value: scrollTo });

    await user.click(screen.getByRole("button", { name: "Jump to current state" }));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
    expect(screen.getByRole("link", { name: /TIM-004/u })).toHaveFocus();
  });

  it("retains full long titles in the accessible link when the graph label is shortened", () => {
    const input = canonicalHistoryInput();
    const fullTitle = "A deliberately long milestone title with timing, replay, validation, and acceptance context";
    const result = layoutTimeline({
      ...input,
      milestones: input.milestones.map((item) => item.id === "CORE-001" ? { ...item, title: fullTitle } : item),
    });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    renderHistory(result.value);

    const link = screen.getByRole("link", { name: new RegExp(fullTitle, "u") });
    expect(link).toBeVisible();
    expect(screen.queryByText(fullTitle, { selector: ".history-node-label" })).not.toBeInTheDocument();
    fireEvent.focus(link);
    expect(screen.getByText(fullTitle, { selector: "strong" })).toBeVisible();
  });

  it("has no automatically detectable accessibility violations", async () => {
    const { container } = renderHistory();
    const results = await axe.run(container, {
      rules: {
        // jsdom has no canvas-backed computed color model; browser visual checks cover contrast.
        "color-contrast": { enabled: false },
      },
    });
    expect(results.violations).toEqual([]);
  });
});
