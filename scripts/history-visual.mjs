import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vite = await createServer({
  configFile: path.join(repositoryRoot, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});

function runVisualSuite() {
  return new Promise((resolve, reject) => {
    const cli = path.join(repositoryRoot, "node_modules", "@playwright", "test", "cli.js");
    const config = path.join(repositoryRoot, "tests", "visual", "history", "playwright.config.ts");
    const child = spawn(process.execPath, [cli, "test", "--config", config, "--reporter=line"], {
      cwd: repositoryRoot,
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`History visual suite failed (${code})`));
    });
  });
}

try {
  await vite.listen();
  await runVisualSuite();
} finally {
  await vite.close();
}
