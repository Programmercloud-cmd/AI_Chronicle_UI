# Project Chronicle implementation dependency graph

Status values: blocked, ready, developer, critic, accepted, integration.

| Component | Dependencies | File ownership | Status |
| --- | --- | --- | --- |
| source-control-boundary | none | `.gitignore`, local `AGENTS.md`, local `dev/` | accepted |
| schema-v1-public-contract | none | `docs/schema/v1-public-contract.md` | accepted |
| schema-v1-runtime | public contract | `schema/`, `src/schema/`, `tests/schema/`, root package/build files | accepted |
| loader-safe-filesystem | schema runtime | `src/data/`, `tests/data/`, YAML dependency/config | accepted |
| revision-semantic-validator | loader | `src/domain/`, `tests/domain/` | accepted |
| data-kernel-integration | schema + loader + semantic validator + examples | `tests/integration/data-kernel/` | accepted |
| current-roadmap-domain | semantic validator | `src/presentation/`, `tests/presentation/` | accepted |
| cli-server-security | semantic validator | CLI/server files and server tests | accepted |
| timeline-layout | semantic validator | timeline files and layout tests | accepted |
| app-shell | CLI/server snapshot interface | web app shell/theme/error files | accepted |
| current-roadmap-ui | domain + app shell | current/roadmap web files | accepted |
| history-ui | timeline + app shell | history web files and visual tests | accepted |
| detail-evidence-diff-ui | server + app shell | milestone/evidence web files | accepted |
| difficult-mock | public contract for development; schema runtime for acceptance | `examples/` | accepted (production semantic rerun required at integration) |
| integration-release | accepted product components | integration/e2e/docs | accepted |

Rules:

- Start each component as soon as all dependencies are accepted.
- Use strict non-overlapping ownership; an agent may not edit another active component's files.
- Every component requires an independent critic after its developer.
- Run periodic integration after data-kernel acceptance and after UI acceptance.
- UI critics must launch, interact with, and visually inspect the application against `docs/design/history_timeline_reference.png`.
