import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";

import { useSnapshot, type PublicChronicleSnapshot } from "../app-shell/snapshot";
import { ActualDiff } from "./actual-diff";
import { EvidenceCard } from "./evidence-card";
import "./detail.css";

type Snapshot = PublicChronicleSnapshot;
type Milestone = Snapshot["milestones"][number];
type Evidence = Snapshot["evidence"][number];

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function DetailList({
  title,
  values,
  headingLevel = 2,
}: {
  title: string;
  values: readonly string[] | undefined;
  headingLevel?: 2 | 4;
}) {
  if (values === undefined || values.length === 0) return null;
  const Heading = headingLevel === 4 ? "h4" : "h2";
  return (
    <section className="detail-section">
      <Heading>{title}</Heading>
      <ul>{values.map((value, index) => <li key={`${index}:${value}`}>{value}</li>)}</ul>
    </section>
  );
}

function MilestoneLinks({ title, milestones }: { title: string; milestones: readonly Milestone[] }) {
  if (milestones.length === 0) return null;
  return (
    <section className="detail-section">
      <h2>{title}</h2>
      <ul className="link-list">
        {milestones.map((record) => (
          <li key={record.value.id}>
            <Link to={`/milestones/${encodeURIComponent(record.value.id)}`}>{record.value.title}</Link>
            <span><code>{record.value.id}</code> · {record.value.status}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RevisionChanges({ changes }: { changes: Snapshot["revisions"][number]["value"]["changes"] }) {
  return (
    <details>
      <summary>Compare captured values</summary>
      <ol className="revision-changes">{changes.map((change, index) => (
        <li key={`${index}:${change.operation}:${change.path}`}>
          <p><strong>{change.operation}</strong> <code>{change.path}</code></p>
          <dl className="compact-definition-list">
            <dt>Previous</dt><dd><pre>{change.operation === "add" ? "(absent)" : JSON.stringify(change.from, null, 2)}</pre></dd>
            <dt>Revised</dt><dd><pre>{change.operation === "remove" ? "(absent)" : JSON.stringify(change.value, null, 2)}</pre></dd>
          </dl>
        </li>
      ))}</ol>
    </details>
  );
}

function selectEvidence(snapshot: Snapshot, milestone: Milestone): Evidence[] {
  const ids = new Set<string>(milestone.value.evidence ?? []);
  for (const change of milestone.value.code_changes ?? []) ids.add(change.diff_evidence_id);
  for (const event of snapshot.engineeringEvents) {
    if (event.value.milestone_id === milestone.value.id) for (const id of event.value.evidence ?? []) ids.add(id);
  }
  return snapshot.evidence.filter((record) => ids.has(record.value.id));
}

export function MilestoneDetailPage() {
  const { milestoneId } = useParams();
  const { state } = useSnapshot();
  const view = useMemo(() => {
    if (state.status !== "ready" || milestoneId === undefined) return undefined;
    const snapshot = state.snapshot;
    const milestone = snapshot.milestones.find((record) => record.value.id === milestoneId);
    if (milestone === undefined) return { snapshot, milestone: undefined };
    const milestoneById = new Map(snapshot.milestones.map((record) => [record.value.id, record]));
    const evidenceById = new Map(snapshot.evidence.map((record) => [record.value.id, record]));
    const revisionById = new Map(snapshot.revisions.map((record) => [record.value.id, record]));
    return {
      snapshot,
      milestone,
      parents: milestone.value.parents.flatMap((id) => {
        const parent = milestoneById.get(id);
        return parent === undefined ? [] : [parent];
      }),
      children: snapshot.milestones.filter((record) => record.value.parents.includes(milestone.value.id))
        .sort((left, right) => compareOrdinal(left.value.id, right.value.id)),
      events: snapshot.engineeringEvents.filter((record) => record.value.milestone_id === milestone.value.id)
        .sort((left, right) => Date.parse(left.value.occurred_at) - Date.parse(right.value.occurred_at) || compareOrdinal(left.value.id, right.value.id)),
      roadmapItems: snapshot.roadmap.value.items.filter((item) => item.related_milestones?.includes(milestone.value.id) === true)
        .sort((left, right) => left.order - right.order || compareOrdinal(left.id, right.id)),
      evidence: selectEvidence(snapshot, milestone),
      evidenceById,
      revisionById,
      milestoneById,
    };
  }, [milestoneId, state]);

  if (state.status !== "ready") return null;
  if (view === undefined || view.milestone === undefined) {
    return (
      <section className="detail-page" aria-labelledby="milestone-not-found">
        <p className="eyebrow">Milestone detail</p>
        <h1 id="milestone-not-found">Milestone not found</h1>
        <p>The requested stable milestone ID is not present in this validated snapshot.</p>
        <Link to="/history">Return to History</Link>
      </section>
    );
  }

  const { milestone } = view;
  const details = milestone.value.details;
  const branch = view.snapshot.branches.find((record) => record.value.id === milestone.value.branch_id);
  return (
    <article className="detail-page" aria-labelledby="milestone-title">
      <header className="detail-hero">
        <p className="eyebrow">Milestone detail</p>
        <div className="detail-row">
          <h1 id="milestone-title">{milestone.value.title}</h1>
          <span className={`status-chip status-${milestone.value.status}`}>{milestone.value.status}</span>
        </div>
        <p className="detail-summary">{milestone.value.summary}</p>
        <dl className="milestone-metadata">
          <dt>Stable ID</dt><dd><code>{milestone.value.id}</code></dd>
          <dt>Occurred</dt><dd><time dateTime={milestone.value.occurred_at}>{milestone.value.occurred_at}</time></dd>
          <dt>Recorded</dt><dd><time dateTime={milestone.value.recorded_at}>{milestone.value.recorded_at}</time></dd>
          <dt>Branch</dt><dd>{branch?.value.title ?? milestone.value.branch_id} <code>{milestone.value.branch_id}</code></dd>
        </dl>
      </header>

      {details?.context === undefined ? null : <section className="detail-section"><h2>Context</h2><p>{details.context}</p></section>}
      <DetailList title="What changed" values={details?.changed} />
      <DetailList title="What explicitly did not change" values={details?.unchanged} />
      <DetailList title="Hypotheses" values={details?.hypotheses} />
      <DetailList title="Acceptance criteria" values={details?.acceptance_criteria} />
      <DetailList title="Results" values={details?.results} />
      <DetailList title="Known limitations" values={details?.known_limitations} />
      {details?.next_step === undefined ? null : <section className="detail-section"><h2>Next step</h2><p>{details.next_step}</p></section>}

      <MilestoneLinks title="Parent milestones" milestones={view.parents} />
      <MilestoneLinks title="Child milestones" milestones={view.children} />

      {milestone.value.relations === undefined || milestone.value.relations.length === 0 ? null : (
        <section className="detail-section">
          <h2>Historical relationships</h2>
          <ul className="relation-list">{milestone.value.relations.map((relation) => {
            const target = view.milestoneById.get(relation.target);
            return (
              <li key={`${relation.type}:${relation.target}`}>
                <strong>{relation.type.replaceAll("_", " ")}</strong>{" "}
                {target === undefined ? <code>{relation.target}</code> : <Link to={`/milestones/${encodeURIComponent(target.value.id)}`}>{target.value.title}</Link>}
                <p>{relation.explanation}</p>
              </li>
            );
          })}</ul>
        </section>
      )}

      {view.roadmapItems.length === 0 ? null : (
        <section className="detail-section">
          <h2>Related roadmap items</h2>
          <ul className="link-list">{view.roadmapItems.map((item) => (
            <li key={item.id}><Link to={`/roadmap#${encodeURIComponent(item.id)}`}>{item.title}</Link><span><code>{item.id}</code> · {item.status}</span></li>
          ))}</ul>
        </section>
      )}

      {milestone.amendments.length === 0 ? null : (
        <section className="detail-section amendment-section">
          <h2>Visible amendments</h2>
          <ol>{milestone.amendments.map((amendment) => {
            const revision = view.revisionById.get(amendment.revisionId)?.value;
            return (
              <li key={amendment.revisionId}>
                <p><code>{amendment.revisionId}</code> · <time dateTime={amendment.recordedAt}>{amendment.recordedAt}</time></p>
                <p>{revision?.summary ?? "Historical capture amended."}</p>
                {revision === undefined ? null : <p>Reason: {revision.reason.replaceAll("_", " ")}. Changed paths: {revision.changes.map((change) => change.path).join(", ")}.</p>}
                {revision === undefined ? null : <RevisionChanges changes={revision.changes} />}
              </li>
            );
          })}</ol>
        </section>
      )}

      {view.events.length === 0 ? null : (
        <section className="detail-section">
          <h2>Engineering and review events</h2>
          <ol className="event-list">{view.events.map((event) => (
            <li key={event.value.id}>
              <div className="detail-row"><h3>{event.value.summary}</h3><span className="status-chip">{event.value.outcome}</span></div>
              <p><code>{event.value.id}</code> · {event.value.kind.replaceAll("_", " ")} · <time dateTime={event.value.occurred_at}>{event.value.occurred_at}</time></p>
              <p>Actor: {event.value.actor.role ?? event.value.actor.label ?? event.value.actor.type}</p>
              {event.value.details === undefined ? null : <p>{event.value.details}</p>}
              {event.value.evidence === undefined ? null : (
                <p>Evidence: {event.value.evidence.map((id, index) => (
                  <span key={id}>{index === 0 ? "" : ", "}<a href={`#evidence-${encodeURIComponent(id)}`}>{id}</a></span>
                ))}</p>
              )}
            </li>
          ))}</ol>
        </section>
      )}

      {milestone.value.code_changes === undefined || milestone.value.code_changes.length === 0 ? null : (
        <section className="detail-section code-section">
          <h2>Code changes</h2>
          {milestone.value.code_changes.map((change) => {
            const evidence = view.evidenceById.get(change.diff_evidence_id)?.value;
            return (
              <article key={change.diff_evidence_id} className="code-change">
                <h3>Actual patch <code>{change.diff_evidence_id}</code></h3>
                <dl className="compact-definition-list">
                  <dt>Why</dt><dd>{change.why}</dd>
                  <dt>Previous behavior</dt><dd>{change.previous_behavior}</dd>
                  <dt>New behavior</dt><dd>{change.new_behavior}</dd>
                </dl>
                <DetailList title="Risks" values={change.risks} headingLevel={4} />
                {evidence === undefined || evidence.source.kind !== "artifact" ? (
                  <p>The validated diff artifact is unavailable.</p>
                ) : (
                  <ActualDiff evidenceId={evidence.id} mediaType={evidence.source.media_type} />
                )}
              </article>
            );
          })}
        </section>
      )}

      {view.evidence.length === 0 ? null : (
        <section className="detail-section evidence-section">
          <h2>Evidence</h2>
          <div className="evidence-grid">{view.evidence.map((record) => <EvidenceCard key={record.value.id} evidence={record.value} />)}</div>
        </section>
      )}
    </article>
  );
}
