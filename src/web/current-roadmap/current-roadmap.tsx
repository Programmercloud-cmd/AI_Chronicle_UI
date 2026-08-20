import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import {
  createCurrentRoadmapPresentation,
  type CurrentRoadmapPresentation,
  type EntityLink,
  type HistoricalAnnotation,
  type RoadmapItemPresentation,
  type RoadmapOutlineEntry,
} from "../../presentation";
import type { ValidatedChronicle } from "../../domain";
import { useSnapshot, type PublicChronicleSnapshot } from "../app-shell/snapshot";
import "./current-roadmap.css";

interface ViewContext {
  projectTitle: string;
  timeZone: string;
  presentation: CurrentRoadmapPresentation;
}

const timestampFormatters = new Map<string, Intl.DateTimeFormat>();

function timestampFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = timestampFormatters.get(timeZone);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  timestampFormatters.set(timeZone, formatter);
  return formatter;
}

function formatTimestamp(value: string, timeZone: string): string {
  return timestampFormatter(timeZone).format(new Date(value));
}

function formatPlannedDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

function statusLabel(status: string): string {
  return status.replaceAll("-", " ");
}

function EntityReference({ reference }: { reference: EntityLink }) {
  return reference.type === "milestone" ? (
    <Link to={`/milestones/${encodeURIComponent(reference.id)}`}>
      <span className="reference-id">{reference.id}</span> {reference.title}
    </Link>
  ) : (
    <Link to={`/roadmap#${encodeURIComponent(reference.id)}`}>
      <span className="reference-id">{reference.id}</span> {reference.title}
    </Link>
  );
}

function Timestamp({ value, timeZone }: { value: string; timeZone: string }) {
  return <time dateTime={value} title={value}>{formatTimestamp(value, timeZone)}</time>;
}

