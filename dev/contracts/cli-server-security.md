# Component contract: cli-server-security

## Purpose

Expose validated immutable Chronicle snapshots and untrusted evidence through a local-only read-only server, plus `init`, `validate`, and `serve` CLI commands.

## Interfaces

- Bind `127.0.0.1` only; default port 4317.
- `GET /api/snapshot`, `/api/evidence/:id/preview`, `/api/evidence/:id/raw`.
- Every snapshot request reloads and validates the complete dataset.
- `init` creates only the conventional data skeleton and refuses overwrite; `validate` reports diagnostics; `serve` manages lifecycle.

## Security

- Restrictive approved CSP and `X-Content-Type-Options: nosniff`.
- Escaped UTF-8 text/diff preview only; signature-validated PNG/JPEG/WebP preview; HTML/SVG/mismatch/unknown download-only.
- Raw artifacts use safe attachment disposition; no artifact HTML/SVG execution, shell execution, CORS, mutation, live Git, watcher, or filesystem escape.

## Tests and acceptance

- CLI success/failure/overwrite/bind behavior; snapshot reload consistency; headers/CSP/content types/disposition; malicious HTML/SVG/text/diff/MIME/double-extension/path/symlink cases; actual examples.
- Minimal Fastify/static boundary, no cache/database/auth/remote host; full checks and independent ACCEPT.
