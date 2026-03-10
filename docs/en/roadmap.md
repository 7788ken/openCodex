# Roadmap

## Phase 0 — Project Setup

- Define repository structure.
- Establish bilingual documentation rules.
- Write the initial product overview.

## Phase 1 — CLI Skeleton

- Add a basic CLI entry point.
- Support a `run` command for local tasks.
- Print structured execution summaries.

## Phase 2 — Core Workflow

- Add repository search utilities.
- Add simple planning primitives.
- Add patch application support.

## Phase 3 — Validation Loop

- Add focused command execution.
- Capture command outputs.
- Report validation status in a clear summary.

## Phase 4 — Unattended Execution

- Add a first unattended local workflow surface.
- Reuse `run`, `session`, and `review` for chained execution.
- Add safe stop limits and stale-session recovery.

## Phase 5 — Installed Product Surface

- Define a detached installed runtime root.
- Let the app surface and CLI surface coexist on the same runtime.
- Keep long-lived services attached to the installed launcher instead of a source checkout.