function AnnotationList({ annotations }: { annotations: readonly HistoricalAnnotation[] }) {
  if (annotations.length === 0) return null;
  return (
    <section className="compact-section" aria-labelledby="current-history-context">
      <h2 id="current-history-context">Later historical context</h2>
      <ul className="plain-list">
        {annotations.map((annotation) => (
          <li key={`${annotation.kind}:${annotation.sourceMilestoneId}`}>
            <span className="status-text">{statusLabel(annotation.kind)}</span>{" "}
            <Link to={`/milestones/${encodeURIComponent(annotation.sourceMilestoneId)}`}>
              {annotation.sourceMilestoneId} {annotation.sourceMilestoneTitle}
            </Link>
            <span> — {annotation.explanation}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CurrentView({ projectTitle, timeZone, presentation }: ViewContext) {
  const current = presentation.current;
  if (current === undefined) {
    return (
      <section className="orientation-page" aria-labelledby="current-title">
        <p className="eyebrow">{projectTitle}</p>
        <h1 id="current-title">Current</h1>
        <p className="empty-note">No operational current state has been recorded.</p>
      </section>
    );
  }

  return (
    <article className="orientation-page" aria-labelledby="current-title">
      <header className="orientation-heading">
        <p className="eyebrow">{projectTitle}</p>
        <h1 id="current-title">Current</h1>
        <p className="state-statement">{current.state}</p>
      </header>

      <div role="group" aria-label="Current state timestamps">
        <dl className="current-times">
          <div>
            <dt>Current milestone</dt>
            <dd>
              <Link to={`/milestones/${encodeURIComponent(current.milestone.id)}`}>
                {current.milestone.id}
              </Link>
              <span className="time-detail">
                Accepted <Timestamp value={current.milestone.occurredAt} timeZone={timeZone} />
              </span>
            </dd>
          </div>
          <div>
            <dt>Project status updated</dt>
            <dd><Timestamp value={current.updatedAt} timeZone={timeZone} /></dd>
          </div>
        </dl>
      </div>

      {current.currentHypothesis === undefined ? null : (
        <CurrentSection title="Current hypothesis">
          <p>{current.currentHypothesis}</p>
        </CurrentSection>
      )}

      {current.activeWork.length === 0 ? null : (
        <CurrentSection title="Active work">
          <ul className="plain-list">
            {current.activeWork.map((work, index) => <li key={`${index}:${work}`}>{work}</li>)}
          </ul>
        </CurrentSection>
      )}

      {current.nextStep === undefined ? null : (
        <CurrentSection title="Next step"><p>{current.nextStep}</p></CurrentSection>
      )}

      {current.blocked.length === 0 ? null : (
        <CurrentSection title="Blocked">
          <ul className="plain-list blocker-list">
            {current.blocked.map((blocker, index) => (
              <li key={`${blocker.summary}:${index}`}>
                <span>{blocker.summary}</span>
                {blocker.blockedBy.length === 0 ? null : (
                  <span className="reference-row">
                    Blocked by{" "}
                    {blocker.blockedBy.map((reference, referenceIndex) => (
                      <span key={`${reference.type}:${reference.id}`}>
                        {referenceIndex === 0 ? null : ", "}
                        <EntityReference reference={reference} />
                      </span>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </CurrentSection>
      )}

      <AnnotationList annotations={current.milestone.annotations} />

      {current.relatedRoadmapItems.length === 0 ? null : (
        <nav className="related-links" aria-label="Related roadmap items">
          <span>Related plan</span>
          {current.relatedRoadmapItems.map((item) => (
            <EntityReference key={item.id} reference={item} />
          ))}
        </nav>
      )}
    </article>
  );
}

function CurrentSection({ title, children }: { title: string; children: ReactNode }) {
  const id = `current-${title.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <section className="current-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

interface RoadmapTreeNode {
  item: RoadmapItemPresentation;
  depth: number;
  children: RoadmapTreeNode[];
}

function roadmapTree(outline: readonly RoadmapOutlineEntry[]): readonly RoadmapTreeNode[] {
  const roots: RoadmapTreeNode[] = [];
  const ancestors: RoadmapTreeNode[] = [];
  for (const entry of outline) {
    const node: RoadmapTreeNode = { ...entry, children: [] };
    const parent = entry.depth === 0 ? undefined : ancestors[entry.depth - 1];
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
    ancestors[entry.depth] = node;
    ancestors.length = entry.depth + 1;
  }
  return roots;
}

function RoadmapItemView({ item, depth, children }: RoadmapTreeNode) {
  return (
    <li id={item.id} className="roadmap-item" data-depth={depth}>
      <article aria-labelledby={`${item.id}-title`}>
        <header className="roadmap-item-heading">
          <div>
            <span className="roadmap-level">Level {depth + 1}. </span>
            <span className={`status-badge status-${item.status}`}>{statusLabel(item.status)}</span>
            <h2 id={`${item.id}-title`}>
              <span className="reference-id">{item.id}</span> {item.title}
            </h2>
          </div>
          {item.plannedFor === undefined ? null : (
            <time dateTime={item.plannedFor}>Planned {formatPlannedDate(item.plannedFor)}</time>
          )}
        </header>

        {item.acceptanceCriteria.length === 0 ? null : (
          <section className="roadmap-detail">
            <h3 id={`${item.id}-criteria`}>Acceptance criteria</h3>
            <ul>
              {item.acceptanceCriteria.map((criterion, index) => (
                <li key={`${index}:${criterion}`}>{criterion}</li>
              ))}
            </ul>
          </section>
        )}

        {item.blockerSummary === undefined ? null : (
          <p className="roadmap-blocker"><strong>Blocked:</strong> {item.blockerSummary}</p>
        )}

        {item.blockedBy.length === 0 ? null : (
          <p className="reference-row">
            Blocked by{" "}
            {item.blockedBy.map((reference, index) => (
              <span key={`${reference.type}:${reference.id}`}>
                {index === 0 ? null : ", "}
                <EntityReference reference={reference} />
              </span>
            ))}
          </p>
        )}

        {item.supersededBy === undefined ? null : (
          <p className="reference-row">Superseded by <EntityReference reference={item.supersededBy} /></p>
        )}

        {item.relatedMilestones.length === 0 ? null : (
          <nav className="reference-row" aria-label={`Related milestones for ${item.id}`}>
            Related history{" "}
            {item.relatedMilestones.map((milestone, index) => (
              <span key={milestone.id}>
                {index === 0 ? null : ", "}
                <EntityReference reference={milestone} />
              </span>
            ))}
          </nav>
        )}
      </article>
      {children.length === 0 ? null : (
        <ol className="roadmap-children">
          {children.map((child) => <RoadmapItemView key={child.item.id} {...child} />)}
        </ol>
      )}
    </li>
  );
}

export function RoadmapView({ projectTitle, timeZone, presentation }: ViewContext) {
  return (
    <article className="orientation-page roadmap-page" aria-labelledby="roadmap-title">
      <header className="orientation-heading">
        <p className="eyebrow">{projectTitle}</p>
        <h1 id="roadmap-title">Roadmap</h1>
        <p className="roadmap-intro">Forward work remains separate from recorded History.</p>
        <p className="updated-note">
          Plan updated <Timestamp value={presentation.roadmap.updatedAt} timeZone={timeZone} />
        </p>
      </header>
      {presentation.roadmap.outline.length === 0 ? (
        <p className="empty-note">No roadmap items have been recorded.</p>
      ) : (
        <ol className="roadmap-outline" aria-label="Project roadmap">
          {roadmapTree(presentation.roadmap.outline).map((node) => (
            <RoadmapItemView key={node.item.id} {...node} />
          ))}
        </ol>
      )}
    </article>
  );
}

function presentationFrom(snapshot: PublicChronicleSnapshot): CurrentRoadmapPresentation {
  // The public server snapshot omits only its private filesystem root. This pure
  // presentation adapter never reads that field.
  return createCurrentRoadmapPresentation(snapshot as unknown as ValidatedChronicle);
}

function readyContext(snapshot: PublicChronicleSnapshot): ViewContext {
  return {
    projectTitle: snapshot.project.value.project.title,
    timeZone: snapshot.project.value.display.timezone,
    presentation: presentationFrom(snapshot),
  };
}

export function CurrentPage() {
  const { state } = useSnapshot();
  if (state.status !== "ready") return null;
  return <CurrentView {...readyContext(state.snapshot)} />;
}

export function RoadmapPage() {
  const { state } = useSnapshot();
  if (state.status !== "ready") return null;
  return <RoadmapView {...readyContext(state.snapshot)} />;
}
