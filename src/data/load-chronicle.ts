import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";

import {
  type ChronicleRecordByKind,
  type ChronicleRecordKind,
  validateRecordShape,
} from "../schema";
import { fromStructuralDiagnostic, sortDiagnostics } from "./diagnostics";
import { parseChronicleYaml } from "./parse-yaml";
import {
  asciiFold,
  canonicalizeChronicleRoot,
  findAsciiCaseCollisions,
  validatePortableRelativePath,
} from "./safe-path";
import type {
  ChronicleRoot,
  ChronicleSnapshot,
  DataDiagnostic,
  DataResult,
  SourcedRecord,
} from "./types";

const rootEntries = new Set([
  ".gitattributes",
  "AGENTS.md",
  "project.yaml",
  "current.yaml",
  "roadmap.yaml",
  "branches",
  "milestones",
  "engineering-events",
  "revisions",
  "evidence",
]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function readAuthoritativeText(
  root: ChronicleRoot,
  sourcePath: string,
  required: boolean,
): Promise<DataResult<string | undefined>> {
  const absolutePath = path.join(root.realPath, ...sourcePath.split("/"));

  try {
    const entry = await lstat(absolutePath);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      return {
        ok: false,
        diagnostics: [
          {
            code: "unsafe-entry",
            sourcePath,
            message: "authoritative YAML entry must be a non-symlink regular file",
          },
        ],
      };
    }

    const handle = await open(absolutePath, "r");
    try {
      const opened = await handle.stat();
      if (!opened.isFile()) {
        return {
          ok: false,
          diagnostics: [
            {
              code: "unsafe-entry",
              sourcePath,
              message: "opened authoritative YAML entry is not a regular file",
            },
          ],
        };
      }
      return { ok: true, value: await handle.readFile("utf8") };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!required && isMissing(error)) return { ok: true, value: undefined };
    return {
      ok: false,
      diagnostics: [
        {
          code: required && isMissing(error) ? "missing-required" : "read-failed",
          sourcePath,
          message: isMissing(error)
            ? "required YAML entry is missing"
            : `cannot read YAML entry: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}

async function loadSingleRecord<K extends ChronicleRecordKind>(
  root: ChronicleRoot,
  sourcePath: string,
  kind: K,
  required: boolean,
): Promise<DataResult<SourcedRecord<ChronicleRecordByKind[K]> | undefined>> {
  const text = await readAuthoritativeText(root, sourcePath, required);
  if (!text.ok) return text;
  if (text.value === undefined) return { ok: true, value: undefined };

  const parsed = parseChronicleYaml(text.value, sourcePath);
  if (!parsed.ok) return parsed;

  const shape = validateRecordShape(kind, parsed.value, { sourcePath });
  if (!shape.ok) {
    return {
      ok: false,
      diagnostics: shape.diagnostics.map(fromStructuralDiagnostic),
    };
  }

  return { ok: true, value: { sourcePath, value: shape.value } };
}

async function requireAuthoritativeDirectory(
  root: ChronicleRoot,
  sourcePath: string,
  required: boolean,
): Promise<DataResult<string | undefined>> {
  const segments = sourcePath.split("/");
  let current = root.realPath;

  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        return {
          ok: false,
          diagnostics: [
            {
              code: "unsafe-entry",
              sourcePath,
              message: "authoritative record directory must be a non-symlink directory",
            },
          ],
        };
      }
    } catch (error) {
      if (!required && isMissing(error)) return { ok: true, value: undefined };
      return {
        ok: false,
        diagnostics: [
          {
            code: required && isMissing(error) ? "missing-required" : "read-failed",
            sourcePath,
            message: isMissing(error)
              ? "required record directory is missing"
              : `cannot inspect record directory: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  return { ok: true, value: current };
}

async function loadRecordDirectory<K extends ChronicleRecordKind>(
  root: ChronicleRoot,
  directory: string,
  kind: K,
  required: boolean,
): Promise<{
  records: SourcedRecord<ChronicleRecordByKind[K]>[];
  diagnostics: DataDiagnostic[];
}> {
  const resolved = await requireAuthoritativeDirectory(root, directory, required);
  if (!resolved.ok) return { records: [], diagnostics: resolved.diagnostics };
  if (resolved.value === undefined) return { records: [], diagnostics: [] };

  let entries;
  try {
    entries = await readdir(resolved.value, { withFileTypes: true });
  } catch (error) {
    return {
      records: [],
      diagnostics: [
        {
          code: "read-failed",
          sourcePath: directory,
          message: `cannot enumerate record directory: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  entries.sort((left, right) => compareText(left.name, right.name));
  const diagnostics = findAsciiCaseCollisions(
    entries.map((entry) => ({
      locator: entry.name,
      sourcePath: `${directory}/${entry.name}`,
    })),
  );
  const records: SourcedRecord<ChronicleRecordByKind[K]>[] = [];

  for (const entry of entries) {
    const sourcePath = `${directory}/${entry.name}`;
    if (!entry.isFile() || entry.isSymbolicLink()) {
      diagnostics.push({
        code: "unexpected-entry",
        sourcePath,
        message: "record directories may contain non-symlink .yaml files only",
      });
      continue;
    }
    if (!entry.name.endsWith(".yaml")) {
      diagnostics.push({
        code: "unexpected-entry",
        sourcePath,
        message: "record file extension must be .yaml",
      });
      continue;
    }

    const loaded = await loadSingleRecord(root, sourcePath, kind, true);
    if (!loaded.ok) {
      diagnostics.push(...loaded.diagnostics);
      continue;
    }
    if (loaded.value === undefined) continue;

    const value = loaded.value.value as ChronicleRecordByKind[K] & { id?: unknown };
    const expectedFilename = `${String(value.id)}.yaml`;
    if (entry.name !== expectedFilename) {
      diagnostics.push({
        code: "filename-id-mismatch",
        sourcePath,
        recordKind: kind,
        ...(typeof value.id === "string" ? { recordId: value.id } : {}),
        message: `record filename must be exactly ${JSON.stringify(expectedFilename)}`,
      });
      continue;
    }

    records.push(loaded.value);
  }

  return { records, diagnostics };
}

async function inspectRootEntries(root: ChronicleRoot): Promise<DataDiagnostic[]> {
  try {
    const entries = await readdir(root.realPath, { withFileTypes: true });
    const diagnostics = findAsciiCaseCollisions(
      entries.map((entry) => ({ locator: entry.name, sourcePath: entry.name })),
    );
    for (const entry of entries) {
      if (!rootEntries.has(entry.name)) {
        diagnostics.push({
          code: "unexpected-entry",
          sourcePath: entry.name,
          message: "unexpected entry at Chronicle root",
        });
      }
    }
    return diagnostics;
  } catch (error) {
    return [
      {
        code: "read-failed",
        sourcePath: ".",
        message: `cannot enumerate Chronicle root: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }
}

function validateDeclaredEvidencePaths(
  evidence: SourcedRecord<ChronicleRecordByKind["evidence"]>[],
): DataDiagnostic[] {
  const diagnostics: DataDiagnostic[] = [];
  const artifactPaths: { locator: string; sourcePath: string }[] = [];

  for (const record of evidence) {
    const source = record.value.source;
    if (source.kind !== "artifact" && source.kind !== "repository_ref") continue;

    const lexical = validatePortableRelativePath(source.path, record.sourcePath);
    if (!lexical.ok) diagnostics.push(...lexical.diagnostics);
    if (source.kind === "artifact") {
      artifactPaths.push({ locator: source.path, sourcePath: record.sourcePath });
    }
  }

  diagnostics.push(...findAsciiCaseCollisions(artifactPaths));
  return diagnostics;
}

export async function loadChronicle(rootPath: string): Promise<DataResult<ChronicleSnapshot>> {
  const rootResult = await canonicalizeChronicleRoot(rootPath);
  if (!rootResult.ok) return rootResult;
  const root = rootResult.value;

  const diagnostics = await inspectRootEntries(root);
  const [project, current, roadmap, branches, milestones, engineeringEvents, revisions, evidence] =
    await Promise.all([
      loadSingleRecord(root, "project.yaml", "project", true),
      loadSingleRecord(root, "current.yaml", "current", false),
      loadSingleRecord(root, "roadmap.yaml", "roadmap", true),
      loadRecordDirectory(root, "branches", "branch", true),
      loadRecordDirectory(root, "milestones", "milestone", true),
      loadRecordDirectory(root, "engineering-events", "engineering-event", true),
      loadRecordDirectory(root, "revisions", "revision", false),
      loadRecordDirectory(root, "evidence/records", "evidence", true),
    ]);

  for (const result of [project, current, roadmap]) {
    if (!result.ok) diagnostics.push(...result.diagnostics);
  }
  diagnostics.push(
    ...branches.diagnostics,
    ...milestones.diagnostics,
    ...engineeringEvents.diagnostics,
    ...revisions.diagnostics,
    ...evidence.diagnostics,
    ...validateDeclaredEvidencePaths(evidence.records),
  );

  if (diagnostics.length > 0 || !project.ok || !roadmap.ok) {
    return { ok: false, diagnostics: sortDiagnostics(diagnostics) };
  }
  if (project.value === undefined || roadmap.value === undefined) {
    return {
      ok: false,
      diagnostics: sortDiagnostics([
        {
          code: "missing-required",
          sourcePath: project.value === undefined ? "project.yaml" : "roadmap.yaml",
          message: "required YAML entry is missing",
        },
      ]),
    };
  }

  return {
    ok: true,
    value: {
      rootPath: root.realPath,
      project: project.value,
      ...(current.ok && current.value !== undefined ? { current: current.value } : {}),
      roadmap: roadmap.value,
      branches: branches.records,
      milestones: milestones.records,
      engineeringEvents: engineeringEvents.records,
      revisions: revisions.records,
      evidence: evidence.records,
    },
  };
}
