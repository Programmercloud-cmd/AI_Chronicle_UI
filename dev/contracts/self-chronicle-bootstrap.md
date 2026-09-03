# Component contract: self-chronicle-bootstrap

Date: 2026-09-02
Responsibility: orchestrator-owned admission, developer implementation, independent read-only critic, integration critic.

## Purpose

Create a concise tracked `chronicle/` dataset for Project Chronicle itself. The dataset must validate and render through the existing v1 product without changing schemas, APIs, dependencies, routes, or production behavior. It must replace ignored `dev/` material as the only place required to understand the accepted primary sequence, present state, and supported outstanding work.

## Sources and truth policy

Use, in order: current tracked source/schemas/tests/docs; accepted integration or critic evidence; investigation reports and approved contracts; raw developer material. Use Git object timestamps only where they reliably establish when a tracked capability became durable. Never infer an exact acceptance time from a date-only note. Copy only compact accepted evidence that remains useful; every copied artifact stays under `chronicle/evidence/artifacts/` and receives a verified SHA-256 record.

Resolve the stale pre-navigation claim that History has no minimap or free zoom/pan: current tracked source/tests and the later accepted History evidence supersede that README/gap-audit wording. Preserve the earlier gap audit only as time-scoped evidence for outstanding human and Linux validation, not as the current feature inventory.

## Proposed milestone admission

1. `CHR-001` — admit the executable v1 Chronicle foundation entering tracked source on 2026-08-20. This combines the public contract, safe data kernel, localhost runtime, deterministic UI, fixtures, and release boundary into one owner-relevant accepted capability; the many component gauntlets remain subordinate.
2. `CHR-002` — admit the interactive project-orientation workflow accepted into the tracked main line by the 2026-09-02 merge. Minimap, pan/zoom/selection/fullscreen, responsive framing, camera continuity, and milestone-neighborhood navigation materially changed how owners inspect a history; the 2026-08-21 implementation and repair commits and individual navigation gates remain subordinate.
3. `CHR-003` — reserve for the tracked self-Chronicle becoming critic-accepted during this gauntlet. Do not create or mark it accepted until an independent critic has accepted the implementation and produced exact timestamped evidence; an integration critic must then accept the final projected dataset.

Do not promote the initial repository commit, individual component implementations, test runs, critic iterations, visual-baseline updates, or the 2026-08-21 hover/fullscreen repair. Record only useful supporting events, especially the repair/merge that establishes the current accepted History behavior.

## Current state and roadmap

Before `CHR-003`, current state points to `CHR-002` and reports the later accepted History repair as subordinate state. After final acceptance, current points to `CHR-003`. Only supported incomplete work belongs on the roadmap: the tracked five-person human orientation study and the outstanding native Linux portability run. Speculative v2 features and documented exclusions are not committed roadmap items.

## Required outputs and checks

- Conventional v1 directories, including an intentionally empty tracked `revisions/` directory.
- Self-contained accepted evidence artifacts plus repository-reference records where tracked source is the authoritative evidence.
- Valid artifact containment and exact hashes.
- Dataset validation, relevant schema/domain tests, strict TypeScript/build checks, packaged/local serve, UI/console/evidence checks, then `npm run release:check` if focused checks pass.
- Independent critic verdict on admission, traceability, contradictions, omissions, topology, paths, and hashes; no more than two developer repair submissions.
- README corrections limited to the stale History operating-limit description and obsolete fixed visual-test count.

Acceptance requires an independent critic `ACCEPT`, followed by an integration-critic `ACCEPT` of the final dataset containing `CHR-003`. No PR, issue mutation, or deletion of ignored evidence is in scope.
