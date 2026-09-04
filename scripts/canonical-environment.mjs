import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const canonicalImage =
  "mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e";
export const canonicalPlatform = "linux/amd64";
export const canonicalMarker = "playwright-1.62.1-noble-linux-amd64";
export const canonicalNodeModulesVolume = "project-chronicle-playwright-1-62-1-node-modules";
export const baselineUpdateMarker = "reviewed-canonical-update";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshotDirectory = "tests/visual/history/snapshots";

const innerCommands = Object.freeze({
  release: "npm ci && npm audit --omit=dev && npm run release:check:inner",
  visual: "npm ci && npm run test:visual:inner",
  "visual-update": "npm ci && npm run test:visual:inner -- --update-snapshots",
});

export function assertCanonicalEnvironment({ env = process.env, platform = process.platform, arch = process.arch } = {}) {
  if (
    env.CHRONICLE_CANONICAL_ENVIRONMENT !== canonicalMarker ||
    env.CHRONICLE_CANONICAL_IMAGE !== canonicalImage ||
    platform !== "linux" ||
    arch !== "x64" ||
    env.PLAYWRIGHT_BROWSERS_PATH !== "/ms-playwright"
  ) {
    throw new Error(
      "This inner command requires Chronicle's pinned Linux/amd64 Playwright container. " +
        "Run the corresponding public npm command instead.",
    );
  }
}

export function buildDockerArguments(mode, root = repositoryRoot) {
  const innerCommand = innerCommands[mode];
  if (innerCommand === undefined) throw new Error(`Unknown canonical command: ${mode}`);

  const args = [
    "run",
    "--rm",
    "--platform",
    canonicalPlatform,
    "--ipc=host",
    "--mount",
    `type=bind,source=${root},target=/work`,
    "--mount",
    `type=volume,source=${canonicalNodeModulesVolume},target=/work/node_modules`,
    "--workdir",
    "/work",
    "--env",
    `CHRONICLE_CANONICAL_ENVIRONMENT=${canonicalMarker}`,
    "--env",
    `CHRONICLE_CANONICAL_IMAGE=${canonicalImage}`,
  ];
  if (mode === "visual-update") {
    args.push("--env", `CHRONICLE_BASELINE_UPDATE=${baselineUpdateMarker}`);
  }
  args.push(
    canonicalImage,
    "bash",
    "-lc",
    `git config --global --add safe.directory /work && ${innerCommand}`,
  );
  return args;
}

export function assertBaselineUpdateAllowed(args, { env = process.env, root = repositoryRoot } = {}) {
  if (!args.includes("--confirm")) {
    throw new Error("Baseline updates require explicit confirmation: npm run test:visual:update -- --confirm");
  }
  if (env.CI || env.GITHUB_ACTIONS) {
    throw new Error("Canonical visual baselines cannot be updated in CI.");
  }

  const status = spawnSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all", "--", snapshotDirectory],
    { cwd: root, encoding: "utf8", shell: false },
  );
  if (status.error) throw status.error;
  if (status.status !== 0) throw new Error("Unable to verify that the visual snapshot directory is clean.");
  if (status.stdout.trim() !== "") {
    throw new Error("Refusing to overwrite a dirty visual snapshot directory. Review or restore its changes first.");
  }
}

export function assertVisualArgumentsAllowed(args, env = process.env) {
  const updatesSnapshots = args.some((argument) => argument.startsWith("--update-snapshots"));
  if (updatesSnapshots && env.CHRONICLE_BASELINE_UPDATE !== baselineUpdateMarker) {
    throw new Error("Use npm run test:visual:update -- --confirm to update canonical visual baselines.");
  }
}

function runDocker(mode) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", buildDockerArguments(mode), {
      cwd: repositoryRoot,
      stdio: "inherit",
      shell: false,
    });
    child.once("error", (error) => {
      reject(
        new Error(
          "Docker is required for Chronicle's canonical Linux visual checks. " +
            "Start Docker Desktop with Linux containers or use the canonical pull-request CI.",
          { cause: error },
        ),
      );
    });
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Canonical ${mode} command failed (${signal ?? code ?? "unknown exit"}).`));
    });
  });
}

async function main(args) {
  const [mode, ...modeArgs] = args;
  if (mode === "assert") {
    assertCanonicalEnvironment();
    return;
  }
  if (mode === "visual-update") assertBaselineUpdateAllowed(modeArgs);
  await runDocker(mode);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
