# TODO Index

This folder tracks independent work items for openCodex.

## Shared Assumption

openCodex should be built on top of Codex CLI instead of reimplementing a local coding engine.
The product focus is orchestration, workflow design, session handling, and multi-entry experiences.

## Independent Tasks

- `T001-codex-cli-capability-inventory.md` — inventory the stable integration surfaces exposed by Codex CLI.
- `T002-wrapper-cli-command-spec.md` — define the first openCodex command surface.
- `T003-run-command-wrapper.md` — implement `opencodex run` on top of `codex exec`.
- `T004-review-command-wrapper.md` — implement `opencodex review` on top of `codex review`.
- `T005-session-and-summary-model.md` — define a normalized session and result schema.
- `T006-profile-and-policy-layer.md` — add reusable profiles for sandbox and approval behavior.
- `T007-doctor-command.md` — build a health-check command for local readiness.
- `T008-gateway-spike.md` — explore a future gateway layer inspired by always-on assistant systems.
