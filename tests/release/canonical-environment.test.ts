import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertBaselineUpdateAllowed,
  assertCanonicalEnvironment,
  assertVisualArgumentsAllowed,
  baselineUpdateMarker,
  buildDockerArguments,
  canonicalImage,
  canonicalMarker,
  canonicalPlatform,
} from "../../scripts/canonical-environment.mjs";

const temporaryDirectories: string[] = [];
const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("canonical Playwright environment", () => {
  it("pins the dependency, exposes the outer/inner split, and removes branded Chrome channels", async () => {
    const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const configs = await Promise.all([
      readFile(path.join(repositoryRoot, "tests", "visual", "history", "playwright.config.ts"), "utf8"),
      readFile(path.join(repositoryRoot, "tests", "integration", "release", "playwright.config.ts"), "utf8"),
    ]);

    expect(packageJson.devDependencies["@playwright/test"]).toBe("1.62.1");
    expect(packageJson.scripts["release:check"]).toBe("node scripts/canonical-environment.mjs release");
    expect(packageJson.scripts["release:check:inner"]).toContain("npm run test:visual:inner");
    expect(packageJson.scripts["test:visual:update"]).toBe("node scripts/canonical-environment.mjs visual-update");
    for (const config of configs) {
      expect(config).toContain('browserName: "chromium"');
      expect(config).not.toContain('channel: "chrome"');
      expect(config).toContain('locale: "en-US"');
      expect(config).toContain('timezoneId: "UTC"');
      expect(config).toContain("deviceScaleFactor: 1");
    }
  });

  it("documents only the public Docker-backed visual commands", async () => {
    const guide = await readFile(path.join(repositoryRoot, "tests", "visual", "history", "README.md"), "utf8");

    expect(guide).toContain("npm run test:visual");
    expect(guide).toContain("npm run test:visual:update -- --confirm");
    expect(guide).toContain("Docker Desktop with Linux containers");
    expect(guide).not.toContain("npx playwright");
    expect(guide).not.toContain("npm run dev:web");
    expect(guide).not.toContain("installed Chrome channel");
  });

  it("pins the accepted Linux/amd64 image and invokes only the inner release gate", () => {
    expect(canonicalPlatform).toBe("linux/amd64");
    expect(canonicalImage).toBe(
      "mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e",
    );

    const args = buildDockerArguments("release", "C:\\repo");
    const command = args.at(-1) ?? "";
    expect(args).toContain("linux/amd64");
    expect(args).toContain(canonicalImage);
    expect(args).toContain(`CHRONICLE_CANONICAL_ENVIRONMENT=${canonicalMarker}`);
    expect(command).toContain("npm ci && npm audit --omit=dev && npm run release:check:inner");
    expect(command).not.toMatch(/npm run release:check(?:\s|$)/u);
  });

  it("keeps visual comparison and baseline generation on separate inner paths", () => {
    const comparison = buildDockerArguments("visual", "C:\\repo").at(-1);
    const update = buildDockerArguments("visual-update", "C:\\repo").at(-1);

    expect(comparison).toContain("npm run test:visual:inner");
    expect(comparison).not.toContain("--update-snapshots");
    expect(update).toContain("npm run test:visual:inner -- --update-snapshots");
    expect(buildDockerArguments("visual", "C:\\repo")).not.toContain(
      `CHRONICLE_BASELINE_UPDATE=${baselineUpdateMarker}`,
    );
    expect(buildDockerArguments("visual-update", "C:\\repo")).toContain(
      `CHRONICLE_BASELINE_UPDATE=${baselineUpdateMarker}`,
    );
  });

  it("rejects direct inner execution outside the pinned container", () => {
    const canonical = {
      env: {
        CHRONICLE_CANONICAL_ENVIRONMENT: canonicalMarker,
        CHRONICLE_CANONICAL_IMAGE: canonicalImage,
        PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright",
      },
      platform: "linux",
      arch: "x64",
    };

    expect(() => assertCanonicalEnvironment(canonical)).not.toThrow();
    expect(() => assertCanonicalEnvironment({ ...canonical, platform: "win32" })).toThrow(/pinned Linux\/amd64/u);
    expect(() =>
      assertCanonicalEnvironment({ ...canonical, env: { ...canonical.env, PLAYWRIGHT_BROWSERS_PATH: undefined } }),
    ).toThrow(/pinned Linux\/amd64/u);
  });

  it("caps Vitest workers only inside the exact canonical environment", async () => {
    vi.stubEnv("CHRONICLE_CANONICAL_ENVIRONMENT", canonicalMarker);
    vi.resetModules();
    const canonicalConfig = (await import("../../vitest.config.ts")).default;
    expect(canonicalConfig.test?.maxWorkers).toBe(2);

    vi.stubEnv("CHRONICLE_CANONICAL_ENVIRONMENT", `${canonicalMarker}-lookalike`);
    vi.resetModules();
    const nativeConfig = (await import("../../vitest.config.ts")).default;
    expect(nativeConfig.test).not.toHaveProperty("maxWorkers");
  });
});

describe("canonical baseline update guard", () => {
  it("requires explicit confirmation and refuses CI", () => {
    expect(() => assertBaselineUpdateAllowed([], { env: {}, root: process.cwd() })).toThrow(/--confirm/u);
    expect(() => assertBaselineUpdateAllowed(["--confirm"], { env: { CI: "true" }, root: process.cwd() })).toThrow(
      /cannot be updated in CI/u,
    );
  });

  it("prevents update flags from bypassing the guarded outer command", () => {
    expect(() => assertVisualArgumentsAllowed([], {})).not.toThrow();
    expect(() => assertVisualArgumentsAllowed(["--update-snapshots"], {})).toThrow(/test:visual:update/u);
    expect(() =>
      assertVisualArgumentsAllowed(["--update-snapshots"], { CHRONICLE_BASELINE_UPDATE: baselineUpdateMarker }),
    ).not.toThrow();
  });

  it("refuses to overwrite an already-dirty snapshot directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chronicle-canonical-environment-"));
    temporaryDirectories.push(root);
    execFileSync("git", ["init", "--quiet"], { cwd: root });

    expect(() => assertBaselineUpdateAllowed(["--confirm"], { env: {}, root })).not.toThrow();

    const snapshots = path.join(root, "tests", "visual", "history", "snapshots");
    await mkdir(snapshots, { recursive: true });
    await writeFile(path.join(snapshots, "changed.png"), "not-a-real-png");

    expect(() => assertBaselineUpdateAllowed(["--confirm"], { env: {}, root })).toThrow(/dirty visual snapshot/u);
  });
});
