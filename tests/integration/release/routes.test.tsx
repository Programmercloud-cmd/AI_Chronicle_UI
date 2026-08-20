// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import path from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { loadChronicle } from "../../../src/data";
import { validateChronicle } from "../../../src/domain";
import { AppShell } from "../../../src/web/app-shell/app-shell";
import type { PublicChronicleSnapshot } from "../../../src/web/app-shell/snapshot";

let canonical: PublicChronicleSnapshot;

beforeAll(async () => {
  const loaded = await loadChronicle(path.resolve("examples/canonical"));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
  const validated = await validateChronicle(loaded.value);
  if (!validated.ok) throw new Error(JSON.stringify(validated.diagnostics));
  const { rootPath: _rootPath, ...snapshot } = validated.value;
  canonical = JSON.parse(JSON.stringify(snapshot)) as PublicChronicleSnapshot;
});

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => { values.delete(key); },
      setItem: (key: string, value: string) => { values.set(key, String(value)); },
    } satisfies Storage,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderShell(pathname = "/") {
  return render(<MemoryRouter initialEntries={[pathname]}><AppShell /></MemoryRouter>);
}

function mockCanonical(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "/api/snapshot") {
      return new Response(JSON.stringify(canonical), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  return fetchMock;
}

describe("accepted page route integration", () => {
  it("navigates Current, History, and Roadmap through one immutable snapshot", async () => {
    const fetchMock = mockCanonical();
    const user = userEvent.setup();
    renderShell();

    expect(await screen.findByRole("heading", { name: "Current" })).toBeVisible();
    expect(screen.getByText("Stable timestamp handling is accepted on the canonical replay.")).toBeVisible();
    await user.click(screen.getByRole("link", { name: "History" }));
    expect(await screen.findByRole("heading", { name: "History" })).toBeVisible();
    expect(screen.getByLabelText("Scrollable project history timeline")).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Roadmap" }));
    expect(await screen.findByRole("heading", { name: "Roadmap" })).toBeVisible();
    expect(screen.getByRole("list", { name: "Project roadmap" })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("opens accepted milestone detail and preserves a controlled not-found route", async () => {
    mockCanonical();
    const detail = renderShell("/milestones/TIM-003");
    expect(await screen.findByRole("heading", { name: "Validation Passed" })).toBeVisible();
    detail.unmount();

    renderShell("/missing-view");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
  });
});
