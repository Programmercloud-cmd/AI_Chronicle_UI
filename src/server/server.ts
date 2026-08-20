import { createHash } from "node:crypto";

import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";

import { loadChronicle, readContainedArtifact } from "../data";
import { validateChronicle, type ValidatedChronicle } from "../domain";
import type { EvidenceRecord } from "../schema";
import { projectHttpDiagnostics } from "./http-diagnostics";
import {
  APPLICATION_CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY,
  contentDisposition,
  decodePreviewText,
  escapeHtml,
  imageMediaType,
} from "./security";
import { registerWebUi, resolveDefaultWebRoot } from "./static-web";

export const DEFAULT_PORT = 4317;
export const LOOPBACK_HOST = "127.0.0.1";

interface EvidenceContext {
  snapshot: ValidatedChronicle;
  evidence: { sourcePath: string; value: EvidenceRecord };
  bytes: Buffer;
}

type ContextResult<T> = { ok: true; value: T } | { ok: false; statusCode: number; body: unknown };

async function validatedSnapshot(rootPath: string): Promise<ContextResult<ValidatedChronicle>> {
  const loaded = await loadChronicle(rootPath);
  if (!loaded.ok) return { ok: false, statusCode: 422, body: { error: "chronicle-invalid", diagnostics: projectHttpDiagnostics(loaded.diagnostics) } };
  const validated = await validateChronicle(loaded.value);
  if (!validated.ok) return { ok: false, statusCode: 422, body: { error: "chronicle-invalid", diagnostics: projectHttpDiagnostics(validated.diagnostics) } };
  return { ok: true, value: validated.value };
}

async function evidenceContext(rootPath: string, id: string): Promise<ContextResult<EvidenceContext>> {
  const validated = await validatedSnapshot(rootPath);
  if (!validated.ok) return validated;
  const evidence = validated.value.evidence.find((record) => record.value.id === id);
  if (evidence === undefined || evidence.value.source.kind !== "artifact") {
    return { ok: false, statusCode: 404, body: { error: "artifact-evidence-not-found" } };
  }
  const read = await readContainedArtifact(
    { inputPath: validated.value.rootPath, realPath: validated.value.rootPath },
    evidence.value.source.path,
    evidence.sourcePath,
  );
  if (!read.ok) return { ok: false, statusCode: 422, body: { error: "artifact-unavailable", diagnostics: projectHttpDiagnostics(read.diagnostics) } };
  const digest = createHash("sha256").update(read.value.bytes).digest("hex");
  if (digest !== evidence.value.source.sha256) {
    return { ok: false, statusCode: 422, body: { error: "artifact-hash-mismatch" } };
  }
  return { ok: true, value: { snapshot: validated.value, evidence, bytes: read.value.bytes } };
}

function sendFailure(reply: FastifyReply, result: { statusCode: number; body: unknown }): FastifyReply {
  return reply.code(result.statusCode).type("application/json; charset=utf-8").send(result.body);
}

export interface CreateServerOptions { webRoot?: string }

export function createChronicleServer(rootPath: string, options: CreateServerOptions = {}): FastifyInstance {
  const server = Fastify({ logger: false, bodyLimit: 1024 });
  server.addHook("onRequest", async (request, reply) => {
    const pathname = request.url.split("?", 1)[0] ?? "/";
    const apiRequest = pathname === "/api" || pathname.startsWith("/api/");
    const applicationRequest = options.webRoot !== undefined && !apiRequest;
    reply.header("Content-Security-Policy", applicationRequest
      ? APPLICATION_CONTENT_SECURITY_POLICY
      : CONTENT_SECURITY_POLICY);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cache-Control", "no-store");
  });
  server.setErrorHandler(async (_error, _request, reply) =>
    reply.code(500).type("application/json; charset=utf-8").send({ error: "internal-server-error" }));

  server.get("/api/snapshot", async (_request, reply) => {
    const result = await validatedSnapshot(rootPath);
    if (!result.ok) return sendFailure(reply, result);
    const { rootPath: _internalRootPath, ...publicSnapshot } = result.value;
    return reply.type("application/json; charset=utf-8").send(publicSnapshot);
  });

  server.get<{ Params: { id: string } }>("/api/evidence/:id/preview", async (request, reply) => {
    const result = await evidenceContext(rootPath, request.params.id);
    if (!result.ok) return sendFailure(reply, result);
    const { evidence, bytes } = result.value;
    if (evidence.value.source.kind !== "artifact") return reply.code(404).send({ error: "artifact-evidence-not-found" });

    const text = decodePreviewText(bytes, evidence.value.source.media_type);
    if (text !== undefined) {
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(evidence.value.title)}</title></head><body><pre>${escapeHtml(text)}</pre></body></html>`;
      return reply.type("text/html; charset=utf-8").send(html);
    }
    const imageType = imageMediaType(bytes, evidence.value.source.media_type);
    if (imageType !== undefined) {
      reply.header("Content-Disposition", contentDisposition("inline", evidence.value.source.path));
      return reply.type(imageType).send(bytes);
    }
    return reply.code(415).type("application/json; charset=utf-8").send({
      error: "preview-unavailable",
      message: "This artifact is download-only.",
      raw_url: `/api/evidence/${encodeURIComponent(evidence.value.id)}/raw`,
    });
  });

  server.get<{ Params: { id: string } }>("/api/evidence/:id/raw", async (request, reply) => {
    const result = await evidenceContext(rootPath, request.params.id);
    if (!result.ok) return sendFailure(reply, result);
    const { evidence, bytes } = result.value;
    if (evidence.value.source.kind !== "artifact") return reply.code(404).send({ error: "artifact-evidence-not-found" });
    reply.header("Content-Disposition", contentDisposition("attachment", evidence.value.source.path));
    return reply.type("application/octet-stream").send(bytes);
  });

  if (options.webRoot !== undefined) registerWebUi(server, options.webRoot);

  return server;
}

export interface StartServerOptions { port?: number; host?: string }

export async function startChronicleServer(rootPath: string, options: StartServerOptions = {}): Promise<FastifyInstance> {
  const host = options.host ?? LOOPBACK_HOST;
  if (host !== LOOPBACK_HOST) throw new Error(`Chronicle only binds ${LOOPBACK_HOST}`);
  const port = options.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("port must be an integer from 0 through 65535");
  const preflight = await validatedSnapshot(rootPath);
  if (!preflight.ok) throw new Error("Chronicle dataset is invalid and cannot be served");
  const server = createChronicleServer(rootPath, { webRoot: resolveDefaultWebRoot() });
  await server.listen({ host: LOOPBACK_HOST, port });
  return server;
}
