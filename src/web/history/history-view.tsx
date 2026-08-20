import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import type {
  TimelineEdgeLayout,
  TimelineLayout,
  TimelineNodeLayout,
} from "../../timeline";
import "./history.css";

export interface HistoryViewProps {
  layout: TimelineLayout;
}

function friendlyTimestamp(timestamp: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/u.exec(timestamp);
  return match === null ? timestamp : `${match[1]} · ${match[2]}`;
}

function nodeHref(node: TimelineNodeLayout): string {
  return node.target.kind === "milestone"
    ? `/milestones/${encodeURIComponent(node.target.id)}`
    : `/roadmap#${encodeURIComponent(node.target.id)}`;
}

function branchClass(ordinal: number): string {
  return `history-branch-${ordinal % 4}`;
}

function edgePath(edge: TimelineEdgeLayout): string {
  const [from, to] = edge.points;
  return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
}

function DetailSurface({ node }: { node?: TimelineNodeLayout }) {
  return (
    <aside className="history-detail-surface" aria-live="polite" aria-atomic="true">
      {node === undefined ? (
        <p>Focus or hover a milestone for its exact record details.</p>
      ) : (
        <>
          <strong>{node.fullTitle}</strong>
          <dl>
            <div><dt>ID</dt><dd>{node.id}</dd></div>
            <div>
              <dt>{node.sourceKind === "milestone" ? "Timestamp" : "Planned"}</dt>
              <dd>{node.exactTimestampIso ?? node.plannedFor ?? "Undated"}</dd>
            </div>
            <div><dt>Status</dt><dd>{node.status}</dd></div>
            <div><dt>Branch</dt><dd>{node.accessibility.branchTitle} · {node.branchId}</dd></div>
            {node.sourceKind === "milestone" ? (
              <div><dt>Evidence</dt><dd>{node.accessibility.evidenceCount ?? 0}</dd></div>
            ) : null}
          </dl>
          <p>{node.accessibility.description}</p>
        </>
      )}
    </aside>
  );
}

function TimelineNode({
  node,
  laneOrdinal,
  onHover,
  onFocus,
}: {
  node: TimelineNodeLayout;
  laneOrdinal: number;
  onHover(node?: TimelineNodeLayout): void;
  onFocus(node?: TimelineNodeLayout): void;
}) {
  const planned = node.sourceKind === "roadmap";
  const labelDistance = 34 + node.label.tier * 28;
  const labelY = node.label.side === "above" ? node.y - labelDistance : node.y + labelDistance;
  const labelAnchor = node.label.side === "above" ? "start" : "end";
  const timestampY = node.treatment === "current"
    ? node.y + 54
    : node.label.side === "above"
      ? node.y + 48
      : node.y - 34;
  const classNames = [
    "history-node",
    branchClass(laneOrdinal),
    `history-node-${node.treatment}`,
    `history-status-${node.status}`,
  ].join(" ");

  return (
    <g className={classNames} data-node-id={node.id}>
      <Link
        to={nodeHref(node)}
        aria-label={`${node.id}. ${node.accessibility.fullLabel}`}
        onMouseEnter={() => onHover(node)}
        onMouseLeave={() => onHover()}
        onFocus={() => onFocus(node)}
        onBlur={() => onFocus()}
      >
        <title>{node.accessibility.fullLabel}</title>
        <circle className="history-node-ring" cx={node.x} cy={node.y} r={node.treatment === "current" ? 17 : 13} />
        <circle className="history-node-core" cx={node.x} cy={node.y} r={node.treatment === "current" ? 10 : 8} />
        <text
          className="history-node-label"
          x={node.x}
          y={labelY}
          textAnchor={labelAnchor}
          transform={`rotate(${node.label.angleDegrees} ${node.x} ${labelY})`}
        >
          {node.visibleTitle}
        </text>
        {node.exactTimestampIso === undefined ? null : (
          <text className="history-node-time" x={node.x} y={timestampY} textAnchor="middle">
            {friendlyTimestamp(node.exactTimestampIso)}
          </text>
        )}
        {planned && node.plannedFor !== undefined ? (
          <text className="history-node-time history-planned-date" x={node.x} y={timestampY} textAnchor="middle">
            PLANNED {node.plannedFor}
          </text>
        ) : null}
        {node.treatment === "current" ? (
          <>
            <text className="history-current-label" x={node.x} y={node.y - 62} textAnchor="middle">
              CURRENT STATE
            </text>
            <text className="history-current-state" x={node.x} y={node.y + 78} textAnchor="middle">
              {node.currentState}
            </text>
          </>
        ) : null}
      </Link>
    </g>
  );
}

