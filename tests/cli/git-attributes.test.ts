import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];
const datasetRoots = ["chronicle", "examples/canonical", "examples/difficult"];
const attributes = "evidence/artifacts/** -text\n";

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return result.stdout;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Chronicle dataset Git attributes", () => {
  it("narrowly protects direct and nested evidence in every repository dataset", async () => {
    for (const root of datasetRoots) {
      expect(await readFile(path.resolve(root, ".gitattributes"), "utf8")).toBe(attributes);
      const direct = `${root}/evidence/artifacts/direct.txt`;
      const nested = `${root}/evidence/artifacts/reports/nested.txt`;
      expect((await git(path.resolve(), "check-attr", "text", "--", direct, nested)).trim().split(/\r?\n/u)).toEqual([
        `${direct}: text: unset`,
        `${nested}: text: unset`,
      ]);
    }
  });

  it("preserves the canonical example's evidence bytes in a checkout with core.autocrlf=true", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "chronicle-attributes-"));
    temporaryRoots.push(parent);
    const source = path.join(parent, "source");
    const checkout = path.join(parent, "checkout");
    await cp(path.resolve("examples/canonical"), source, { recursive: true });
    const artifactRoot = path.join(source, "evidence", "artifacts");
    const artifactPaths = (await readdir(artifactRoot, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll(path.sep, "/"));
    const canonicalBytes = new Map(await Promise.all(artifactPaths.map(async (artifactPath) => [
      artifactPath,
      await readFile(path.join(source, ...artifactPath.split("/"))),
    ] as const)));

    await git(source, "init");
    await git(source, "-c", "core.autocrlf=false", "add", "--force", ".");
    await git(source, "-c", "user.name=Chronicle Test", "-c", "user.email=chronicle@example.invalid", "commit", "-m", "fixture");

    await git(parent, "-c", "core.autocrlf=true", "clone", source, checkout);

    for (const artifactPath of artifactPaths) {
      const checkedOutBytes = await readFile(path.join(checkout, ...artifactPath.split("/")));
      const expectedBytes = canonicalBytes.get(artifactPath);
      if (expectedBytes === undefined) throw new Error(`Missing source bytes for ${artifactPath}`);
      expect(checkedOutBytes.equals(expectedBytes)).toBe(true);
    }
    expect((await git(checkout, "check-attr", "text", "--", ...artifactPaths)).trim().split(/\r?\n/u)).toEqual(
      artifactPaths.map((artifactPath) => `${artifactPath}: text: unset`),
    );
  });
});
