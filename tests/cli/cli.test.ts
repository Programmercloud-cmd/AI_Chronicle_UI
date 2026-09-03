import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { executeCli } from "../../src/cli";
import { loadChronicle } from "../../src/data";
import { validateChronicle } from "../../src/domain";

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd, encoding: "utf8" });
}

function capture(): { io: { stdout: { write(text: string): void }; stderr: { write(text: string): void } }; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { io: { stdout: { write: (text) => { stdout.push(text); } }, stderr: { write: (text) => { stderr.push(text); } } }, stdout, stderr };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Chronicle CLI", () => {
  it("initializes only a valid conventional empty dataset", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "chronicle-cli-"));
    temporaryRoots.push(parent);
    const root = path.join(parent, "My Project");
    const output = capture();
    const result = await executeCli(["init", root], output.io);
    expect(result.exitCode).toBe(0);
    const loaded = await loadChronicle(root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect((await validateChronicle(loaded.value)).ok).toBe(true);
    expect(loaded.value.project.value.project.id).toBe("my-project");
    const generatedGuide = await readFile(path.join(root, "AGENTS.md"));
    const maintainedGuide = await readFile(path.resolve("templates/chronicle/AGENTS.md"));
    expect(generatedGuide.equals(maintainedGuide)).toBe(true);
    expect(generatedGuide.toString("utf8")).toContain("# Project Chronicle — Agent Authoring Guide");
    const generatedAttributes = await readFile(path.join(root, ".gitattributes"));
    const maintainedAttributes = await readFile(path.resolve("templates/chronicle/.gitattributes"));
    expect(generatedAttributes.equals(maintainedAttributes)).toBe(true);
    expect(generatedAttributes.toString("utf8")).toBe("evidence/artifacts/** -text\n");
    expect((await readdir(root)).sort()).toEqual([
      ".gitattributes",
      "AGENTS.md",
      "project.yaml",
      "roadmap.yaml",
    ]);
    expect(output.stdout.join("")).toContain("Initialized Chronicle");
  });

  it("keeps an initialized dataset valid after a Git commit and clean clone", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "chronicle-cli-portability-"));
    temporaryRoots.push(parent);
    const source = path.join(parent, "source");
    const clone = path.join(parent, "clone");
    await mkdir(source);
    expect((await executeCli(["init", path.join(source, "chronicle")], capture().io)).exitCode).toBe(0);

    await git(source, "init");
    await git(source, "add", ".");
    await git(
      source,
      "-c", "user.name=Chronicle Test",
      "-c", "user.email=chronicle@example.invalid",
      "commit", "-m", "Initialize Chronicle",
    );
    await git(parent, "clone", source, clone);

    expect((await readdir(path.join(clone, "chronicle"))).sort()).toEqual([
      ".gitattributes",
      "AGENTS.md",
      "project.yaml",
      "roadmap.yaml",
    ]);
    const validation = capture();
    expect((await executeCli(["validate", path.join(clone, "chronicle")], validation.io)).exitCode).toBe(0);
    expect(JSON.parse(validation.stdout.join(""))).toEqual({ valid: true, warnings: [] });
  });

  it("refuses to overwrite an existing path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chronicle-cli-existing-"));
    temporaryRoots.push(root);
    await writeFile(path.join(root, "keep.txt"), "keep", "utf8");
    const output = capture();
    const result = await executeCli(["init", root], output.io);
    expect(result.exitCode).toBe(1);
    expect(output.stderr.join("")).toContain("refusing to overwrite");
  });

  it("reports validate success and deterministic failure", async () => {
    const valid = capture();
    expect((await executeCli(["validate", path.resolve("examples/canonical")], valid.io)).exitCode).toBe(0);
    expect(JSON.parse(valid.stdout.join("")).valid).toBe(true);

    const root = await mkdtemp(path.join(tmpdir(), "chronicle-cli-invalid-"));
    temporaryRoots.push(root);
    await mkdir(path.join(root, "branches"));
    const invalid = capture();
    expect((await executeCli(["validate", root], invalid.io)).exitCode).toBe(1);
    expect(JSON.parse(invalid.stderr.join("")).valid).toBe(false);
  });

  it("rejects remote bind requests and invalid ports", async () => {
    const remote = capture();
    expect((await executeCli(["serve", path.resolve("examples/canonical"), "--host", "0.0.0.0"], remote.io)).exitCode).toBe(1);
    expect(remote.stderr.join("")).toContain("only permits");
    const port = capture();
    expect((await executeCli(["serve", path.resolve("examples/canonical"), "--port", "NaN"], port.io)).exitCode).toBe(1);
    expect(port.stderr.join("")).toContain("port must be");
  });

  it("starts serve on an ephemeral loopback port and returns its lifecycle handle", async () => {
    const output = capture();
    const result = await executeCli(["serve", path.resolve("examples/canonical"), "--port", "0"], output.io);
    expect(result.exitCode).toBe(0);
    expect(result.server?.listeningOrigin).toMatch(/^http:\/\/127\.0\.0\.1:/u);
    await result.server?.close();
  });
});
