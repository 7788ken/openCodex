# Execution Board

This board defines the current delivery order for openCodex.
It reflects the current CTO decision to build on top of Codex CLI instead of reimplementing a local coding engine.

## Core Principle

- Codex CLI is the local execution engine.
- openCodex is the orchestration, workflow, and product layer on top.
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

### P2

- `T008-gateway-spike.md`
- `T010-remote-mobile-bridge.md`
- `T011-telegram-im-connector.md`

## Recommended Execution Order

`T001 -> (T002 + T005) -> T003 -> T007 -> T004 -> T006 -> T009 -> T008`

## Dependency Notes

1. `T001` is the fact base for safe integration.
2. `T002` defines the MVP command contract.
3. `T005` defines the shared session and summary shape used by multiple commands.
4. `T003` is the first real work surface and the highest-value command.
5. `T007` improves readiness checks after the first real work path exists.
6. `T006` should follow the first concrete command flows instead of leading them.
7. `T009` should build on top of `run`, `session`, and `review` instead of bypassing them.
8. `T008` is explicitly isolated from MVP.

## Parallelization Guidance

- Start `T001` first.
- After the first pass of `T001`, run `T002` and `T005` in parallel.
- After `T002` and `T005` stabilize, prioritize `T003`.
- Keep `T007` as a support track around `T003`, not ahead of it.
- Keep `T004` and `T006` in the second wave.
- Move `T009` to the front of the post-MVP execution track once the wrapper surfaces are stable.
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
- `T012` — Telegram CTO delegation loop implemented
