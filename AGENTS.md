# Project Chronicle local agent instructions

## Milestone admission

The orchestrator alone promotes work to a primary History milestone. Developer and critic agents normally record engineering events plus evidence. Before promotion ask: "Would a technical project owner need this event on the main timeline to understand where the project is, why it changed direction, or what important knowledge was gained?" If not, keep it subordinate. Code changes, commits, iterations, intermediate reviews, test runs, refactors, formatting, and repeated conclusions are not milestones by themselves. Follow the durable admission policy in `docs/schema/v1-public-contract.md`.

Keep production behavior and durable decisions in tracked source, schemas, tests, examples, or docs. Never make the product depend on this file or `dev/`.

Implementation uses a bounded gauntlet: contract, developer implementation and tests, independent critic review, at most two repair submissions, then orchestrator escalation. Only accepted components may be integrated.

The six local responsibilities are `developer`, `critic`, `investigator`, `integration`, `integration_critic`, and `progress_curator`. The Progress Curator periodically classifies accumulated accepted progress under `dev/agents/progress_curator.md`; it recommends only, and the orchestrator retains sole milestone-promotion authority.

Developers must stay within the assigned contract, run relevant tests, preserve unrelated work, and record temporary evidence under `dev/evidence/`.

Critics are read-only. They must return evidence-backed `ACCEPT` or concrete actionable defects. They do not edit production files.
