import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createChronicleServer, startChronicleServer } from "../../src/server";

const temporaryRoots: string[] = [];

async function copyCanonical(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "chronicle-server-"));
  temporaryRoots.push(root);
  await cp(path.resolve("examples/canonical"), root, { recursive: true });
  return root;
}

async function replaceEvidenceArtifact(
  root: string, bytes: Buffer, mediaType: string, locator = "evidence/artifacts/logs/initial-replay.log",
): Promise<void> {
  const recordPath = path.join(root, "evidence", "records", "EVD-0001.yaml");
  const original = await readFile(recordPath, "utf8");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const priorLocator = "evidence/artifacts/logs/initial-replay.log";
  const updated = original
    .replace(`path: "${priorLocator}"`, `path: "${locator}"`)
    .replace(/media_type: ".*"/u, `media_type: "${mediaType}"`)
    .replace(/sha256: "[a-f0-9]+"/u, `sha256: "${digest}"`);
  await writeFile(recordPath, updated, "utf8");
  const artifactPath = path.join(root, ...locator.split("/"));
  await writeFile(artifactPath, bytes);
  if (locator !== priorLocator) await rm(path.join(root, ...priorLocator.split("/")));
}

function expectRootRedacted(body: string, root: string): void {
  const native = root;
  const normalized = root.replace(/\\/gu, "/");
  const jsonEscaped = JSON.stringify(root).slice(1, -1);
  expect(body).not.toContain(native);
  expect(body).not.toContain(normalized);
  expect(body).not.toContain(jsonEscaped);
  expect(body).not.toMatch(/ENOENT|EACCES|EPERM/iu);
}

