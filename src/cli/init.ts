import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const directories = [
  "branches", "milestones", "engineering-events", "revisions", "evidence/records",
  "evidence/artifacts/diffs", "evidence/artifacts/logs", "evidence/artifacts/reports", "evidence/artifacts/screenshots",
];

async function readDatasetTemplate(name: string, description: string): Promise<Buffer> {
  const candidates = [
    path.resolve(__dirname, `../../templates/chronicle/${name}`),
    path.resolve(__dirname, `../../../templates/chronicle/${name}`),
  ];

  for (const candidate of candidates) {
    try {
      return await readFile(candidate);
    } catch (error) {
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }
  throw new Error(`Chronicle ${description} is missing from this installation`);
}

function projectId(rootPath: string): string {
  const candidate = path.basename(path.resolve(rootPath)).toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  return candidate.length > 0 ? candidate : "chronicle-project";
}

export async function initializeChronicle(rootPath: string, now = new Date()): Promise<void> {
  const resolved = path.resolve(rootPath);
  const [agentGuide, gitAttributes] = await Promise.all([
    readDatasetTemplate("AGENTS.md", "agent-authoring guide"),
    readDatasetTemplate(".gitattributes", "Git attributes template"),
  ]);
  let created = false;
  try {
    await mkdir(resolved);
    created = true;
    for (const directory of directories) await mkdir(path.join(resolved, ...directory.split("/")), { recursive: true });
    await writeFile(path.join(resolved, "AGENTS.md"), agentGuide, { flag: "wx" });
    await writeFile(path.join(resolved, ".gitattributes"), gitAttributes, { flag: "wx" });
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
