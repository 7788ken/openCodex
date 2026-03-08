# Execution Board

This board defines the current delivery order for openCodex.
It reflects the current CTO decision to build on top of Codex CLI instead of reimplementing a local coding engine.

## Core Principle

- Codex CLI is the local execution engine.
- openCodex is the orchestration, workflow, and product layer on top.
- MVP should prioritize thin wrappers, stable integration points, and low-risk delivery.

## Priority Bands

### P0

- `T001-codex-cli-capability-inventory.md`
- `T002-wrapper-cli-command-spec.md`
- `T005-session-and-summary-model.md`
- `T003-run-command-wrapper.md`
- `T007-doctor-command.md`

### P1

- `T004-review-command-wrapper.md`
- `T006-profile-and-policy-layer.md`

### P2

- `T008-gateway-spike.md`

## Recommended Execution Order

`T001 -> (T002 + T005) -> (T003 + T007) -> T004 -> T006 -> T008`

## Dependency Notes

1. `T001` is the fact base for safe integration.
2. `T002` defines the MVP command contract.
3. `T005` defines the shared session and summary shape used by multiple commands.
4. `T003` depends on `T001`, `T002`, and `T005`.
5. `T007` depends on `T001` to confirm environment assumptions.
6. `T006` should follow the first concrete command flows instead of leading them.
7. `T008` is explicitly isolated from MVP.

## Parallelization Guidance

- Start `T001` first.
- After the first pass of `T001`, run `T002` and `T005` in parallel.
- After `T002` and `T005` stabilize, run `T003` and `T007` in parallel.
- Keep `T004` and `T006` in the second wave.
- Keep `T008` parked until the local CLI milestone is complete.

## Current Status

- `T001` — completed
- `T002` — initial spec documented
- `T003` — ready to start
- `T004` — queued behind `T003`
- `T005` — initial model documented
- `T006` — queued behind `T003` and `T007`
- `T007` — ready to start
- `T008` — parked
