import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "chronicle-package-smoke-"));
const packDirectory = path.join(temporaryRoot, "pack");
const consumerDirectory = path.join(temporaryRoot, "consumer");
const cacheDirectory = path.join(temporaryRoot, "npm-cache");
const globalPrefix = path.join(temporaryRoot, "global");
await mkdir(packDirectory);
await mkdir(consumerDirectory);
await mkdir(cacheDirectory);
await mkdir(globalPrefix);

function run(command, args, cwd = repositoryRoot) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: false });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function runAsync(command, args, cwd = repositoryRoot, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed (${code})`));
    });
  });
}

function npm(args, cwd = repositoryRoot) {
  const cachedArgs = [...args, "--cache", cacheDirectory];
  return process.platform === "win32"
    ? run("cmd.exe", ["/d", "/s", "/c", "npm.cmd", ...cachedArgs], cwd)
    : run("npm", cachedArgs, cwd);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stage(message) {
  process.stdout.write(`[package-smoke] ${message}\n`);
}

let server;
async function startInstalledServer(bin, dataset) {
  const child = spawn(process.execPath, [bin, "serve", dataset, "--port", "0"], {
    cwd: consumerDirectory,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  let output = "";
  let errorOutput = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { errorOutput += chunk; });
  const origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`installed server did not start\n${output}\n${errorOutput}`)), 20_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = /Chronicle listening on (http:\/\/127\.0\.0\.1:\d+)/u.exec(output);
      if (match !== null) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`installed server exited before listening (${code})\n${output}\n${errorOutput}`));
    });
  });
  return { child, origin };
}

async function stopInstalledServer() {
  if (server === undefined || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    server.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
  server = undefined;
}

try {
  const maintainedGuide = await readFile(path.join(repositoryRoot, "templates", "chronicle", "AGENTS.md"));
  const repositoryGuide = await readFile(path.join(repositoryRoot, "chronicle", "AGENTS.md"));
  assert(repositoryGuide.equals(maintainedGuide), "chronicle/AGENTS.md is out of sync with its maintained template");

  stage("packing repository");
  const packed = JSON.parse(npm(["pack", "--json", "--pack-destination", packDirectory]));
  const metadata = packed[0];
  assert(metadata !== undefined, "npm pack returned no package metadata");
  const files = metadata.files.map((entry) => entry.path);
  for (const required of [
    "dist/src/cli/bin.js",
    "dist/src/server/static-web.js",
    "dist/schema/v1/project.schema.json",
    "dist/web/index.html",
    "templates/chronicle/AGENTS.md",
    "templates/chronicle/.gitattributes",
    "docs/schema/v1-public-contract.md",
    "docs/usability/orientation-study.md",
    "README.md",
    "package.json",
  ]) assert(files.includes(required), `package is missing ${required}`);
  const forbidden = files.filter((file) =>
    /^(?:src|tests|examples|scripts|test-results|dev|chronicle)\//u.test(file) ||
    (file.startsWith("docs/") && ![
      "docs/schema/v1-public-contract.md",
      "docs/usability/orientation-study.md",
    ].includes(file)));
  assert(forbidden.length === 0, `package contains forbidden files: ${forbidden.join(", ")}`);
  assert(!files.some((file) => file.startsWith("dist/tests/")), "package contains compiled tests");
  run("git", ["check-ignore", "--quiet", "--no-index", `project-chronicle-${metadata.version}.tgz`]);

  const tarball = path.join(packDirectory, metadata.filename);
  await writeFile(path.join(consumerDirectory, "package.json"), JSON.stringify({ name: "chronicle-smoke-consumer", private: true }));
  stage("installing production package in unrelated consumer");
  npm(["install", tarball, "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], consumerDirectory);
  assert(!existsSync(path.join(consumerDirectory, "node_modules", "vitest")), "clean install contains a Chronicle dev dependency");
  const bin = path.join(consumerDirectory, "node_modules", "project-chronicle", "dist", "src", "cli", "bin.js");
  const initialized = path.join(temporaryRoot, "initialized");
  stage("initializing and validating through clean local install");
  run(process.execPath, [bin, "init", initialized], consumerDirectory);
  const installedTemplate = await readFile(path.join(consumerDirectory, "node_modules", "project-chronicle", "templates", "chronicle", "AGENTS.md"));
  const installedAttributesTemplate = await readFile(path.join(consumerDirectory, "node_modules", "project-chronicle", "templates", "chronicle", ".gitattributes"));
  const initializedGuide = await readFile(path.join(initialized, "AGENTS.md"));
  const initializedAttributes = await readFile(path.join(initialized, ".gitattributes"));
  assert(initializedGuide.equals(installedTemplate), "installed CLI did not copy its packaged AGENTS.md template byte-for-byte");
  assert(initializedAttributes.equals(installedAttributesTemplate), "installed CLI did not copy its packaged .gitattributes template byte-for-byte");
  const validation = run(process.execPath, [bin, "validate", initialized], consumerDirectory);
  assert(validation.includes('"valid": true'), "installed CLI did not validate its initialized dataset");

  stage("installing package into isolated global prefix");
  npm(["install", "--global", "--prefix", globalPrefix, tarball, "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], consumerDirectory);
  const globalBin = process.platform === "win32"
    ? path.join(globalPrefix, "chronicle.cmd")
    : path.join(globalPrefix, "bin", "chronicle");
  const globalInitialized = path.join(temporaryRoot, "global-initialized");
  stage("initializing through globally installed command");
  if (process.platform === "win32") run("cmd.exe", ["/d", "/s", "/c", globalBin, "init", globalInitialized], consumerDirectory);
  else run(globalBin, ["init", globalInitialized], consumerDirectory);
  const globalGuide = await readFile(path.join(globalInitialized, "AGENTS.md"));
  const globalAttributes = await readFile(path.join(globalInitialized, ".gitattributes"));
  assert(globalGuide.equals(installedTemplate), "globally installed CLI did not copy its packaged AGENTS.md template byte-for-byte");
  assert(globalAttributes.equals(installedAttributesTemplate), "globally installed CLI did not copy its packaged .gitattributes template byte-for-byte");

  const canonicalValidation = run(process.execPath, [bin, "validate", path.join(repositoryRoot, "examples", "canonical")], consumerDirectory);
  assert(canonicalValidation.includes('"valid": true'), "installed CLI did not validate canonical data");

  stage("running packaged canonical HTTP and browser checks");
  const canonicalServer = await startInstalledServer(bin, path.join(repositoryRoot, "examples", "canonical"));
  server = canonicalServer.child;
  const origin = canonicalServer.origin;

  const index = await fetch(`${origin}/`);
  assert(index.status === 200, "installed app root did not respond");
  const indexText = await index.text();
  const assetPath = /(?:src|href)="(\/assets\/[^"]+)"/u.exec(indexText)?.[1];
  assert(assetPath !== undefined, "installed app index does not reference a built asset");
  const asset = await fetch(`${origin}${assetPath}`);
  assert(asset.status === 200, "installed app asset did not respond");
  for (const route of ["/history", "/roadmap", "/milestones/TIM-002"]) {
    const response = await fetch(`${origin}${route}`);
    assert(response.status === 200 && (await response.text()).includes("Project Chronicle"), `deep link ${route} did not return the SPA`);
  }
  const snapshotResponse = await fetch(`${origin}/api/snapshot`);
  const snapshotText = await snapshotResponse.text();
  assert(snapshotResponse.status === 200 && !snapshotText.includes(repositoryRoot), "snapshot failed or exposed the repository root");
  assert((await fetch(`${origin}/api/evidence/EVD-0001/preview`)).status === 200, "evidence preview failed");
  assert((await fetch(`${origin}/api/evidence/EVD-0001/raw`)).status === 200, "evidence raw download failed");
  const unknownApi = await fetch(`${origin}/api/not-a-route`);
  assert(unknownApi.status === 404 && (unknownApi.headers.get("content-type") ?? "").includes("application/json"), "unknown API route fell through to SPA");
  for (const reservedRoot of ["/api", "/api?probe=1", "/assets", "/assets?probe=1"]) {
    const response = await fetch(`${origin}${reservedRoot}`);
    assert(response.status === 404 && (response.headers.get("content-type") ?? "").includes("application/json"), `${reservedRoot} fell through to SPA`);
  }

  const playwrightCli = path.join(repositoryRoot, "node_modules", "@playwright", "test", "cli.js");
  const browserConfig = path.join(repositoryRoot, "tests", "integration", "release", "playwright.config.ts");
  await runAsync(process.execPath, [playwrightCli, "test", "--config", browserConfig, "--reporter=line"], repositoryRoot, {
    ...process.env,
    CHRONICLE_RELEASE_ORIGIN: origin,
    CHRONICLE_RELEASE_FIXTURE: "canonical",
  });

  await stopInstalledServer();
  stage("running packaged difficult browser checks");
  const difficultServer = await startInstalledServer(bin, path.join(repositoryRoot, "examples", "difficult"));
  server = difficultServer.child;
  await runAsync(process.execPath, [playwrightCli, "test", "--config", browserConfig, "--reporter=line"], repositoryRoot, {
    ...process.env,
    CHRONICLE_RELEASE_ORIGIN: difficultServer.origin,
    CHRONICLE_RELEASE_FIXTURE: "difficult",
  });

  process.stdout.write(`${JSON.stringify({
    package: { entries: metadata.entryCount, packedBytes: metadata.size, unpackedBytes: metadata.unpackedSize },
    install: ["production-only", "global"],
    cli: ["init-with-sidecars", "global-init-with-sidecars", "validate-initialized", "validate-canonical"],
    origin,
    http: ["/", "/history", "/roadmap", "/milestones/TIM-002", assetPath, "/api/snapshot", "/api/evidence/EVD-0001/preview", "/api/evidence/EVD-0001/raw"],
    browser: ["canonical:PASS", "difficult:PASS"],
  }, null, 2)}\n`);
} finally {
  await stopInstalledServer();
  await rm(temporaryRoot, { recursive: true, force: true });
}
