import { lazy, Suspense, useEffect, useState } from "react";
import { parseDiff, type FileData } from "react-diff-view/esm";

const MAX_RENDERED_DIFF_BYTES = 2_000_000;
const SAFE_EVIDENCE_ID = /^EVD-[0-9]{4,}$/u;

type DiffState =
  | { status: "loading" }
  | { status: "ready"; files: FileData[] }
  | { status: "unavailable"; message: string };

const ParsedDiff = lazy(async () => {
  const module = await import("./parsed-diff");
  return { default: module.ParsedDiff };
});

async function fetchDiff(evidenceId: string, signal: AbortSignal): Promise<DiffState> {
  try {
    const response = await fetch(`/api/evidence/${encodeURIComponent(evidenceId)}/raw`, {
      cache: "no-store",
      headers: { Accept: "application/octet-stream" },
      signal,
    });
    if (!response.ok) return { status: "unavailable", message: "The validated diff could not be loaded." };
    const declaredSize = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_RENDERED_DIFF_BYTES) {
      return { status: "unavailable", message: "This diff is too large for inline rendering; use the download link." };
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_RENDERED_DIFF_BYTES) {
      return { status: "unavailable", message: "This diff is too large for inline rendering; use the download link." };
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return { status: "unavailable", message: "This diff is not valid UTF-8; use the download link." };
    }
    const files = parseDiff(text);
    return files.length === 0
      ? { status: "unavailable", message: "No unified diff hunks were found; use the download link." }
      : { status: "ready", files };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { status: "unavailable", message: "The validated diff could not be loaded." };
  }
}

export function ActualDiff({ evidenceId, mediaType }: { evidenceId: string; mediaType: string }) {
  const [state, setState] = useState<DiffState>({ status: "loading" });
  const canRender = SAFE_EVIDENCE_ID.test(evidenceId) && mediaType === "text/x-diff";

  useEffect(() => {
    if (!canRender) return undefined;
    const controller = new AbortController();
    setState({ status: "loading" });
    void fetchDiff(evidenceId, controller.signal).then((result) => {
      if (!controller.signal.aborted) setState(result);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [canRender, evidenceId]);

  if (!canRender) return <p>This artifact is download-only.</p>;
  if (state.status === "loading") return <p role="status">Loading validated diff.</p>;
  if (state.status === "unavailable") return <p>{state.message}</p>;
  return <Suspense fallback={<p role="status">Preparing diff renderer.</p>}><ParsedDiff evidenceId={evidenceId} files={state.files} /></Suspense>;
}