async function expectAllApiFailuresRedacted(server: ReturnType<typeof createChronicleServer>, root: string): Promise<void> {
  for (const url of [
    "/api/snapshot",
    "/api/evidence/EVD-0001/preview",
    "/api/evidence/EVD-0001/raw",
  ]) {
    const response = await server.inject({ method: "GET", url });
    expect(response.statusCode).toBe(422);
    expect(response.json().diagnostics[0].code).toBeTruthy();
    expectRootRedacted(response.body, root);
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Chronicle local server", () => {
  it("returns a fully validated snapshot with restrictive headers", async () => {
    const server = createChronicleServer(path.resolve("examples/canonical"));
    const response = await server.inject({ method: "GET", url: "/api/snapshot" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.json().project.value.project.id).toBe("canonical-mock");
    expect(response.json().rootPath).toBeUndefined();
    await server.close();
  });

  it("reloads and revalidates the dataset for each snapshot request", async () => {
    const root = await copyCanonical();
    const server = createChronicleServer(root);
    expect((await server.inject({ method: "GET", url: "/api/snapshot" })).statusCode).toBe(200);
    const milestone = path.join(root, "milestones", "CORE-002.yaml");
    await writeFile(milestone, (await readFile(milestone, "utf8")).replace('  - "CORE-001"', '  - "MISSING-999"'), "utf8");
    const invalid = await server.inject({ method: "GET", url: "/api/snapshot" });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error).toBe("chronicle-invalid");
    await server.close();
  });

  it("escapes malicious text and diff previews rather than executing markup", async () => {
    const root = await copyCanonical();
    const malicious = Buffer.from(`<script>alert("x")</script>\n<img src=x onerror=alert(1)>`);
    await replaceEvidenceArtifact(root, malicious, "text/plain");
    const server = createChronicleServer(root);
    const response = await server.inject({ method: "GET", url: "/api/evidence/EVD-0001/preview" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("&lt;script&gt;");
    expect(response.body).not.toContain("<script>alert");
    expect(response.headers["content-security-policy"]).toContain("script-src 'none'");
    await server.close();
  });

  it.each([
    ["text/html", Buffer.from("<script>alert(1)</script>")],
    ["image/svg+xml", Buffer.from("<svg><script>alert(1)</script></svg>")],
    ["application/x-shockwave-flash", Buffer.from("active")],
    ["text/plain", Buffer.from([0xc3, 0x28])],
    ["image/png", Buffer.from("not a PNG")],
  ])("keeps %s or mismatched content download-only", async (mediaType, bytes) => {
    const root = await copyCanonical();
    await replaceEvidenceArtifact(root, bytes, mediaType);
    const server = createChronicleServer(root);
    const preview = await server.inject({ method: "GET", url: "/api/evidence/EVD-0001/preview" });
    expect(preview.statusCode).toBe(415);
    expect(preview.json().error).toBe("preview-unavailable");
    expect(preview.headers["x-content-type-options"]).toBe("nosniff");
    const raw = await server.inject({ method: "GET", url: "/api/evidence/EVD-0001/raw" });
    expect(raw.statusCode).toBe(200);
    expect(raw.headers["content-type"]).toContain("application/octet-stream");
    expect(raw.headers["content-disposition"]).toMatch(/^attachment;/u);
    expect(raw.rawPayload).toEqual(bytes);
    await server.close();
  });

  it("previews signature-validated images independent of filename extension", async () => {
    const root = await copyCanonical();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await replaceEvidenceArtifact(root, png, "image/png", "evidence/artifacts/logs/report.html.png");
    const server = createChronicleServer(root);
    const response = await server.inject({ method: "GET", url: "/api/evidence/EVD-0001/preview" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.headers["content-disposition"]).toBe('inline; filename="report.html.png"');
    await server.close();
  });

  it("does not trust a double extension when active bytes are declared as HTML", async () => {
    const root = await copyCanonical();
    await replaceEvidenceArtifact(root, Buffer.from("<script>alert(1)</script>"), "text/html", "evidence/artifacts/logs/report.html.png");
    const server = createChronicleServer(root);
    const response = await server.inject({ method: "GET", url: "/api/evidence/EVD-0001/preview" });
    expect(response.statusCode).toBe(415);
    await server.close();
  });

  it("does not treat external or repository evidence as readable artifacts", async () => {
    const server = createChronicleServer(path.resolve("examples/canonical"));
    const response = await server.inject({ method: "GET", url: "/api/evidence/EVD-0004/raw" });
    expect(response.statusCode).toBe(404);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    await server.close();
  });

  it("fails closed when a declared path attempts traversal", async () => {
    const root = await copyCanonical();
    const record = path.join(root, "evidence", "records", "EVD-0001.yaml");
    await writeFile(record, (await readFile(record, "utf8")).replace(
      'path: "evidence/artifacts/logs/initial-replay.log"', 'path: "../outside.txt"'), "utf8");
    const server = createChronicleServer(root);
    const response = await server.inject({ method: "GET", url: "/api/evidence/EVD-0001/raw" });
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe("chronicle-invalid");
    await server.close();
  });

  it("fails closed when a declared path is absolute", async () => {
    const root = await copyCanonical();
    const record = path.join(root, "evidence", "records", "EVD-0001.yaml");
    await writeFile(record, (await readFile(record, "utf8")).replace(
      'path: "evidence/artifacts/logs/initial-replay.log"', 'path: "/outside.txt"'), "utf8");
    const server = createChronicleServer(root);
    expect((await server.inject({ method: "GET", url: "/api/evidence/EVD-0001/raw" })).statusCode).toBe(422);
    await server.close();
  });

  it("fails closed when an artifact symlink escapes the root", async (context) => {
    const root = await copyCanonical();
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "chronicle-server-outside-"));
    temporaryRoots.push(outsideRoot);
    const outside = path.join(outsideRoot, "outside.log");
    await writeFile(outside, "outside", "utf8");
    const artifact = path.join(root, "evidence", "artifacts", "logs", "initial-replay.log");
    await rm(artifact);
    try {
      await symlink(outside, artifact, "file");
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && (error.code === "EPERM" || error.code === "EACCES")) {
        context.skip();
        return;
      }
      throw error;
    }
    const server = createChronicleServer(root);
    expect((await server.inject({ method: "GET", url: "/api/evidence/EVD-0001/raw" })).statusCode).toBe(422);
    await server.close();
  });

  it("redacts root paths and filesystem exceptions when an artifact is missing", async () => {
    const root = await copyCanonical();
    await rm(path.join(root, "evidence", "artifacts", "logs", "initial-replay.log"));
    const server = createChronicleServer(root);
    await expectAllApiFailuresRedacted(server, root);
    await server.close();
  });

  it("redacts input roots and filesystem exceptions after the Chronicle root vanishes", async () => {
    const root = await copyCanonical();
    const server = createChronicleServer(root);
    await rm(root, { recursive: true, force: true });
    await expectAllApiFailuresRedacted(server, root);
    await server.close();
  });

  it("binds only IPv4 loopback and rejects remote hosts", async () => {
    const server = await startChronicleServer(path.resolve("examples/canonical"), { port: 0 });
    expect((server.server.address() as AddressInfo).address).toBe("127.0.0.1");
    await server.close();
    await expect(startChronicleServer(path.resolve("examples/canonical"), { port: 0, host: "0.0.0.0" })).rejects.toThrow("only binds");
  });
});
