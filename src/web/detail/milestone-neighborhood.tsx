import { Link } from "react-router-dom";

import type {
  MilestoneNeighborhoodModel,
  MilestoneNeighborhoodRecord,
} from "./milestone-neighborhood-model";
import "./detail.css";

const SVG_WIDTH = 360;
const NODE_WIDTH = 100;
const NODE_HEIGHT = 60;
const NODE_PITCH = 78;
const VERTICAL_PADDING = 42;
const MIN_LOGICAL_HEIGHT = 194;
const PARENT_X = 4;
const CENTER_X = 130;
const CHILD_X = 256;
const TITLE_LIMIT = 14;
const ID_LIMIT = 13;

interface NodePosition {
  readonly x: number;
  readonly y: number;
}

export interface MilestoneNeighborhoodProps {
  readonly model: MilestoneNeighborhoodModel;
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}\u2026`;
}

function logicalHeight(model: MilestoneNeighborhoodModel): number {
  const maximumColumnSize = Math.max(model.parents.length, model.children.length, 1);
  return Math.max(
    MIN_LOGICAL_HEIGHT,
    VERTICAL_PADDING * 2 + NODE_HEIGHT + (maximumColumnSize - 1) * NODE_PITCH,
  );
}

function columnPositions(count: number, x: number, height: number): readonly NodePosition[] {
  const columnHeight = count === 0 ? 0 : NODE_HEIGHT + (count - 1) * NODE_PITCH;
  const startY = (height - columnHeight) / 2;
  return Array.from({ length: count }, (_, index) => ({ x, y: startY + index * NODE_PITCH }));
}

function nodeLabel(record: MilestoneNeighborhoodRecord): string {
  return `${record.value.title} (${record.value.id})`;
}

function NeighborNode({
  record,
  relation,
  position,
}: {
  readonly record: MilestoneNeighborhoodRecord;
  readonly relation: "parent" | "child";
  readonly position: NodePosition;
}) {
  const fullLabel = nodeLabel(record);
  return (
    <g
      data-neighborhood-id={record.value.id}
      data-neighborhood-relation={relation}
      transform={`translate(${position.x} ${position.y})`}
    >
      <Link
        to={`/milestones/${encodeURIComponent(record.value.id)}`}
        className="milestone-neighborhood-link"
        aria-label={`Open ${relation} milestone: ${fullLabel}`}
      >
        <title>{fullLabel}</title>
        <rect className="milestone-neighborhood-node-shape" width={NODE_WIDTH} height={NODE_HEIGHT} rx="7" />
        <text className="milestone-neighborhood-node-title" x="8" y="25">
          {truncate(record.value.title, TITLE_LIMIT)}
        </text>
        <text className="milestone-neighborhood-node-id" x="8" y="46">
          {truncate(record.value.id, ID_LIMIT)}
        </text>
      </Link>
    </g>
  );
}

function edgePath(source: NodePosition, target: NodePosition): string {
  const sourceX = source.x + NODE_WIDTH;
  const sourceY = source.y + NODE_HEIGHT / 2;
  const targetX = target.x;
  const targetY = target.y + NODE_HEIGHT / 2;
  const midpointX = (sourceX + targetX) / 2;
  return `M ${sourceX} ${sourceY} C ${midpointX} ${sourceY}, ${midpointX} ${targetY}, ${targetX} ${targetY}`;
}

export function MilestoneNeighborhood({ model }: MilestoneNeighborhoodProps) {
  const height = logicalHeight(model);
  const parentPositions = columnPositions(model.parents.length, PARENT_X, height);
  const childPositions = columnPositions(model.children.length, CHILD_X, height);
  const centerPosition = { x: CENTER_X, y: (height - NODE_HEIGHT) / 2 };
  const centerLabel = nodeLabel(model.center);

  return (
    <section className="milestone-neighborhood" aria-labelledby="milestone-neighborhood-title">
      <h2 id="milestone-neighborhood-title">Milestone neighborhood</h2>
      <div
        className="milestone-neighborhood-scroll"
        role="region"
        aria-label="Direct parent and child milestone topology"
        tabIndex={0}
        data-logical-height={height}
      >
        <svg
          className="milestone-neighborhood-diagram"
          viewBox={`0 0 ${SVG_WIDTH} ${height}`}
          width="100%"
          height={height}
          role="group"
          aria-label={`Direct ancestry neighborhood for ${centerLabel}`}
        >
          <g className="milestone-neighborhood-column-labels" aria-hidden="true">
            <text x={PARENT_X + NODE_WIDTH / 2} y="22">Parents</text>
            <text x={CENTER_X + NODE_WIDTH / 2} y="22">Current</text>
            <text x={CHILD_X + NODE_WIDTH / 2} y="22">Children</text>
          </g>

          <g className="milestone-neighborhood-edges" aria-hidden="true">
            {model.parents.map((parent, index) => (
              <path
                key={`${parent.value.id}->${model.center.value.id}`}
                d={edgePath(parentPositions[index]!, centerPosition)}
                data-edge-source={parent.value.id}
                data-edge-target={model.center.value.id}
              />
            ))}
            {model.children.map((child, index) => (
              <path
                key={`${model.center.value.id}->${child.value.id}`}
                d={edgePath(centerPosition, childPositions[index]!)}
                data-edge-source={model.center.value.id}
                data-edge-target={child.value.id}
              />
            ))}
          </g>

          <g className="milestone-neighborhood-nodes">
            {model.parents.map((parent, index) => (
              <NeighborNode
                key={parent.value.id}
                record={parent}
                relation="parent"
                position={parentPositions[index]!}
              />
            ))}

            <g
              className="milestone-neighborhood-center"
              role="img"
              aria-label={`Current milestone: ${centerLabel}`}
              aria-current="true"
              data-neighborhood-id={model.center.value.id}
              transform={`translate(${centerPosition.x} ${centerPosition.y})`}
            >
              <title>{centerLabel}</title>
              <rect className="milestone-neighborhood-center-shape" width={NODE_WIDTH} height={NODE_HEIGHT} rx="7" />
              <text className="milestone-neighborhood-current-label" x="8" y="16">CURRENT</text>
              <text className="milestone-neighborhood-node-title" x="8" y="36">
                {truncate(model.center.value.title, TITLE_LIMIT)}
              </text>
              <text className="milestone-neighborhood-node-id" x="8" y="53">
                {truncate(model.center.value.id, ID_LIMIT)}
              </text>
            </g>

            {model.children.map((child, index) => (
              <NeighborNode
                key={child.value.id}
                record={child}
                relation="child"
                position={childPositions[index]!}
              />
            ))}
          </g>
        </svg>
      </div>
    </section>
  );
}
