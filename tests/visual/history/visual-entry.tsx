import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import { layoutTimeline } from "../../../src/timeline";
import { HistoryView } from "../../../src/web/history/history-view";
import "../../../src/web/styles/global.css";
import { visualFixture } from "./fixture-inputs";

const parameters = new URLSearchParams(window.location.search);
const fixture = parameters.get("fixture") ?? "canonical";
const theme = parameters.get("theme") === "dark" ? "dark" : "light";
document.documentElement.dataset.theme = theme;
document.documentElement.style.colorScheme = theme;

const result = layoutTimeline(visualFixture(fixture));
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
const root = document.getElementById("root");
if (root === null) throw new Error("visual fixture root is missing");

createRoot(root).render(
  <MemoryRouter>
    <HistoryView layout={result.value} />
  </MemoryRouter>,
);
