import type { RevisionRecord } from "../schema";

export type RevisionChange = RevisionRecord["changes"][number];

export interface ChangeFailure {
  code: string;
  message: string;
  pointer: string;
}

export type ChangeResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: ChangeFailure };

const forbiddenSegments = new Set(["__proto__", "prototype", "constructor"]);
const immutableRoots = new Set(["id", "schema_version", "recorded_at"]);

function cloneObject(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, child] of Object.entries(value)) {
    Object.defineProperty(output, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: cloneJson(child),
    });
  }
  return output;
}

export function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneJson(item)) as T;
  if (typeof value === "object" && value !== null) {
    return cloneObject(value as Record<string, unknown>) as T;
  }
  return value;
}

export function deepJsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deepJsonEqual(value, right[index]))
    );
  }
  if (typeof left !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && deepJsonEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

function decodePointer(path: string): ChangeResult<string[]> {
  if (path.length === 0 || !path.startsWith("/")) {
    return {
      ok: false,
      failure: { code: "pointer-invalid", message: "path must be a non-root JSON Pointer", pointer: path },
    };
  }
  const segments: string[] = [];
  for (const encoded of path.slice(1).split("/")) {
    if (/~(?:[^01]|$)/u.test(encoded)) {
      return {
        ok: false,
        failure: { code: "pointer-invalid-escape", message: "path contains an invalid JSON Pointer escape", pointer: path },
      };
    }
    const segment = encoded.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (forbiddenSegments.has(segment)) {
      return {
        ok: false,
        failure: { code: "pointer-unsafe", message: `path segment ${JSON.stringify(segment)} is forbidden`, pointer: path },
      };
    }
    segments.push(segment);
  }
  if (segments.length === 0 || immutableRoots.has(segments[0]!)) {
    return {
      ok: false,
      failure: { code: "immutable-field", message: "path targets an immutable record field", pointer: path },
    };
  }
  return { ok: true, value: segments };
}

export function applyGuardedChange<T>(input: T, change: RevisionChange): ChangeResult<T> {
  const decoded = decodePointer(change.path);
  if (!decoded.ok) return decoded;
  const output = cloneJson(input);
  let parent: unknown = output;
  for (const segment of decoded.value.slice(0, -1)) {
    if (Array.isArray(parent)) {
      return { ok: false, failure: { code: "pointer-array-traversal", message: "paths must not traverse arrays", pointer: change.path } };
    }
    if (typeof parent !== "object" || parent === null || !Object.hasOwn(parent, segment)) {
      return { ok: false, failure: { code: "pointer-parent-missing", message: "path parent does not exist", pointer: change.path } };
    }
    parent = (parent as Record<string, unknown>)[segment];
  }
  if (Array.isArray(parent)) {
    return { ok: false, failure: { code: "pointer-array-index", message: "array elements cannot be addressed by revision paths", pointer: change.path } };
  }
  if (typeof parent !== "object" || parent === null) {
    return { ok: false, failure: { code: "pointer-parent-not-object", message: "path parent is not an object", pointer: change.path } };
  }
  const key = decoded.value.at(-1)!;
  const record = parent as Record<string, unknown>;
  const present = Object.hasOwn(record, key);

  if (change.operation === "add") {
    if (present) return { ok: false, failure: { code: "add-target-present", message: "add requires an absent property", pointer: change.path } };
    Object.defineProperty(record, key, { configurable: true, enumerable: true, writable: true, value: cloneJson(change.value) });
  } else {
    if (!present) return { ok: false, failure: { code: `${change.operation}-target-missing`, message: `${change.operation} requires an existing property`, pointer: change.path } };
    if (!deepJsonEqual(record[key], change.from)) {
      return { ok: false, failure: { code: "guard-mismatch", message: "current value does not match the guarded from value", pointer: change.path } };
    }
    if (change.operation === "replace") record[key] = cloneJson(change.value);
    else delete record[key];
  }
  return { ok: true, value: output };
}
