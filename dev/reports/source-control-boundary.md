# source-control-boundary — SUPERSEDED

Historical decision: an independent critic accepted root-anchored ignore rules for
`/AGENTS.md` and `/dev/` under the repository's former local-only gauntlet policy.

The repository portability policy supersedes that decision. The root `AGENTS.md`,
`dev/AGENTS.md`, `dev/agents/`, `dev/contracts/`, and `dev/reports/` are tracked;
transient `dev/evidence/`, `dev/runs/`, and `dev/scratch/` remain ignored. No
production behavior depends on development-process files.
