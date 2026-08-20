import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import type { CurrentRoadmapPresentation } from "../../../src/presentation";
import { CurrentView, RoadmapView } from "../../../src/web/current-roadmap/current-roadmap";
import "../../../src/web/styles/global.css";

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
    blocked: [{ summary: "Release waits for integration validation.", blockedBy: [] }],
    relatedRoadmapItems: [],
  },
  roadmap: {
    updatedAt: "2026-05-09T10:17:00+02:00",
    outline: [
      {
        depth: 0,
        item: {
          id: "RM-003",
          title: "Performance benchmark",
          status: "active",
          order: 30,
          acceptanceCriteria: ["Three two-hour runs remain within the drift budget."],
          relatedMilestones: [],
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
          order: 40,
          acceptanceCriteria: ["Replay and live-input suites pass together."],
          relatedMilestones: [],
          blockerSummary: "Performance benchmark acceptance is pending.",
          blockedBy: [{ type: "roadmap", id: "RM-003", title: "Performance benchmark", status: "active" }],
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

function Harness() {
  const [view, setView] = useState<"current" | "roadmap">("current");
  return (
    <>
      <header className="site-header">
        <strong>Project Chronicle</strong>
        <nav aria-label="Harness views">
          <button type="button" onClick={() => setView("current")}>Current</button>
          <button type="button" onClick={() => setView("roadmap")}>Roadmap</button>
        </nav>
      </header>
      <main className="site-main">
        {view === "current" ? <CurrentView {...context} /> : <RoadmapView {...context} />}
      </main>
    </>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("browser harness root missing");
createRoot(root).render(<BrowserRouter><Harness /></BrowserRouter>);

