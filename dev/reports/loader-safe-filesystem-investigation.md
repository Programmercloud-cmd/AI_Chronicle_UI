# Loader safe-filesystem investigation

Status: read-only investigation support for the future loader gauntlet. This is not an implementation or critic acceptance report.

## Recommendation

Keep path safety in a small filesystem-boundary module. Validate Chronicle-authored paths lexically before calling host path APIs, canonicalize existing files with `realpath`, and make containment decisions with `path.relative` rather than string prefixes.

For an artifact path:

1. Require a non-empty string containing `/` separators only. Reject NUL, `\`, empty segments, `.`, `..`, leading/trailing `/`, `path.posix.isAbsolute(value)`, `path.win32.isAbsolute(value)`, and a non-empty `path.win32.parse(value).root`. The last check is necessary for drive-relative input such as `C:secret.txt`, which is drive-qualified but not absolute.
2. Split the validated POSIX locator into segments and join those segments beneath the already canonicalized Chronicle root. Do not normalize first: normalization erases the evidence needed to reject `.` and `..`.
3. Perform a lexical containment check, then `await realpath(candidate)` and repeat containment against the real root. Containment is true only when `path.relative(realRoot, realTarget)` is non-empty, is not absolute, is not `..`, and does not begin with `..${path.sep}`.
4. Open the validated target for reading, use `FileHandle.stat()` to require `isFile()`, and read/hash through that same handle. Reject directories, sockets, devices, FIFOs, missing files, and permission failures with source-aware diagnostics.
5. Optionally repeat `realpath(candidate)` after opening and require the pre/post canonical paths to agree. This detects ordinary concurrent symlink replacement but is not a complete defense against a hostile local actor.

`repository_ref.path` receives the same lexical checks but is never joined to the Chronicle root, canonicalized, or read. Authoritative YAML record discovery should reject symlinked record/config files; the accepted contract only needs contained symlinks for referenced artifacts, and rejecting record symlinks keeps the source-of-truth boundary inspectable and portable.

## Case and filename collisions

- Match every record directory entry to `${record.id}.yaml` with ordinal, case-sensitive equality even on a case-insensitive filesystem.
- After structural ID validation, use an explicit ASCII fold for collision keys; do not use locale-sensitive comparison. Reject distinct IDs/filenames with the same folded key.
- Apply the same rule to distinct declared artifact locators: exact reuse of one path may be allowed, but two spellings that differ only by ASCII case are non-portable and should fail.
- On Linux, enumerate all entries before accepting any so `CORE-001.yaml` and `core-001.yaml` are detected. Windows may expose only one physical spelling, so declared IDs and locator strings must also be checked independently of enumeration.

## Symlinks and containment

- Canonicalize the selected Chronicle root itself with `realpath`; otherwise a symlinked root and its targets are compared in different namespaces.
- `lstat` describes the directory entry while `stat` follows it. For allowed artifact symlinks, containment must use the followed `realpath`, and regular-file validation must use the opened handle's `stat()`.
- Never use `resolved.startsWith(root)`; sibling paths such as `root-escape` pass naïve prefix checks. `path.relative` also exposes cross-drive results on Windows, which must be rejected when absolute.
- A missing or broken symlink fails closed. An in-root symlink to an in-root regular file is acceptable; any symlink/junction chain whose final canonical target leaves the real root is rejected.

## Race-aware limitation

Standard Node exposes `realpath`, `lstat`, `stat`, `open`, and `FileHandle.stat/readFile`, but no portable descriptor-relative equivalent of Linux `openat2(..., RESOLVE_BENEATH)` and no portable API to recover the canonical path from an already opened handle. Therefore `realpath -> open` contains an unavoidable TOCTOU window when symlinks are allowed.

For this local, same-user v1 tool, use best effort: pre-check canonical containment, open once, verify the handle is a regular file, read and SHA-256 hash through that handle, then re-check the path and reject observed changes. Avoid `fs.access` followed by `readFile`, and document that Chronicle is not a security boundary against a malicious process concurrently rewriting its directory. Strong hostile-writer containment would require rejecting all symlinks or platform-specific/native APIs and is not justified for v1.

## Local evidence

Environment probed: Node `v25.8.0`, `win32`.

- `node:path` locally exposes both `path.posix` and `path.win32`, allowing host-independent lexical checks.
- `C:/Windows/win.ini` is not POSIX-absolute but is Windows-absolute; `C:relative.txt` is neither absolute form, while `path.win32.parse(...).root` returns `C:`. Both checks are required.
- `path.normalize` collapsed `./file` and `a/../file`, confirming validation must precede normalization.
- A disposable Windows junction at `root/escape-dir` resolved to `outside/outside.txt`; `path.relative(realRoot, realTarget)` returned `..\outside\outside.txt`, correctly failing containment even though the traversed path began under root.
- File-symlink creation returned `EPERM` in this Windows environment, while junction creation succeeded. Tests must treat unsupported symlink creation as an explicit platform skip, not as proof that escape handling passes.
- The local `FileHandle` supports `stat()` and `readFile()`; a probe read five bytes and confirmed `stat().isFile()`.
- Windows did not expose `fs.constants.O_NOFOLLOW` in this runtime, so it cannot be the portable v1 containment mechanism.

Minimum later test matrix: valid nested file, every forbidden lexical form, drive-relative and UNC inputs, sibling-prefix escape, missing/broken link, in-root link, out-of-root junction/symlink, directory/special-file rejection where supported, exact and case-folded filename collisions, root presented through a symlink, and a controlled pre/post-realpath replacement test documenting the residual race.
