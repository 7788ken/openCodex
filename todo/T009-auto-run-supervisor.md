# T009 — Auto Run Supervisor

## Objective

Add a first unattended execution surface for openCodex so local work can continue without manual handoff between every step.

## Why Now

openCodex already has the core building blocks for automation-friendly execution:

- `run` as the main local work surface
- `session` as the same-machine trace and handoff surface
- `session repair` for stale state recovery
- normalized summaries and stable exit status for machine consumption

What is still missing is a product-owned loop that can keep moving without waiting for a human after every single command.

## Scope

- Define a first `auto` workflow surface on top of Codex CLI.
- Reuse existing `run`, `session`, and `review` primitives where possible.
- Define stop conditions, retry behavior, and stale-session recovery rules.
- Keep the first version local-only and repo-scoped.

## First-Version Shape

Suggested first command:

- `opencodex auto`

Suggested first capabilities:

- start from a goal prompt
- create an execution session chain
- continue until success, failure, or explicit stop limits
- optionally run a final `review`
- recover or mark stale sessions before the next step
- resume a previous partial or failed `auto` workflow into a new parent session
- expose session tree traceability for parent/child workflow lineage

## Non-Goals

The first version should not try to:

- replace Codex CLI as the local engine
- build a distributed job system
- add remote orchestration
- invent a second planning language
- auto-fix every environment problem

## Acceptance Criteria

- A user can start one unattended local workflow from a single command.
- The workflow produces traceable local sessions and artifacts.
- The wrapper can stop safely on terminal failure or configured limits.
- A user can resume a previous partial or failed `auto` workflow without mutating the original session record.
- A user can inspect parent/child workflow lineage through session tree output.
- The design reuses existing session and summary contracts.


## Latest Follow-Up

- `auto --resume <session-id|latest>` now continues earlier unattended workflows by creating a new parent auto session.
- `session tree <id>` now exposes parent/child lineage so unattended chains stay traceable on one machine.
- Retry cleanup now runs `session repair` with immediate stale detection before the next run attempt.
- `session repair` now preserves failed stale review outcomes when review artifacts include partial stdout plus an embedded `stderr:` footer.
- Run summary schemas now allow both string findings and structured findings without relying on `oneOf`.
- Retry cleanup now skips the live parent `auto` session so immediate repair only touches stale siblings and children.
- Resumed `auto` workflows now continue from the stored iteration count instead of restarting iteration numbering at `1`.
- Auto mode now rejects conflicting review target selectors instead of silently choosing one.
