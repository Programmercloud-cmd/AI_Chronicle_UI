# Final MVP gap audit

Date: 2026-08-20

Scope: final repository state after independent integration critic acceptance and the refreshed packaged-distribution test.

## External validation still outstanding

### 1. Five-person human orientation study

The tracked protocol at `docs/usability/orientation-study.md` is ready, but no representative human participants have completed it. Automated DOM, accessibility, screenshot, and browser interaction tests are not substitutes for this product-comprehension gate.

Required evidence: participant timings and answers for the canonical and difficult histories, summarized defects, and a pass/fail conclusion against the stated ten-second and three-minute targets.

### 2. Native Linux portability run

The clean tarball install and packaged browser flows pass on Windows. The available WSL environment contains only the Docker Desktop system distribution and no usable Node/npm runtime; Docker is unavailable. A native Linux run therefore remains unperformed.

Required evidence: clean production install plus `chronicle init`, `validate`, and `serve`; browser asset and deep-link loading; and supported symlink-containment cases on a Linux development machine or CI runner.

## Closed by the integration gauntlet

- Accepted views are wired and served by packaged Fastify, including SPA deep links and protected API/assets namespaces.
- Runtime-only tarball and unrelated-working-directory production installation pass.
- Packaged CSP, evidence security, real diff rendering, theme behavior, and zero browser errors pass.
- Complete difficult-project packaged E2E passes.
- Browser scale fixture at 250 milestones, 12 branches, and 30 projected items passes the documented v1 characterization.
- Standalone README and public schema/usability documentation ship in the tarball.
- `npm run release:check` covers build, schema/type drift, unit/component/integration tests, visual regression, packaged browser E2E, tarball inspection, and clean-install smoke.

## Documented MVP limitations

- Desktop-first History with horizontal scrolling and jump-to-current; no complex zoom, minimap, or mobile redesign.
- No Chronicle authoring UI, automatic Git ingestion, search/filtering, remote hosting, authentication, migrations, or proprietary database.
- Inline unified-diff rendering is capped at 2 MB; oversized, binary, invalid-UTF-8, and unparsable artifacts remain download-only.
- Evidence formats outside escaped text/diff and signature-validated PNG/JPEG/WebP are download-only; repository references are descriptive and external URLs are never fetched by Chronicle.
- Flat backgrounds are used; the reference texture is intentionally deferred.
