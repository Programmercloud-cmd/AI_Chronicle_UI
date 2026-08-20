import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";

import branchSchema from "../../schema/v1/branch.schema.json";
import commonSchema from "../../schema/v1/common.schema.json";
import currentSchema from "../../schema/v1/current.schema.json";
import engineeringEventSchema from "../../schema/v1/engineering-event.schema.json";
import evidenceSchema from "../../schema/v1/evidence.schema.json";
import milestoneSchema from "../../schema/v1/milestone.schema.json";
import projectSchema from "../../schema/v1/project.schema.json";
import revisionSchema from "../../schema/v1/revision.schema.json";
import roadmapSchema from "../../schema/v1/roadmap.schema.json";
import type {
  ChronicleRecordByKind,
  ChronicleRecordKind,
  RecordValidationSource,
  ShapeValidationResult,
  StructuralDiagnostic,
} from "./types";

const ajv = new Ajv2020({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  strict: true,
  useDefaults: false,
});
addFormats(ajv);
ajv.addFormat("iana-timezone", {
  type: "string",
  validate(value: string): boolean {
    if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") {
      return false;
    }

    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
      return true;
    } catch {
      return false;
    }
  },
});
ajv.addSchema(commonSchema);

const validators: Record<ChronicleRecordKind, ValidateFunction> = {
  project: ajv.compile(projectSchema),
  branch: ajv.compile(branchSchema),
  milestone: ajv.compile(milestoneSchema),
  current: ajv.compile(currentSchema),
  roadmap: ajv.compile(roadmapSchema),
  evidence: ajv.compile(evidenceSchema),
  "engineering-event": ajv.compile(engineeringEventSchema),
  revision: ajv.compile(revisionSchema),
};

function inferredRecordId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const record = value as Record<string, unknown>;
  if (typeof record.id === "string") return record.id;

  if (typeof record.project === "object" && record.project !== null) {
    const project = record.project as Record<string, unknown>;
    if (typeof project.id === "string") return project.id;
  }

  return undefined;
}

function actionableMessage(error: ErrorObject): string {
  if (error.keyword === "additionalProperties") {
    const property = String(error.params.additionalProperty);
    return `must not contain unknown property ${JSON.stringify(property)}`;
  }

  if (error.keyword === "required") {
    const property = String(error.params.missingProperty);
    return `must contain required property ${JSON.stringify(property)}`;
  }

  if (error.keyword === "const") {
    return `must equal supported value ${JSON.stringify(error.params.allowedValue)}`;
  }

  return error.message ?? `failed ${error.keyword} validation`;
}

function diagnosticsFor(
  kind: ChronicleRecordKind,
  source: RecordValidationSource,
  value: unknown,
  errors: ErrorObject[],
): StructuralDiagnostic[] {
  const recordId = source.recordId ?? inferredRecordId(value);

  return errors.map((error) => ({
    sourcePath: source.sourcePath,
    recordKind: kind,
    ...(recordId === undefined ? {} : { recordId }),
    instancePath: error.instancePath,
    keyword: error.keyword,
    message: actionableMessage(error),
  }));
}

export function validateRecordShape<K extends ChronicleRecordKind>(
  kind: K,
  value: unknown,
  source: RecordValidationSource,
): ShapeValidationResult<ChronicleRecordByKind[K]> {
  const validator = validators[kind];
  if (validator(value)) {
    return { ok: true, value: value as ChronicleRecordByKind[K] };
  }

  return {
    ok: false,
    diagnostics: diagnosticsFor(kind, source, value, validator.errors ?? []),
  };
}
