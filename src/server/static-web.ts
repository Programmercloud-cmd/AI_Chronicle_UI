import { statSync } from "node:fs";
import path from "node:path";

import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export function assertWebRoot(webRoot: string): string {
  const resolved = path.resolve(webRoot);
  try {
    if (!statSync(resolved).isDirectory() || !statSync(path.join(resolved, "index.html")).isFile()) {
      throw new Error("invalid web root");
    }
  } catch {
    throw new Error("Chronicle web assets are unavailable; rebuild or reinstall Chronicle.");
  }
  return resolved;
}

export function resolveDefaultWebRoot(moduleDirectory = __dirname): string {
  const candidates = [
    path.resolve(moduleDirectory, "../../web"),
    path.resolve(moduleDirectory, "../../dist/web"),
  ];
  for (const candidate of candidates) {
    try {
      return assertWebRoot(candidate);
    } catch {
      // Source execution and compiled package execution have different module roots.
    }
  }
  throw new Error("Chronicle web assets are unavailable; rebuild or reinstall Chronicle.");
}

function requestPath(request: FastifyRequest): string {
  return request.url.split("?", 1)[0] ?? "/";
}

function isSpaNavigation(request: FastifyRequest): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const pathname = requestPath(request);
  return pathname !== "/api" &&
    !pathname.startsWith("/api/") &&
    pathname !== "/assets" &&
    !pathname.startsWith("/assets/") &&
    path.posix.extname(pathname) === "";
}

export function registerWebUi(server: FastifyInstance, webRoot: string): void {
  const root = assertWebRoot(webRoot);
  server.register(fastifyStatic, {
    root,
    prefix: "/",
    wildcard: false,
    index: false,
    cacheControl: false,
  });
  server.setNotFoundHandler(async (request, reply: FastifyReply) => {
    if (isSpaNavigation(request)) {
      return reply.type("text/html; charset=utf-8").sendFile("index.html");
    }
    return reply.code(404).type("application/json; charset=utf-8").send({ error: "not-found" });
  });
}
