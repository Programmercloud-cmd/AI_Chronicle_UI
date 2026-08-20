import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalizeChronicleRoot,
  findAsciiCaseCollisions,
  readContainedArtifact,
  validatePortableRelativePath,
} from "../../src/data";

const temporaryRoots: string[] = [];

async function temporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), `chronicle-${label}-`));
  temporaryRoots.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("portable path syntax", () => {
  it("accepts a nested POSIX relative path", () => {
    expect(validatePortableRelativePath("evidence/reports/result.txt")).toEqual({
      ok: true,
      value: ["evidence", "reports", "result.txt"],
    });
  });

  it.each([
    "",
    "/absolute.txt",
    "C:/absolute.txt",
    "C:drive-relative.txt",
    "//server/share/file.txt",
    "\\\\server\\share\\file.txt",
    "folder\\file.txt",
    "./file.txt",
    "folder/../file.txt",
    "folder/./file.txt",
    "folder//file.txt",
    "folder/",
    "nul\0byte.txt",
  ])("rejects unsafe locator %j", (locator) => {
    const result = validatePortableRelativePath(locator, "evidence.yaml");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]).toMatchObject({
      code: "path-invalid",
      sourcePath: "evidence.yaml",
    });
  });

  it("reports ASCII case collisions while allowing exact reuse", () => {
    const diagnostics = findAsciiCaseCollisions([
      { locator: "reports/Result.txt", sourcePath: "EVD-0001.yaml" },
      { locator: "reports/result.txt", sourcePath: "EVD-0002.yaml" },
      { locator: "reports/Result.txt", sourcePath: "EVD-0003.yaml" },
    ]);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "case-collision",
      sourcePath: "EVD-0002.yaml",
    });
  });
});

describe("contained artifact reads", () => {
  it("reads a contained regular file through one verified handle", async () => {
    const rootPath = await temporaryDirectory("artifact");
    await mkdir(path.join(rootPath, "evidence", "reports"), { recursive: true });
    await writeFile(path.join(rootPath, "evidence", "reports", "result.txt"), "pass");
    const root = await canonicalizeChronicleRoot(rootPath);
    expect(root.ok).toBe(true);
    if (!root.ok) return;

    const result = await readContainedArtifact(
      root.value,
      "evidence/reports/result.txt",
      "evidence/records/EVD-0001.yaml",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.bytes.toString("utf8")).toBe("pass");
    expect(result.value.size).toBe(4);
  });

  it("rejects a directory as a non-regular artifact", async () => {
    const rootPath = await temporaryDirectory("directory");
    await mkdir(path.join(rootPath, "artifact"));
    const root = await canonicalizeChronicleRoot(rootPath);
    if (!root.ok) throw new Error("test root did not canonicalize");

    const result = await readContainedArtifact(root.value, "artifact");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe("not-regular-file");
  });

  it("rejects an out-of-root symlink or junction", async (context) => {
    const container = await temporaryDirectory("escape");
    const rootPath = path.join(container, "root");
    const outside = path.join(container, "outside");
    await mkdir(rootPath);
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "secret");

    try {
      await symlink(outside, path.join(rootPath, "escape"),
        process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip();
        return;
      }
      throw error;
    }

    const root = await canonicalizeChronicleRoot(rootPath);
    if (!root.ok) throw new Error("test root did not canonicalize");
    const result = await readContainedArtifact(root.value, "escape/secret.txt");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe("path-escape");
  });

  it("allows an in-root symlink or junction to a regular file", async (context) => {
    const rootPath = await temporaryDirectory("inside-link");
    const target = path.join(rootPath, "target");
    await mkdir(target);
    await writeFile(path.join(target, "result.txt"), "inside");

    try {
      await symlink(target, path.join(rootPath, "link"),
        process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip();
        return;
      }
      throw error;
    }

    const root = await canonicalizeChronicleRoot(rootPath);
    if (!root.ok) throw new Error("test root did not canonicalize");
    const result = await readContainedArtifact(root.value, "link/result.txt");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.bytes.toString()).toBe("inside");
  });

  it("rejects a missing or broken symlink target", async (context) => {
    const rootPath = await temporaryDirectory("broken-link");
    const linked = path.join(rootPath, "broken");

    try {
      await symlink(
        path.join(rootPath, "missing-target"),
        linked,
        process.platform === "win32" ? "file" : "file",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip();
        return;
      }
      throw error;
    }

    const root = await canonicalizeChronicleRoot(rootPath);
    if (!root.ok) throw new Error("test root did not canonicalize");
    const result = await readContainedArtifact(root.value, "broken");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe("read-failed");
  });

  it("accepts a Chronicle root presented through a symlink or junction", async (context) => {
    const container = await temporaryDirectory("root-link");
    const target = path.join(container, "target");
    const linked = path.join(container, "linked");
    await mkdir(target);

    try {
      await symlink(target, linked, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip();
        return;
      }
      throw error;
    }

    const result = await canonicalizeChronicleRoot(linked);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.realPath).toBe(await canonicalizeChronicleRoot(target).then((item) =>
      item.ok ? item.value.realPath : ""));
  });
});
