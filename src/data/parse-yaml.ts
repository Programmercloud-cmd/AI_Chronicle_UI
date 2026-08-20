import {
  isAlias,
  isPair,
  isScalar,
  parseAllDocuments,
  visit,
  type Node,
} from "yaml";

import type { DataResult } from "./types";

const standardTagPrefix = "tag:yaml.org,2002:";

export function parseChronicleYaml(text: string, sourcePath: string): DataResult<unknown> {
  const documents = parseAllDocuments(text, {
    customTags: [],
    merge: false,
    prettyErrors: false,
    resolveKnownTags: false,
    schema: "core",
    strict: true,
    stringKeys: true,
    uniqueKeys: true,
    version: "1.2",
  });

  if (documents.length !== 1) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "yaml-invalid",
          sourcePath,
          message: `expected exactly one YAML document, found ${documents.length}`,
        },
      ],
    };
  }

  const document = documents[0];
  if (document === undefined) {
    return {
      ok: false,
      diagnostics: [
        { code: "yaml-invalid", sourcePath, message: "YAML document is missing" },
      ],
    };
  }

  if (document.errors.length > 0) {
    return {
      ok: false,
      diagnostics: document.errors.map((problem) => ({
        code: "yaml-invalid",
        sourcePath,
        message: problem.message,
      })),
    };
  }

  const forbidden: string[] = [];
  visit(document, (_key, node) => {
    if (isAlias(node)) {
      forbidden.push("YAML aliases are not allowed");
      return;
    }

    if (isPair(node) && isScalar(node.key) && node.key.value === "<<") {
      forbidden.push("YAML merge keys are not allowed");
      return;
    }

    const yamlNode = node as Node | undefined;
    if (
      yamlNode?.tag !== undefined &&
      yamlNode.tag !== null &&
      !yamlNode.tag.startsWith(standardTagPrefix)
    ) {
      forbidden.push(`custom YAML tag ${JSON.stringify(yamlNode.tag)} is not allowed`);
    }
  });

  if (forbidden.length > 0) {
    return {
      ok: false,
      diagnostics: [...new Set(forbidden)].sort().map((message) => ({
        code: "yaml-forbidden" as const,
        sourcePath,
        message,
      })),
    };
  }

  if (document.warnings.length > 0) {
    return {
      ok: false,
      diagnostics: document.warnings.map((warning) => ({
        code: "yaml-invalid",
        sourcePath,
        message: warning.message,
      })),
    };
  }

  try {
    return { ok: true, value: document.toJS({ maxAliasCount: 0 }) };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "yaml-invalid",
          sourcePath,
          message: error instanceof Error ? error.message : "failed to convert YAML",
        },
      ],
    };
  }
}
