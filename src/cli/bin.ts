#!/usr/bin/env node
import { executeCli } from "./cli";

async function main(): Promise<void> {
  const result = await executeCli(process.argv.slice(2));
  process.exitCode = result.exitCode;
  if (result.server === undefined) return;
  const close = async (): Promise<void> => { await result.server?.close(); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

void main();