export function HistoryView({ layout }: HistoryViewProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string>();
  const [focusedId, setFocusedId] = useState<string>();
  const nodeById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes],
  );
  const laneByBranch = useMemo(
    () => new Map(layout.lanes.map((lane) => [lane.branchId, lane])),
    [layout.lanes],
  );
  const activeId = focusedId ?? hoveredId;
  const activeNode = activeId === undefined ? undefined : nodeById.get(activeId);
  const currentNode = layout.nodes.find((node) => node.treatment === "current");

  function jumpToCurrent() {
    if (layout.navigation.currentX === undefined || viewportRef.current === null) return;
    viewportRef.current.scrollTo({
      left: Math.max(0, layout.navigation.currentX - viewportRef.current.clientWidth / 2),
      behavior: "smooth",
    });
    const currentLink = currentNode === undefined
      ? undefined
      : [...viewportRef.current.querySelectorAll<SVGElement>(".history-node a")]
          .find((element) => element.parentElement?.dataset.nodeId === currentNode.id);
    currentLink?.focus();
  }

  if (layout.nodes.length === 0) {
    return (
      <section className="history-empty" aria-labelledby="history-title">
        <p className="eyebrow">Development graph</p>
        <h1 id="history-title">History</h1>
        <p>No historical milestones have been recorded yet.</p>
      </section>
    );
  }

  return (
    <section className="history-page" aria-labelledby="history-title">
      <header className="history-heading">
        <div>
          <p className="eyebrow">Development graph</p>
          <h1 id="history-title">History</h1>
          <p>Chronology runs left to right. Lines show development ancestry.</p>
        </div>
        {layout.navigation.currentX === undefined ? null : (
          <button type="button" onClick={jumpToCurrent}>Jump to current state</button>
        )}
      </header>
      <DetailSurface node={activeNode} />
      <div
        className="history-scroll"
        ref={viewportRef}
        tabIndex={0}
        aria-label="Scrollable project history timeline"
      >
        <svg
          className="history-canvas"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="group"
          aria-labelledby="history-graph-title history-graph-description"
        >
          <title id="history-graph-title">Branching project history</title>
          <desc id="history-graph-description">
            Milestones ordered chronologically from left to right, with branch ancestry shown by lines and future roadmap items shown as muted outlined nodes.
          </desc>
          <g className="history-edges" aria-hidden="true">
            {layout.edges.map((edge) => {
              const lane = laneByBranch.get(edge.owningBranchId);
              return (
                <path
                  key={edge.id}
                  className={`${branchClass(lane?.styleOrdinal ?? 0)} history-edge-${edge.kind}`}
                  d={edgePath(edge)}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </g>
          <g className="history-lane-labels" aria-hidden="true">
            {layout.lanes.map((lane) => (
              <text key={lane.branchId} x={12} y={lane.y - 18}>
                {lane.branchId} · {lane.branchTitle}
              </text>
            ))}
          </g>
          <g className="history-nodes">
            {layout.nodes.map((node) => (
              <TimelineNode
                key={node.id}
                node={node}
                laneOrdinal={laneByBranch.get(node.branchId)?.styleOrdinal ?? 0}
                onHover={(item) => setHoveredId(item?.id)}
                onFocus={(item) => setFocusedId(item?.id)}
              />
            ))}
          </g>
          <g className="history-zones" aria-hidden="true">
            {layout.zones.map((zone) => (
              <g key={`${zone.kind}:${zone.xStart}`}>
                <line x1={zone.xStart} x2={zone.xStart} y1={zone.y - 28} y2={zone.y + 28} />
                <text x={(zone.xStart + zone.xEnd) / 2} y={zone.y + 50} textAnchor="middle">{zone.label}</text>
              </g>
            ))}
          </g>
          <g className="history-months" aria-hidden="true">
            {layout.monthBands.map((band) => (
              <g key={band.monthKey}>
                <line x1={band.xStart} x2={band.xEnd} y1={band.y} y2={band.y} />
                <rect x={(band.xStart + band.xEnd) / 2 - 62} y={band.y - 14} width={124} height={28} />
                <text x={(band.xStart + band.xEnd) / 2} y={band.y + 5} textAnchor="middle">{band.label}</text>
                <line className="history-month-boundary" x1={band.xEnd} x2={band.xEnd} y1={band.y - 12} y2={band.y + 12} />
              </g>
            ))}
          </g>
        </svg>
      </div>
      <p className="history-scale-note">Calendar months are aligned; dense periods expand for readability.</p>
    </section>
  );
}
