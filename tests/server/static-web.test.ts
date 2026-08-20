import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  APPLICATION_CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY,
  createChronicleServer,
  resolveDefaultWebRoot,
} from "../../src/server";

const roots: string[] = [];

async function webRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "chronicle-web-"));
  roots.push(root);
  await mkdir(path.join(root, "assets"));
  await writeFile(path.join(root, "index.html"), "<!doctype html><title>Chronicle app</title><main>APP_SHELL</main>");
  await writeFile(path.join(root, "assets", "app-123.js"), "globalThis.CHRONICLE_ASSET = true;");
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("packaged web server boundary", () => {
  it("resolves compiled and source module layouts without consulting cwd", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chronicle-module-layout-"));
    roots.push(root);
    const compiledModule = path.join(root, "dist", "src", "server");
    const sourceModule = path.join(root, "src", "server");
    const builtWeb = path.join(root, "dist", "web");
    await mkdir(compiledModule, { recursive: true });
    await mkdir(sourceModule, { recursive: true });
    await mkdir(builtWeb, { recursive: true });
    await writeFile(path.join(builtWeb, "index.html"), "<!doctype html><title>built</title>");

    expect(resolveDefaultWebRoot(compiledModule)).toBe(builtWeb);
    expect(resolveDefaultWebRoot(sourceModule)).toBe(builtWeb);

    const missingModule = path.join(root, "missing", "src", "server");
    expect(() => resolveDefaultWebRoot(missingModule)).toThrow("Chronicle web assets are unavailable");
    try {
      resolveDefaultWebRoot(missingModule);
    } catch (error) {
      expect(String(error)).not.toContain(root);
    }
  });

  it("serves real assets and extensionless SPA deep links without swallowing API 404s", async () => {
    const root = await webRoot();
    const server = createChronicleServer(path.resolve("examples/canonical"), { webRoot: root });

    for (const url of ["/", "/history", "/roadmap", "/milestones/TIM-002"]) {
      const response = await server.inject({ method: "GET", url });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("APP_SHELL");
      expect(response.headers["content-security-policy"]).toBe(APPLICATION_CONTENT_SECURITY_POLICY);
      expect(response.headers["content-security-policy"]).not.toContain("unsafe-inline");
      expect(response.headers["content-security-policy"]).not.toContain("sandbox");
    }

    const head = await server.inject({ method: "HEAD", url: "/milestones/TIM-002" });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe("");
    const asset = await server.inject({ method: "GET", url: "/assets/app-123.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("javascript");
    expect(asset.body).toContain("CHRONICLE_ASSET");

    for (const url of [
      "/assets",
      "/assets?probe=1",
      "/assets/missing.js",
      "/api",
      "/api?probe=1",
      "/api/missing",
      "/missing.txt",
    ]) {
      const response = await server.inject({ method: "GET", url });
      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.body).not.toContain("APP_SHELL");
      if (url.startsWith("/api")) expect(response.headers["content-security-policy"]).toBe(CONTENT_SECURITY_POLICY);
    }
    await server.close();
  });

  it("keeps API and evidence responses under the restrictive CSP", async () => {
    const root = await webRoot();
    const server = createChronicleServer(path.resolve("examples/canonical"), { webRoot: root });
    for (const url of ["/api/snapshot", "/api/evidence/EVD-0001/preview"]) {
      const response = await server.inject({ method: "GET", url });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-security-policy"]).toBe(CONTENT_SECURITY_POLICY);
      expect(response.headers["content-security-policy"]).toContain("script-src 'none'");
      expect(response.headers["content-security-policy"]).toContain("sandbox");
    }
    await server.close();
  });

  it("rejects traversal-like asset requests and invalid web roots without path disclosure", async () => {
    const root = await webRoot();
    const server = createChronicleServer(path.resolve("examples/canonical"), { webRoot: root });
    for (const url of ["/assets/%2e%2e/package.json", "/assets/..%2fpackage.json", "/assets/%2e%2e%5cpackage.json"]) {
      const response = await server.inject({ method: "GET", url });
      expect(response.statusCode).not.toBe(200);
      expect(response.body).not.toContain("project-chronicle");
    }
    await server.close();

    const missing = path.join(root, "private", "missing");
    expect(() => createChronicleServer(path.resolve("examples/canonical"), { webRoot: missing }))
      .toThrow("Chronicle web assets are unavailable");
    try {
      createChronicleServer(path.resolve("examples/canonical"), { webRoot: missing });
    } catch (error) {
      expect(String(error)).not.toContain(missing);
    }
  });
});
