import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const directories = [
  "branches", "milestones", "engineering-events", "revisions", "evidence/records",
  "evidence/artifacts/diffs", "evidence/artifacts/logs", "evidence/artifacts/reports", "evidence/artifacts/screenshots",
];

function projectId(rootPath: string): string {
  const candidate = path.basename(path.resolve(rootPath)).toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  return candidate.length > 0 ? candidate : "chronicle-project";
}

export async function initializeChronicle(rootPath: string, now = new Date()): Promise<void> {
  const resolved = path.resolve(rootPath);
  let created = false;
  try {
    await mkdir(resolved);
    created = true;
    for (const directory of directories) await mkdir(path.join(resolved, ...directory.split("/")), { recursive: true });
    const id = projectId(resolved);
    const title = path.basename(resolved).replace(/[\u0000-\u001f\u007f]+/gu, " ").trim() || "Chronicle Project";
    await writeFile(path.join(resolved, "project.yaml"), [
      "schema_version: 1", "project:", `  id: ${JSON.stringify(id)}`, `  title: ${JSON.stringify(title)}`,
      "display:", '  timezone: "UTC"', "",
    ].join("\n"), { encoding: "utf8", flag: "wx" });
    await writeFile(path.join(resolved, "roadmap.yaml"), [
      "schema_version: 1", `updated_at: ${JSON.stringify(now.toISOString().replace(".000Z", "Z"))}`, "items: []", "",
    ].join("\n"), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (created) await rm(resolved, { recursive: true, force: true });
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
      throw new Error(`refusing to overwrite existing path: ${resolved}`);
    }
    throw error;
  }
}
