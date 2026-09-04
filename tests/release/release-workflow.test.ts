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
  it("requires exact-commit canonical CI and keeps release publication fail-closed", async () => {
    const source = await readFile(path.join(repositoryRoot, ".github", "workflows", "release.yml"), "utf8");
    const workflow = parse(source) as {
      on: { push: { tags: string[] } };
      permissions: { contents: string; actions: string };
      jobs: {
        release: {
          "runs-on": string;
          steps: Array<{ if?: string; name: string; run?: string; uses?: string; with?: Record<string, unknown> }>;
        };
      };
    };
    const steps = workflow.jobs.release.steps;
    const commands = steps.map((step) => step.run ?? "").join("\n");

    expect(workflow.on.push.tags).toEqual(["v*"]);
    expect(workflow.permissions).toEqual({ contents: "write", actions: "read" });
    expect(workflow.jobs.release["runs-on"]).toBe("ubuntu-latest");
    expect(steps.find((step) => step.name === "Set up Node.js")?.with?.["node-version"]).toBe("24");
    expect(commands).toContain('git fetch --no-tags origin "+refs/heads/main:refs/remotes/origin/main"');
    expect(commands).toContain('git rev-parse "${GITHUB_REF_NAME}^{commit}"');
    expect(commands).toContain('git rev-parse "HEAD^{commit}"');
    expect(commands).toContain('git rev-parse "refs/remotes/origin/main^{commit}"');
    expect(commands).toContain('git merge-base --is-ancestor "$tag_commit" "$main_commit"');
    expect(commands).toContain("actions/workflows/ci.yml/runs");
    expect(commands).toContain("-f event=push");
    expect(commands).toContain("-f branch=main");
    expect(commands).toContain('-f head_sha="$tag_commit"');
    expect(commands).toContain('.head_sha == $sha and .head_branch == "main" and .event == "push"');
    expect(commands).toContain('.status == "completed" and .conclusion == "success"');
    expect(commands).toContain("max_attempts=20");
    expect(commands).toContain("wait_seconds=15");
    expect(commands).toContain("npm run release:check");
    expect(commands.match(/npm run release:check/gu)).toHaveLength(1);
    expect(commands).toContain("release-artifacts.mjs prepare");
    expect(commands).toContain("sha256sum --check SHA256SUMS.txt");
    expect(commands).toContain("gh release create");
    expect(commands).toContain("gh release upload");
    expect(commands).toContain("--draft=false");
    expect(commands).not.toContain("npm publish");
    expect(commands).not.toContain("--clobber");
    expect(commands).not.toContain("--update-snapshots");
    expect(source).toContain("GH_TOKEN: ${{ github.token }}");

    const artifactStep = steps.find((step) => step.name === "Upload visual failure evidence");
    expect(artifactStep).toMatchObject({
      if: "failure()",
      uses: "actions/upload-artifact@v4",
      with: {
        "if-no-files-found": "ignore",
        path: "test-results/**",
        "retention-days": 14,
      },
    });
    expect(steps.findIndex((step) => step.name === "Require successful canonical CI for the tagged commit")).toBeLessThan(
      steps.findIndex((step) => step.name === "Run the authoritative release gate"),
    );
    expect(steps.indexOf(artifactStep!)).toBeLessThan(
      steps.findIndex((step) => step.name === "Pack and checksum the release artifact"),
    );
  });
});

describe("GitHub canonical CI workflow", () => {
  it("runs the shared release gate for pull requests and main pushes with read-only access", async () => {
    const source = await readFile(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");
    const workflow = parse(source) as {
      on: { pull_request: { branches: string[] }; push: { branches: string[] } };
      permissions: { contents: string };
      jobs: {
        "canonical-gate": {
          name: string;
          "runs-on": string;
          steps: Array<{ if?: string; name: string; run?: string; uses?: string; with?: Record<string, unknown> }>;
        };
      };
    };
    const job = workflow.jobs["canonical-gate"];
    const commands = job.steps.map((step) => step.run ?? "").join("\n");

    expect(workflow.on.pull_request.branches).toEqual(["main"]);
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(job.name).toBe("Canonical release gate");
    expect(job["runs-on"]).toBe("ubuntu-latest");
    expect(job.steps.find((step) => step.name === "Set up Node.js")?.with?.["node-version"]).toBe("24");
    expect(commands.match(/npm run release:check/gu)).toHaveLength(1);
    expect(commands).not.toContain("--update-snapshots");

    const artifactStep = job.steps.find((step) => step.name === "Upload visual failure evidence");
    expect(artifactStep).toMatchObject({
      if: "failure()",
      uses: "actions/upload-artifact@v4",
      with: {
        "if-no-files-found": "ignore",
        path: "test-results/**",
        "retention-days": 14,
      },
    });
    expect(job.steps.indexOf(artifactStep!)).toBeGreaterThan(
      job.steps.findIndex((step) => step.name === "Run the authoritative release gate"),
    );
  });
});
