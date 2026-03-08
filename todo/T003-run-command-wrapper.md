# T003 — Run Command Wrapper

## Objective

Implement `opencodex run` as a structured wrapper around `codex exec`.

## Scope

- Forward task input into `codex exec`.
- Support machine-readable output capture.
- Add a normalized final summary format.
- Preserve Codex CLI as the execution engine.

## Acceptance Criteria

- A user can run one command and trigger Codex CLI execution.
- The wrapper stores or prints a clean summary of the result.
- The implementation does not parse fragile TUI output.
