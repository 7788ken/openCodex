# Execution Board

This board defines the current delivery order for openCodex.
It reflects the current CTO decision to build on top of Codex CLI instead of reimplementing a local coding engine.

## Core Principle

- Codex CLI is the local execution engine.
- openCodex is the orchestration, workflow, and product layer on top.
- The CTO role must live as a host-resident supervisor, not as a sandbox child agent.
- Sandbox child sessions are advisors, planners, reviewers, or narrowly scoped helpers for the host supervisor.
- The primary goal is local work execution and same-machine collaboration.
- `doctor` is a supporting safety rail, not the main product surface.

## Priority Bands

### P0

- `T001-codex-cli-capability-inventory.md`
- `T002-wrapper-cli-command-spec.md`
- `T005-session-and-summary-model.md`
- `T003-run-command-wrapper.md`

### P0 Support

- `T007-doctor-command.md`

### P1

- `T004-review-command-wrapper.md`
- `T006-profile-and-policy-layer.md`
- `T009-auto-run-supervisor.md`
- `T013-host-supervisor-runtime.md`
- `T014-sandbox-advisor-session-contract.md`
- `T015-supervisor-session-and-ui-separation.md`
- `T016-cto-conversation-and-research-mode.md`
- `T017-detached-install-layout.md`

### P2

- `T008-gateway-spike.md`
- `T010-remote-mobile-bridge.md`
- `T011-telegram-im-connector.md`
- `T012-telegram-cto-delegation.md`

## Recommended Execution Order

`T001 -> (T002 + T005) -> T003 -> T007 -> T004 -> T006 -> T009 -> T011 -> T012 -> (T013 + T014) -> T015 -> T016 -> T017 -> T010 -> T008`

## Dependency Notes

1. `T001` is the fact base for safe integration.
2. `T002` defines the MVP command contract.
3. `T005` defines the shared session and summary shape used by multiple commands.
4. `T003` is the first real work surface and the highest-value command.
5. `T007` improves readiness checks after the first real work path exists.
6. `T006` should follow the first concrete command flows instead of leading them.
7. `T009` should build on top of `run`, `session`, and `review` instead of bypassing them.
8. `T011` and `T012` establish the phone-to-host control channel.
9. `T013` moves the CTO identity and workflow ownership fully to the host supervisor.
10. `T014` defines what sandbox child sessions are allowed to do under that supervisor.
11. `T015` makes the separation visible in session history, tray UI, and workflow inspection.
12. `T016` turns chat, discussion, and research into first-class CTO interaction modes.
13. `T017` defines how app, CLI, and long-lived services share one detached installed runtime.
14. `T008` is explicitly isolated from MVP.

## Parallelization Guidance

- Start `T001` first.
- After the first pass of `T001`, run `T002` and `T005` in parallel.
- After `T002` and `T005` stabilize, prioritize `T003`.
- Keep `T007` as a support track around `T003`, not ahead of it.
- Keep `T004` and `T006` in the second wave.
- Move `T009` to the front of the post-MVP execution track once the wrapper surfaces are stable.
- After the Telegram bridge works, prioritize `T013` and `T014` together.
- Keep `T015` right behind them so the UI reflects the new control model.
- Move `T016` right after the supervisor split so the CEO can use CTO naturally even before issuing explicit commands.
- Move `T017` in before broader installed-product rollout so the service, tray app, and CLI do not bind to a source checkout by accident.
- Keep `T008` parked until the local CLI milestone is complete.

## Current Status

- `T001` — completed
- `T002` — initial spec documented
- `T003` — initial wrapper implemented
- `T004` — wrapper implemented with structured findings extraction
- `T005` — initial model documented
- `T006` — profile layer implemented with project-level defaults
- `T007` — initial command implemented as support tooling
- `T008` — parked
- `T009` — unattended workflow implemented with parent session and iteration limits
- `T010` — remote mobile bridge MVP implemented
- `T011` — Telegram IM connector MVP implemented
- `T012` — Telegram CTO delegation loop implemented as a transitional bridge
- `T013` — planned
- `T014` — planned
- `T015` — planned
- `T016` — planned
- `T017` — detached install layout documented; initial installer skeleton implemented
