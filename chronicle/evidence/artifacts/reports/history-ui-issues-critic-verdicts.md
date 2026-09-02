# History UI issues #1 and #2 — critic verdicts

This file records subordinate engineering evidence only. The orchestrator did not promote these fixes to a primary History milestone.

## Gauntlet A

- Verdict: `ACCEPT` without repair.
- Installed-Chrome review covered canonical desktop light/dark and difficult narrow light/dark.
- Hover, one-pixel pointer movement, unhover, focus, and blur left the History surface, SVG, graph, node, and viewBox geometry unchanged.
- The concise summary remained contained and overflow-free with `pointer-events: none` throughout its tree; console output was clean.
- Focused unit suite: 107/107. Focused Chrome visual suite: 4/4.

## Gauntlet B

- Initial verdict: `REJECT` because event-only fullscreen exit did not trigger camera restoration/session disposal.
- Repair 1 verdict: `REJECT` because the camera restored but React retained stale fullscreen viewport dimensions; immediate Fit could reintroduce fullscreen geometry.
- Repair 2 verdict: `ACCEPT`. With exit ResizeObserver notifications suppressed, the actual 1376 × 556 preview content box restored normalized scale `0.9419154563`, preserved graph center, returned immediate Fit to viewBox `-22.394394 -149.230503 1971.945260 796.803463`, and captured a fresh second-entry factor `1.0465116279` with rendered scale `0.7302433943`.
- Accepted safe-area evidence: canonical 28 visible SVG texts with 25.116 px / 40.629 px minimum margins; difficult 28 texts with 26.087 px / 34.291 px during the B critic run.
- The critic approved `responsive-760.png`, `responsive-320.png`, and `fullscreen-narrow-light.png` as intentional complete-cutout framing changes.

## Integration critic

- Verdict: `ACCEPT`.
- True installed-Chrome combined flows passed for canonical and difficult packaged fixtures.
- Canonical: 28 visible SVG texts, minimum 28.571 px left / 38.936 px right.
- Difficult: 60 visible SVG texts, minimum 27.571 px left / 33.756 px right.
- Hover geometry, summary containment, keyboard parity, normalized zoom, center continuity, fresh second entry, transformed minimum, pan limits, minimap, accessibility, CSP, and console checks passed.
- The critic separately approved the complete-content `difficult-scale.png` baseline after the quiet visual run reached its screenshot assertion.
- Post-acceptance read-only audits accepted the route ResizeObserver wait, fractional canvas content-box test measurements, and exact post-exit polling; no production assertions or precision were weakened.

## Final release gate

- `npm run release:check`: `PASS` on the final diff.
- Build/schema: pass.
- Unit tests: 493 passed, 4 skipped.
- Installed-Chrome visual tests: 33/33 passed.
- Production-only package install, CLI/server smoke, and packaged canonical/difficult browser suites: pass.
