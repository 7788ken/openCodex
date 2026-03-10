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
- `T009-auto-run-supervisor.md` — add an unattended local workflow surface on top of wrapper commands.
- `T010-remote-mobile-bridge.md` — expose a minimal phone-friendly remote bridge.
- `T011-telegram-im-connector.md` — add a Telegram-first IM connector.
- `T012-telegram-cto-delegation.md` — route Telegram turns into the CTO workflow loop.
- `T013-host-supervisor-runtime.md` — move CTO identity and long-lived control to the host.
- `T014-sandbox-advisor-session-contract.md` — define child-session boundaries under the host supervisor.
- `T015-supervisor-session-and-ui-separation.md` — make the supervisor/child split visible in history and UI.
- `T016-cto-conversation-and-research-mode.md` — support chat, discussion, and research before orchestration.
- `T017-detached-install-layout.md` — define the detached installed runtime layout for App, CLI, and services.
