# Component contract: schema-v1-runtime

## Purpose

Turn the accepted Chronicle v1 public contract into an executable structural boundary without introducing cross-record semantics.

## Inputs

- `docs/schema/v1-public-contract.md`
- Individual parsed record values plus record kind, source path, and optional record ID.

## Outputs

- JSON Schema Draft 2020-12 artifacts for project, branch, milestone, current, roadmap, evidence, engineering event, and revision.
- Generated TypeScript declarations and an automated schema/type drift check.
- `validateRecordShape(...)` returning the typed record on success or source-aware structural diagnostics on failure.
- Valid and invalid structural fixtures, build, and test integration.

## Interfaces

- Structural validation accepts one record at a time and never resolves references or accesses artifacts.
- Diagnostics identify source file, record kind/ID when available, instance path, and actionable message.

## Assumptions

- YAML parsing and filesystem loading are later components.
- The public contract is normative where examples and implementation preferences differ.

## Non-goals

- YAML parsing, cross-record semantics, graph validation, revision projection, artifact access, CLI, server, or UI.

## Failure behavior

- Unknown keys, unsupported schema versions, malformed IDs/timestamps/unions, and invalid required/optional shapes fail closed.
- Generated files are never manually edited; drift fails a repeatable check.

## Tests

- Representative valid record for every kind.
- Invalid matrix for unknown keys, versions, IDs, offsetless timestamps, required fields, enums, arrays, and discriminated unions.
- Diagnostics and generated-file drift tests.

## Acceptance criteria

- All representative valid records pass and invalid fixtures fail for their intended reason.
- Generated declarations need no manual changes and drift is automatically detected.
- Diagnostics identify the record/source/path clearly.
- No semantic, filesystem, server, or UI logic leaks into this layer.
- Independent critic returns ACCEPT with build/test evidence.
