import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileFromFile } from "json-schema-to-typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaDirectory = path.join(root, "schema", "v1");
const outputDirectory = path.join(root, "src", "schema", "generated");
const records = [
  ["project", "project.schema.json"],
  ["branch", "branch.schema.json"],
  ["milestone", "milestone.schema.json"],
  ["current", "current.schema.json"],
  ["roadmap", "roadmap.schema.json"],
  ["evidence", "evidence.schema.json"],
  ["engineering-event", "engineering-event.schema.json"],
  ["revision", "revision.schema.json"],
];

const mode = process.argv[2];
if (mode !== "--write" && mode !== "--check") {
  throw new Error("Usage: node scripts/schema-types.mjs --write|--check");
}

const normalize = (value) => value.replaceAll("\r\n", "\n");
const outputs = new Map();

for (const [name, schemaFile] of records) {
  const output = await compileFromFile(path.join(schemaDirectory, schemaFile), {
    additionalProperties: false,
    bannerComment: "/** Generated from schema/v1. Do not edit manually. */",
    cwd: schemaDirectory,
    format: true,
    style: {
      bracketSpacing: true,
      semi: true,
      singleQuote: false,
      tabWidth: 2,
      trailingComma: "all",
    },
  });
  outputs.set(`${name}.ts`, normalize(output));
}

outputs.set(
  "index.ts",
  `${[...outputs.keys()]
    .map((file) => `export * from "./${file.slice(0, -3)}";`)
    .join("\n")}\n`,
);

if (mode === "--write") {
  await mkdir(outputDirectory, { recursive: true });
  for (const [file, content] of outputs) {
    await writeFile(path.join(outputDirectory, file), content, "utf8");
  }
  console.log(`Generated ${outputs.size} schema type files.`);
} else {
  const stale = [];
  for (const [file, expected] of outputs) {
    try {
      const actual = normalize(await readFile(path.join(outputDirectory, file), "utf8"));
      if (actual !== expected) stale.push(file);
    } catch {
      stale.push(file);
    }
  }
  if (stale.length > 0) {
    console.error(`Generated schema types are stale: ${stale.join(", ")}`);
    console.error("Run npm run schema:generate and commit the results.");
    process.exitCode = 1;
  } else {
    console.log(`Schema type drift check passed (${outputs.size} files).`);
  }
}
