import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertPackageFiles } from "./package-policy.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stableVersionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

export function assertReleaseTag(tag, version) {
  if (!stableVersionPattern.test(version)) {
    throw new Error(`package.json version must be a stable semantic version; received ${JSON.stringify(version)}`);
  }

  const expectedTag = `v${version}`;
  if (tag !== expectedTag) {
    throw new Error(`release tag/version mismatch: tag ${JSON.stringify(tag)}, package.json version ${JSON.stringify(version)}; expected tag ${expectedTag}`);
  }
}

async function readPackage(repository) {
  return JSON.parse(await readFile(path.join(repository, "package.json"), "utf8"));
}

function runNpmPack(repository, outputDirectory) {
  const packArguments = ["pack", "--json", "--pack-destination", outputDirectory];
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const arguments_ = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd", ...packArguments]
    : packArguments;
  const result = spawnSync(command, arguments_, {
    cwd: repository,
    encoding: "utf8",
    shell: false,
  });

  if (result.status !== 0) {
    throw new Error(`npm pack failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  }

  let packed;
  try {
    packed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`npm pack did not return valid JSON: ${error.message}`);
  }

  if (!Array.isArray(packed) || packed.length !== 1) {
    throw new Error(`npm pack returned ${Array.isArray(packed) ? packed.length : "invalid"} package records; expected exactly one`);
  }
  return packed[0];
}

async function sha256(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const input = createReadStream(file);
    input.on("data", (chunk) => hash.update(chunk));
    input.once("error", reject);
    input.once("end", resolve);
  });
  return hash.digest("hex");
}

export async function validateReleaseTag(tag, repository = repositoryRoot) {
  const packageJson = await readPackage(repository);
  assertReleaseTag(tag, packageJson.version);
  return packageJson;
}

export async function prepareReleaseArtifacts(tag, outputDirectory, repository = repositoryRoot) {
  const packageJson = await validateReleaseTag(tag, repository);
  const absoluteOutputDirectory = path.resolve(repository, outputDirectory);
  await mkdir(absoluteOutputDirectory);

  const metadata = runNpmPack(repository, absoluteOutputDirectory);
  if (metadata.version !== packageJson.version) {
    throw new Error(`npm pack version ${JSON.stringify(metadata.version)} does not match package.json version ${JSON.stringify(packageJson.version)}`);
  }
  if (typeof metadata.filename !== "string" || path.basename(metadata.filename) !== metadata.filename || !metadata.filename.endsWith(".tgz")) {
    throw new Error(`npm pack returned an unsafe or invalid filename: ${JSON.stringify(metadata.filename)}`);
  }
  if (!Array.isArray(metadata.files)) {
    throw new Error("npm pack returned no package file manifest");
  }
  assertPackageFiles(metadata.files);

  const tarball = path.join(absoluteOutputDirectory, metadata.filename);
  const digest = await sha256(tarball);
  await writeFile(
    path.join(absoluteOutputDirectory, "SHA256SUMS.txt"),
    `${digest}  ${metadata.filename}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  await writeFile(
    path.join(absoluteOutputDirectory, "RELEASE_NOTES.md"),
    [
      "## Installation",
      "",
      "Download both release assets, optionally verify `SHA256SUMS.txt`, then install Chronicle:",
      "",
      "```bash",
      `npm install -g ${metadata.filename}`,
      "```",
      "",
      "Use Chronicle with a project dataset:",
      "",
      "```bash",
      "chronicle validate ./chronicle",
      "chronicle serve ./chronicle",
      "```",
      "",
    ].join("\n"),
    { encoding: "utf8", flag: "wx" },
  );

  return path.relative(repository, tarball);
}

async function main() {
  const [command, tag, outputDirectory] = process.argv.slice(2);
  if (command === "validate" && tag !== undefined && outputDirectory === undefined) {
    await validateReleaseTag(tag);
    process.stdout.write(`Validated ${tag} against package.json\n`);
    return;
  }
  if (command === "prepare" && tag !== undefined && outputDirectory !== undefined) {
    const tarball = await prepareReleaseArtifacts(tag, outputDirectory);
    process.stdout.write(`${tarball}\n`);
    return;
  }
  throw new Error("usage: node scripts/release-artifacts.mjs validate <tag> | prepare <tag> <output-directory>");
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`release preparation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
