import { useEffect, useRef } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { CurrentPage, RoadmapPage } from "../current-roadmap";
import { MilestoneDetailPage } from "../detail";
import { HistoryPage } from "../history";
import { HistoryCameraSessionProvider } from "../history/history-camera-session";
import { SnapshotProvider, useSnapshot } from "./snapshot";
import { ThemeProvider, useTheme } from "./theme";

const NAV_ITEMS = [
  { to: "/", label: "Current", end: true },
  { to: "/history", label: "History", end: false },
  { to: "/roadmap", label: "Roadmap", end: false },
] as const;

export function canNavigateBackWithinChronicle(): boolean {
  const index = window.history.state?.idx;
  return typeof index === "number" && Number.isFinite(index) && index > 0;
}

function LoadingState() {
  return (
    <section className="shell-state" aria-labelledby="loading-title">
      <p className="eyebrow">Project history</p>
      <h1 id="loading-title">Loading Chronicle</h1>
      <p role="status" aria-live="polite">Reading the validated local snapshot.</p>
    </section>
  );
}

function ErrorState() {
  const { state, reload } = useSnapshot();
  if (state.status !== "error") return null;
  return (
    <section className="shell-state shell-error" role="alert" aria-labelledby="error-title">
      <p className="eyebrow">Snapshot unavailable</p>
      <h1 id="error-title">Chronicle could not load</h1>
      <p>
        The local dataset was not available as a validated snapshot.
        {state.statusCode === undefined ? "" : ` HTTP ${state.statusCode}.`}
      </p>
      <p className="diagnostic-code">Error code: {state.errorCode}</p>
      {state.diagnostics.length === 0 ? null : (
        <ul aria-label="Validation diagnostics">
          {state.diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.code}:${diagnostic.sourcePath}:${index}`}>
              <code>{diagnostic.code}</code> at <code>{diagnostic.sourcePath}</code>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={reload}>Retry snapshot</button>
    </section>
  );
}

function PlaceholderPage({ title, description }: { title: string; description: string }) {
  const { state } = useSnapshot();
  if (state.status !== "ready") return null;
  return (
    <section className="placeholder" aria-labelledby="page-title">
      <p className="eyebrow">{state.snapshot.project.value.project.title}</p>
      <h1 id="page-title">{title}</h1>
      <p>{description}</p>
    </section>
  );
}

function ShellRoutes() {
  return (
    <Routes>
      <Route path="/" element={<CurrentPage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/roadmap" element={<RoadmapPage />} />
      <Route path="/milestones/:milestoneId" element={<MilestoneDetailPage />} />
      <Route path="*" element={<PlaceholderPage title="Page not found" description="Choose a Chronicle view from the navigation." />} />
    </Routes>
  );
}

function MainContent() {
  const { state } = useSnapshot();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const previousPath = useRef(location.pathname);

  useEffect(() => {
    if (previousPath.current !== location.pathname) {
      previousPath.current = location.pathname;
      mainRef.current?.focus();
    }
  }, [location.pathname]);

  return (
    <main id="main-content" className="site-main" ref={mainRef} tabIndex={-1}>
      {state.status === "loading" ? <LoadingState /> : null}
      {state.status === "error" ? <ErrorState /> : null}
      {state.status === "ready" ? <ShellRoutes /> : null}
    </main>
  );
}

function AppFrame() {
  const { state } = useSnapshot();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const projectTitle = state.status === "ready"
    ? state.snapshot.project.value.project.title
    : "Project Chronicle";

  const navigateBack = () => {
    if (canNavigateBackWithinChronicle()) {
      void navigate(-1);
      return;
    }
    void navigate("/history", { replace: true });
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="site-header">
        <div className="header-start">
          <button
            className="back-control"
            type="button"
            aria-label="Back"
            title="Back"
            onClick={navigateBack}
          >
            <span aria-hidden="true">&lt;</span>
          </button>
          <div className="brand" aria-label="Chronicle project">
            <span className="brand-mark" aria-hidden="true">C</span>
            <span>{projectTitle}</span>
          </div>
        </div>
        <nav aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button className="theme-toggle" type="button" onClick={toggleTheme}>
          Use {theme === "light" ? "dark" : "light"} theme
        </button>
      </header>
      <MainContent />
    </div>
  );
}

export function AppShell() {
  return (
    <ThemeProvider>
      <SnapshotProvider>
        <HistoryCameraSessionProvider>
          <AppFrame />
        </HistoryCameraSessionProvider>
      </SnapshotProvider>
    </ThemeProvider>
  );
}
