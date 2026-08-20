import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type { ValidatedChronicle } from "../../domain";

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type PublicChronicleSnapshot = DeepReadonly<Omit<ValidatedChronicle, "rootPath">>;

export interface SnapshotDiagnostic {
  code: string;
  sourcePath: string;
}

export type SnapshotState =
  | { status: "loading" }
  | { status: "ready"; snapshot: PublicChronicleSnapshot }
  | {
      status: "error";
      errorCode: string;
      statusCode?: number;
      diagnostics: readonly SnapshotDiagnostic[];
    };

interface SnapshotContextValue {
  state: SnapshotState;
  reload(): void;
}

const SnapshotContext = createContext<SnapshotContextValue | undefined>(undefined);
const SAFE_TOKEN = /^[A-Za-z][A-Za-z0-9-]{0,63}$/u;
const SAFE_RELATIVE_PATH = /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,512}$/u;

function safeToken(value: unknown, fallback: string): string {
  return typeof value === "string" && SAFE_TOKEN.test(value) ? value : fallback;
}

function safeSourcePath(value: unknown): string {
  return typeof value === "string" && SAFE_RELATIVE_PATH.test(value) ? value : ".";
}

function diagnosticsFrom(value: unknown): SnapshotDiagnostic[] {
  if (typeof value !== "object" || value === null || !("diagnostics" in value)) return [];
  const diagnostics = (value as { diagnostics?: unknown }).diagnostics;
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.slice(0, 50).map((diagnostic) => {
    const candidate = typeof diagnostic === "object" && diagnostic !== null
      ? diagnostic as Record<string, unknown>
      : {};
    return {
      code: safeToken(candidate.code, "validation-error"),
      sourcePath: safeSourcePath(candidate.sourcePath),
    };
  });
}

function isPublicSnapshot(value: unknown): value is PublicChronicleSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const project = (value as { project?: unknown }).project;
  if (typeof project !== "object" || project === null) return false;
  const record = (project as { value?: unknown }).value;
  if (typeof record !== "object" || record === null) return false;
  const metadata = (record as { project?: unknown }).project;
  return typeof metadata === "object" && metadata !== null &&
    typeof (metadata as { title?: unknown }).title === "string";
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

async function requestSnapshot(signal: AbortSignal): Promise<SnapshotState> {
  try {
    const response = await fetch("/api/snapshot", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const errorCode = typeof body === "object" && body !== null
        ? safeToken((body as { error?: unknown }).error, "snapshot-unavailable")
        : "snapshot-unavailable";
      return {
        status: "error",
        errorCode,
        statusCode: response.status,
        diagnostics: diagnosticsFrom(body),
      };
    }
    if (!isPublicSnapshot(body)) {
      return { status: "error", errorCode: "snapshot-invalid", diagnostics: [] };
    }
    return { status: "ready", snapshot: deepFreeze(body) };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { status: "error", errorCode: "snapshot-unavailable", diagnostics: [] };
  }
}

export function SnapshotProvider({ children }: { children: ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SnapshotState>({ status: "loading" });
  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void requestSnapshot(controller.signal).then((result) => {
      if (!controller.signal.aborted) setState(result);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [attempt]);

  return (
    <SnapshotContext.Provider value={{ state, reload }}>
      {children}
    </SnapshotContext.Provider>
  );
}

export function useSnapshot(): SnapshotContextValue {
  const context = useContext(SnapshotContext);
  if (context === undefined) throw new Error("useSnapshot must be used inside SnapshotProvider");
  return context;
}
