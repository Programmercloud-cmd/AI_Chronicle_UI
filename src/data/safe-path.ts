import { lstat, open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { FileHandle } from "node:fs/promises";

import type {
  ArtifactRead,
  ChronicleRoot,
  DataDiagnostic,
  DataResult,
} from "./types";

export interface DeclaredPath {
  locator: string;
  sourcePath: string;
}

export function asciiFold(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function diagnostic(
  code: DataDiagnostic["code"],
  sourcePath: string,
  message: string,
): DataResult<never> {
  return { ok: false, diagnostics: [{ code, sourcePath, message }] };
}

export function validatePortableRelativePath(
  locator: string,
  sourcePath = locator,
): DataResult<string[]> {
  if (locator.length === 0) {
    return diagnostic("path-invalid", sourcePath, "path must not be empty");
  }
  if (locator.includes("\0")) {
    return diagnostic("path-invalid", sourcePath, "path must not contain NUL bytes");
  }
  if (locator.includes("\\")) {
    return diagnostic(
      "path-invalid",
      sourcePath,
      "path must use forward-slash separators only",
    );
  }
  if (
    path.posix.isAbsolute(locator) ||
    path.win32.isAbsolute(locator) ||
    path.win32.parse(locator).root.length > 0
  ) {
    return diagnostic(
      "path-invalid",
      sourcePath,
      "path must be relative and must not be drive-qualified or UNC",
    );
  }

  const segments = locator.split("/");
  if (segments.some((segment) => segment.length === 0)) {
    return diagnostic(
      "path-invalid",
      sourcePath,
      "path must not contain empty segments or leading/trailing slashes",
    );
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return diagnostic(
      "path-invalid",
      sourcePath,
      "path must not contain dot or traversal segments",
    );
  }

  return { ok: true, value: segments };
}

export function findAsciiCaseCollisions(entries: DeclaredPath[]): DataDiagnostic[] {
  const firstByFolded = new Map<string, DeclaredPath>();
  const diagnostics: DataDiagnostic[] = [];

  for (const entry of [...entries].sort((left, right) =>
    left.locator < right.locator ? -1 : left.locator > right.locator ? 1 : 0,
  )) {
    const folded = asciiFold(entry.locator);
    const first = firstByFolded.get(folded);
    if (first === undefined) {
      firstByFolded.set(folded, entry);
    } else if (first.locator !== entry.locator) {
      diagnostics.push({
        code: "case-collision",
        sourcePath: entry.sourcePath,
        message: `path ${JSON.stringify(entry.locator)} collides by ASCII case with ${JSON.stringify(first.locator)} from ${first.sourcePath}`,
      });
    }
  }

  return diagnostics;
}

function isContainedFile(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export async function canonicalizeChronicleRoot(
  inputPath: string,
): Promise<DataResult<ChronicleRoot>> {
  try {
    const canonical = await realpath(inputPath);
    const metadata = await stat(canonical);
    if (!metadata.isDirectory()) {
      return diagnostic("root-invalid", inputPath, "Chronicle root is not a directory");
    }
    return { ok: true, value: { inputPath, realPath: canonical } };
  } catch (error) {
    return diagnostic(
      "root-invalid",
      inputPath,
      `cannot resolve Chronicle root: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Reads through one verified handle and rechecks the resolved path afterwards.
 * Node has no portable descriptor-relative RESOLVE_BENEATH equivalent, so a
 * malicious same-user process can still race realpath and open. This v1 local
 * boundary detects ordinary link replacement but is not a hostile-writer sandbox.
 */
export async function readContainedArtifact(
  root: ChronicleRoot,
  locator: string,
  sourcePath = locator,
): Promise<DataResult<ArtifactRead>> {
  const lexical = validatePortableRelativePath(locator, sourcePath);
  if (!lexical.ok) return lexical;

  const candidate = path.join(root.realPath, ...lexical.value);
  if (!isContainedFile(root.realPath, candidate)) {
    return diagnostic("path-escape", sourcePath, "artifact path escapes Chronicle root");
  }

  let before: string;
  try {
    before = await realpath(candidate);
  } catch (error) {
    return diagnostic(
      "read-failed",
      sourcePath,
      `cannot resolve artifact: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isContainedFile(root.realPath, before)) {
    return diagnostic(
      "path-escape",
      sourcePath,
      "artifact symlink or junction resolves outside Chronicle root",
    );
  }

  try {
    if (!(await stat(before)).isFile()) {
      return diagnostic("not-regular-file", sourcePath, "artifact is not a regular file");
    }
  } catch (error) {
    return diagnostic(
      "read-failed",
      sourcePath,
      `cannot inspect artifact: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let handle: FileHandle | undefined;
  try {
    handle = await open(candidate, "r");
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      return diagnostic("not-regular-file", sourcePath, "artifact is not a regular file");
    }

    const bytes = await handle.readFile();
    const after = await realpath(candidate);
    if (!isContainedFile(root.realPath, after)) {
      return diagnostic(
        "path-escape",
        sourcePath,
        "artifact path resolved outside Chronicle root after reading",
      );
    }
    if (after !== before) {
      return diagnostic(
        "path-changed",
        sourcePath,
        "artifact path changed while it was being read",
      );
    }

    return {
      ok: true,
      value: { locator, realPath: after, size: metadata.size, bytes },
    };
  } catch (error) {
    return diagnostic(
      "read-failed",
      sourcePath,
      `cannot read artifact: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    try {
      await handle?.close();
    } catch {
      // The read result or earlier stable diagnostic is authoritative here.
    }
  }
}

export async function isUnsafeAuthoritativeEntry(entryPath: string): Promise<boolean> {
  const metadata = await lstat(entryPath);
  return metadata.isSymbolicLink() || !metadata.isFile();
}
