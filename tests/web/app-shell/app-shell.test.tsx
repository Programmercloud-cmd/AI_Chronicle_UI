// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { AppShell } from "../../../src/web/app-shell/app-shell";
import { SnapshotProvider, useSnapshot } from "../../../src/web/app-shell/snapshot";

function snapshot(title = "Canonical Chronicle") {
  return {
    project: {
      sourcePath: "project.yaml",
      value: {
        schema_version: 1,
        project: { id: "canonical", title },
        display: { timezone: "Europe/Paris" },
      },
    },
    roadmap: { sourcePath: "roadmap.yaml", value: { schema_version: 1, updated_at: "2026-05-01T00:00:00Z", items: [] } },
    branches: [],
    milestones: [],
    engineeringEvents: [],
    revisions: [],
    evidence: [],
    warnings: [],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderShell(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AppShell />
    </MemoryRouter>,
  );
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

function FreezeProbe() {
  const { state } = useSnapshot();
  if (state.status !== "ready") return <span>waiting</span>;
  return (
    <output>
      {String(Object.isFrozen(state.snapshot))}:{String(Object.isFrozen(state.snapshot.project.value.project))}
    </output>
  );
}

describe("app shell", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: memoryStorage(),
    });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads one immutable snapshot and retains it across shell navigation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(snapshot()));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderShell();

    expect(screen.getByRole("status")).toHaveTextContent("Reading the validated local snapshot");
    expect(await screen.findByRole("heading", { name: "Current" })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/snapshot", expect.objectContaining({ cache: "no-store" }));
    expect(screen.getByLabelText("Chronicle project")).toHaveTextContent("Canonical Chronicle");

    await user.click(screen.getByRole("link", { name: "History" }));
    expect(await screen.findByRole("heading", { name: "History" })).toBeVisible();
    expect(document.activeElement).toBe(screen.getByRole("main"));
    await user.click(screen.getByRole("link", { name: "Roadmap" }));
    expect(await screen.findByRole("heading", { name: "Roadmap" })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deep-freezes the browser snapshot boundary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(snapshot())));
    render(
      <SnapshotProvider>
        <FreezeProbe />
      </SnapshotProvider>,
    );
    expect(await screen.findByText("true:true")).toBeVisible();
  });

  it("provides a milestone detail route boundary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(snapshot())));
    renderShell("/milestones/CORE-007");
    expect(await screen.findByRole("heading", { name: "Milestone not found" })).toBeVisible();
    expect(screen.getByText(/not present in this validated snapshot/u)).toBeVisible();
  });

  it("shows safe diagnostics and retries only when explicitly requested", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        error: "chronicle-invalid",
        diagnostics: [
          { code: "shape-invalid", sourcePath: "C:\\Users\\owner\\secret.yaml", message: "C:\\private" },
          { code: "missing-required", sourcePath: "milestones/CORE-001.yaml" },
        ],
      }, 422))
      .mockResolvedValueOnce(jsonResponse(snapshot("Recovered Chronicle")));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderShell();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("chronicle-invalid");
    expect(alert).toHaveTextContent("milestones/CORE-001.yaml");
    expect(alert).not.toHaveTextContent("Users");
    expect(alert).not.toHaveTextContent("private");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Retry snapshot" }));
    expect(await screen.findByRole("heading", { name: "Current" })).toBeVisible();
    expect(screen.getByLabelText("Chronicle project")).toHaveTextContent("Recovered Chronicle");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("persists an explicit theme choice and exposes core keyboard landmarks", async () => {
    window.localStorage.setItem("chronicle-theme-v1", "dark");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(snapshot())));
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole("heading", { name: "Current" });
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Use light theme" }));
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "light"));
    expect(window.localStorage.getItem("chronicle-theme-v1")).toBe("light");
  });
});
