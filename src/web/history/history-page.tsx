import { useMemo } from "react";

import { useSnapshot } from "../app-shell/snapshot";
import { historyLayoutFromSnapshot } from "./history-data";
import { HistoryView } from "./history-view";

export function HistoryPage() {
  const { state } = useSnapshot();
  const result = useMemo(
    () => state.status === "ready" ? historyLayoutFromSnapshot(state.snapshot) : undefined,
    [state],
  );

  if (state.status !== "ready" || result === undefined) return null;
  if (!result.ok) {
    return (
      <section className="history-error" role="alert">
        <p className="eyebrow">History unavailable</p>
        <h1>Timeline could not be laid out</h1>
        <ul>
          {result.diagnostics.map((diagnostic) => (
            <li key={`${diagnostic.code}:${diagnostic.recordId ?? "project"}`}>
              <code>{diagnostic.code}</code>
              {diagnostic.recordId === undefined ? "" : ` · ${diagnostic.recordId}`}
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return <HistoryView layout={result.value} />;
}
