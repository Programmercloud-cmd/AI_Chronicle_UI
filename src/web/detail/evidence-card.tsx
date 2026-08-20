import type { PublicChronicleSnapshot } from "../app-shell/snapshot";

type Evidence = PublicChronicleSnapshot["evidence"][number]["value"];
const SAFE_EVIDENCE_ID = /^EVD-[0-9]{4,}$/u;

function safeExternalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function EvidenceCard({ evidence }: { evidence: Evidence }) {
  const source = evidence.source;
  const safeId = SAFE_EVIDENCE_ID.test(evidence.id);
  const previewUrl = safeId ? `/api/evidence/${encodeURIComponent(evidence.id)}/preview` : undefined;
  const rawUrl = safeId ? `/api/evidence/${encodeURIComponent(evidence.id)}/raw` : undefined;
  const externalUrl = source.kind === "url" ? safeExternalUrl(source.url) : undefined;

  return (
    <article className="evidence-card" id={safeId ? `evidence-${evidence.id}` : undefined}>
      <div className="detail-row">
        <h3>{evidence.title}</h3>
        <span className="status-chip">{evidence.kind.replaceAll("_", " ")}</span>
      </div>
      <p><code>{evidence.id}</code> · <time dateTime={evidence.captured_at}>{evidence.captured_at}</time></p>
      {evidence.description === undefined ? null : <p>{evidence.description}</p>}
      {source.kind === "artifact" ? (
        <p className="evidence-actions">
          {previewUrl === undefined ? null : <a href={previewUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open safe preview ${evidence.id}`}>Open safe preview</a>}
          {rawUrl === undefined ? null : <a href={rawUrl} aria-label={`Download original ${evidence.id}`}>Download original</a>}
        </p>
      ) : null}
      {source.kind === "url" ? (
        externalUrl === undefined
          ? <p>External URL is not safe to open.</p>
          : <p><a href={externalUrl} target="_blank" rel="noopener noreferrer">Open external evidence</a></p>
      ) : null}
      {source.kind === "repository_ref" ? (
        <p>Repository reference: <code>{source.path}</code> at <code>{source.revision}</code></p>
      ) : null}
      {evidence.origin === undefined ? null : (
        <details>
          <summary>Provenance</summary>
          <dl className="compact-definition-list">
            <dt>Tool</dt><dd>{evidence.origin.tool}</dd>
            {evidence.origin.command === undefined ? null : <><dt>Recorded command</dt><dd><code>{evidence.origin.command}</code></dd></>}
            {evidence.origin.base_revision === undefined ? null : <><dt>Base revision</dt><dd><code>{evidence.origin.base_revision}</code></dd></>}
            {evidence.origin.target_revision === undefined ? null : <><dt>Target revision</dt><dd><code>{evidence.origin.target_revision}</code></dd></>}
          </dl>
        </details>
      )}
    </article>
  );
}
