import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { assertPackageFiles, inspectPackageFiles, requiredPackageFiles } from "../../scripts/package-policy.mjs";
import { assertReleaseTag } from "../../scripts/release-artifacts.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");

describe("release tag validation", () => {
  it("accepts only the exact stable package version tag", () => {
    expect(() => assertReleaseTag("v0.2.0", "0.2.0")).not.toThrow();
    expect(() => assertReleaseTag("v0.2.1", "0.2.0")).toThrow(/tag\/version mismatch/u);
    expect(() => assertReleaseTag("0.2.0", "0.2.0")).toThrow(/expected tag v0\.2\.0/u);
    expect(() => assertReleaseTag("v0.2.0-beta.1", "0.2.0-beta.1")).toThrow(/stable semantic version/u);
  });
});

describe("release package policy", () => {
  it("accepts the required package surface and rejects development material", () => {
    expect(() => assertPackageFiles(requiredPackageFiles)).not.toThrow();
    expect(inspectPackageFiles([...requiredPackageFiles, "chronicle/project.yaml"]).forbidden)
      .toEqual(["chronicle/project.yaml"]);
    expect(inspectPackageFiles([...requiredPackageFiles, "dev/evidence/check.txt"]).forbidden)
      .toEqual(["dev/evidence/check.txt"]);
    expect(inspectPackageFiles(requiredPackageFiles.filter((file) => file !== "templates/chronicle/AGENTS.md")).missing)
      .toContain("templates/chronicle/AGENTS.md");
  });
});

describe("GitHub release workflow", () => {
  it("uses tagged clean runners, required gates, immutable releases, and built-in credentials", async () => {
    const source = await readFile(path.join(repositoryRoot, ".github", "workflows", "release.yml"), "utf8");
    const workflow = parse(source) as {
      on: { push: { tags: string[] } };
      permissions: { contents: string };
      jobs: { release: { "runs-on": string; steps: Array<{ name: string; run?: string; with?: Record<string, unknown> }> } };
    };
    const steps = workflow.jobs.release.steps;
    const commands = steps.map((step) => step.run ?? "").join("\n");

    expect(workflow.on.push.tags).toEqual(["v*"]);
    expect(workflow.permissions).toEqual({ contents: "write" });
    expect(workflow.jobs.release["runs-on"]).toBe("ubuntu-latest");
    expect(steps.find((step) => step.name === "Set up Node.js")?.with?.["node-version"]).toBe("24");
    expect(commands).toContain('git fetch --no-tags origin "+refs/heads/main:refs/remotes/origin/main"');
    expect(commands).toContain('git rev-parse "${GITHUB_REF_NAME}^{commit}"');
    expect(commands).toContain('git rev-parse "HEAD^{commit}"');
    expect(commands).toContain('git rev-parse "refs/remotes/origin/main^{commit}"');
    expect(commands).toContain('git merge-base --is-ancestor "$tag_commit" "$main_commit"');
    expect(commands).toContain("npm ci");
    expect(commands).toContain("npm audit --omit=dev");
    expect(commands).toContain("npm run release:check");
    expect(commands).toContain("release-artifacts.mjs prepare");
    expect(commands).toContain("sha256sum --check SHA256SUMS.txt");
    expect(commands).toContain("gh release create");
    expect(commands).toContain("gh release upload");
    expect(commands).toContain("--draft=false");
    expect(commands).not.toContain("npm publish");
    expect(commands).not.toContain("--clobber");
    expect(source).toContain("GH_TOKEN: ${{ github.token }}");
  });
});
