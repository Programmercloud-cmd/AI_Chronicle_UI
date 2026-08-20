import type { FastifyInstance } from "fastify";

import { loadChronicle } from "../data";
import { validateChronicle } from "../domain";
import { DEFAULT_PORT, LOOPBACK_HOST, startChronicleServer } from "../server";
import { initializeChronicle } from "./init";

export interface CliIo {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
}

export interface CliResult { exitCode: number; server?: FastifyInstance }

function usage(): string {
  return "Usage: chronicle init <directory> | validate <directory> | serve <directory> [--port <number>] [--host 127.0.0.1]\n";
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  if (index + 1 >= args.length || args[index + 1]!.startsWith("--")) throw new Error(`${name} requires a value`);
  return args[index + 1];
}

function assertServeArguments(args: string[]): void {
  for (let index = 1; index < args.length; index += 1) {
    const value = args[index]!;
    if (value === "--port" || value === "--host") { index += 1; continue; }
    throw new Error(`unknown serve option: ${value}`);
  }
}

export async function executeCli(argv: string[], io: CliIo = process): Promise<CliResult> {
  const [command, rootPath, ...options] = argv;
  if (command === undefined || rootPath === undefined) {
    io.stderr.write(usage());
    return { exitCode: 2 };
  }
  try {
    if (command === "init") {
      if (options.length > 0) throw new Error("init accepts only one directory");
      await initializeChronicle(rootPath);
      io.stdout.write(`Initialized Chronicle at ${rootPath}\n`);
      return { exitCode: 0 };
    }
    if (command === "validate") {
      if (options.length > 0) throw new Error("validate accepts only one directory");
      const loaded = await loadChronicle(rootPath);
      if (!loaded.ok) {
        io.stderr.write(`${JSON.stringify({ valid: false, diagnostics: loaded.diagnostics }, null, 2)}\n`);
        return { exitCode: 1 };
      }
      const validated = await validateChronicle(loaded.value);
      if (!validated.ok) {
        io.stderr.write(`${JSON.stringify({ valid: false, diagnostics: validated.diagnostics }, null, 2)}\n`);
        return { exitCode: 1 };
      }
      io.stdout.write(`${JSON.stringify({ valid: true, warnings: validated.value.warnings }, null, 2)}\n`);
      return { exitCode: 0 };
    }
    if (command === "serve") {
      assertServeArguments([rootPath, ...options]);
      const host = optionValue(options, "--host") ?? LOOPBACK_HOST;
      if (host !== LOOPBACK_HOST) throw new Error(`serve only permits --host ${LOOPBACK_HOST}`);
      const portText = optionValue(options, "--port");
      const port = portText === undefined ? DEFAULT_PORT : Number(portText);
      const server = await startChronicleServer(rootPath, { host, port });
      io.stdout.write(`Chronicle listening on ${server.listeningOrigin}\n`);
      return { exitCode: 0, server };
    }
    throw new Error(`unknown command: ${command}`);
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return { exitCode: 1 };
  }
}
