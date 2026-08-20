// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

import type { CurrentRoadmapPresentation } from "../../../src/presentation";
import {
  CurrentView,
  RoadmapView,
} from "../../../src/web/current-roadmap/current-roadmap";

const presentation: CurrentRoadmapPresentation = {
  current: {
    updatedAt: "2026-05-09T10:17:00+02:00",
    milestone: {
      id: "CORE-008",
      title: "Stable implementation accepted",
      summary: "Replay continuity passed.",
      status: "accepted",
      branchId: "BR-TIMING",
      occurredAt: "2026-05-05T14:30:52+02:00",
      recordedAt: "2026-05-05T14:42:10+02:00",
      annotations: [],
    },
    state: "Stable timestamp handling remains the accepted project state.",
    currentHypothesis: "Remaining drift is unrelated to queue ordering.",
    activeWork: ["Run the long-duration benchmark."],
    nextStep: "Compare drift against the captured baseline.",
    blocked: [
      { summary: "External certification is pending.", blockedBy: [] },
      {
        summary: "Release waits for integration validation.",
        blockedBy: [{ type: "roadmap", id: "RM-004", title: "Integration validation", status: "blocked" }],
      },
    ],
    relatedRoadmapItems: [
      { type: "roadmap", id: "RM-003", title: "Performance benchmark", status: "active" },
    ],
  },
  roadmap: {
    updatedAt: "2026-05-09T10:17:00+02:00",
    outline: [
      {
        depth: 0,
        item: {
          id: "RM-001",
          title: "Validate the fix",
          status: "active",
          order: 10,
          acceptanceCriteria: ["Three two-hour runs stay within the drift budget."],
          relatedMilestones: [{
            type: "milestone",
            id: "CORE-008",
            title: "Stable implementation accepted",
            status: "accepted",
            annotations: [],
          }],
          blockedBy: [],
          plannedFor: "2026-05-19",
        },
      },
      {
        depth: 1,
        item: {
          id: "RM-004",
          title: "Integration validation",
          status: "blocked",
          order: 20,
          parentId: "RM-001",
          acceptanceCriteria: ["Replay and live-input suites pass together."],
          relatedMilestones: [],
          blockerSummary: "The benchmark is not accepted.",
          blockedBy: [{ type: "roadmap", id: "RM-001", title: "Validate the fix", status: "active" }],
        },
      },
      {
        depth: 0,
        item: {
          id: "RM-006",
          title: "Old executor path",
          status: "superseded",
          order: 30,
          acceptanceCriteria: [],
          relatedMilestones: [],
          blockedBy: [],
          supersededBy: { type: "roadmap", id: "RM-001", title: "Validate the fix", status: "active" },
        },
      },
    ],
  },
  historyProjection: [],
};

const context = {
  projectTitle: "Canonical Chronicle Mock",
  timeZone: "Europe/Paris",
  presentation,
};

function LocationProbe() {
  return <output aria-label="Current route">{useLocation().pathname}</output>;
}

afterEach(cleanup);

describe("Current view", () => {
  it("separates current milestone chronology from project-status freshness", () => {
    render(<MemoryRouter><CurrentView {...context} /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "Current" })).toBeVisible();
    expect(screen.getByText(presentation.current!.state)).toBeVisible();
    const timestampGroup = screen.getByRole("group", { name: "Current state timestamps" });
    const times = within(timestampGroup).getAllByRole("time");
    expect(times[0]).toHaveAttribute("datetime", "2026-05-05T14:30:52+02:00");
    expect(times[0]).toHaveAttribute("title", "2026-05-05T14:30:52+02:00");
    expect(times[1]).toHaveAttribute("datetime", "2026-05-09T10:17:00+02:00");
    expect(times[1]).toHaveAttribute("title", "2026-05-09T10:17:00+02:00");
    expect(screen.getByRole("link", { name: "CORE-008" })).toHaveAttribute("href", "/milestones/CORE-008");
    expect(screen.getByText("External certification is pending.")).toBeVisible();
    expect(screen.getByText("Release waits for integration validation.")).toBeVisible();
  });

  it("supports keyboard navigation to linked History detail", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CurrentView {...context} />
        <LocationProbe />
      </MemoryRouter>,
    );
    const milestoneLink = screen.getByRole("link", { name: "CORE-008" });
    milestoneLink.focus();
    expect(milestoneLink).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("status", { name: "Current route" })).toHaveTextContent("/milestones/CORE-008");
  });

  it("has no automated axe violations", async () => {
    const { container } = render(<MemoryRouter><CurrentView {...context} /></MemoryRouter>);
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });

  it("shows an explicit empty current state without inventing content", () => {
    render(
      <MemoryRouter>
        <CurrentView {...context} presentation={{ ...presentation, current: undefined }} />
      </MemoryRouter>,
    );
    expect(screen.getByText("No operational current state has been recorded.")).toBeVisible();
    expect(screen.queryByText("Current milestone")).not.toBeInTheDocument();
  });
});

describe("Roadmap view", () => {
  it("renders status, parent-first hierarchy, criteria, blockers, and typed links", () => {
    const { container } = render(<MemoryRouter><RoadmapView {...context} /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "Roadmap" })).toBeVisible();
    expect(screen.getByRole("time", { name: "2026-05-09T10:17:00+02:00" })).toHaveAttribute(
      "datetime",
      "2026-05-09T10:17:00+02:00",
    );
    const items = container.querySelectorAll(".roadmap-item");
    expect([...items].map((item) => item.id)).toEqual(["RM-001", "RM-004", "RM-006"]);
    expect(items[0]).toHaveAttribute("data-depth", "0");
    expect(items[1]).toHaveAttribute("data-depth", "1");
    expect(items[1]?.parentElement).toHaveClass("roadmap-children");
    expect(within(items[1] as HTMLElement).getByText("Level 2.")).toBeInTheDocument();
    expect(screen.getByText("Three two-hour runs stay within the drift budget.")).toBeVisible();
    expect(screen.getByText("The benchmark is not accepted.")).toBeVisible();
    expect(screen.getByText("superseded")).toBeVisible();
    expect(screen.getByRole("link", { name: /CORE-008 Stable implementation accepted/u })).toHaveAttribute(
      "href",
      "/milestones/CORE-008",
    );
    expect(screen.getAllByRole("link", { name: /RM-001 Validate the fix/u })[0]).toHaveAttribute(
      "href",
      "/roadmap#RM-001",
    );
  });

  it("has no automated axe violations", async () => {
    const { container } = render(<MemoryRouter><RoadmapView {...context} /></MemoryRouter>);
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
