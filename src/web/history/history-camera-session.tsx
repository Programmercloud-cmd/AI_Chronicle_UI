import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

export interface HistoryCameraSnapshot {
  cameraResetKey: string;
  centerX: number;
  centerY: number;
  scale: number;
  mode: "canonical" | "manual";
}

interface HistoryCameraSession {
  read(resetKey: string): HistoryCameraSnapshot | undefined;
  commit(snapshot: HistoryCameraSnapshot): void;
}

function validSnapshot(snapshot: HistoryCameraSnapshot): boolean {
  return snapshot.cameraResetKey.length > 0 &&
    Number.isFinite(snapshot.centerX) &&
    Number.isFinite(snapshot.centerY) &&
    Number.isFinite(snapshot.scale) &&
    snapshot.scale > 0 &&
    (snapshot.mode === "canonical" || snapshot.mode === "manual");
}

const HistoryCameraSessionContext = createContext<HistoryCameraSession | undefined>(undefined);

export function HistoryCameraSessionProvider({ children }: { children: ReactNode }) {
  const snapshotRef = useRef<HistoryCameraSnapshot | undefined>(undefined);
  const session = useMemo<HistoryCameraSession>(() => ({
    read(resetKey) {
      const snapshot = snapshotRef.current;
      return snapshot?.cameraResetKey === resetKey ? snapshot : undefined;
    },
    commit(snapshot) {
      if (validSnapshot(snapshot)) snapshotRef.current = Object.freeze({ ...snapshot });
    },
  }), []);

  return (
    <HistoryCameraSessionContext.Provider value={session}>
      {children}
    </HistoryCameraSessionContext.Provider>
  );
}

export function useHistoryCameraSession(): HistoryCameraSession {
  const session = useContext(HistoryCameraSessionContext);
  if (session === undefined) {
    throw new Error("useHistoryCameraSession must be used inside HistoryCameraSessionProvider");
  }
  return session;
}
