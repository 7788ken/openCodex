# Doctor Command

## Purpose

`opencodex doctor` checks whether the local machine is ready to run openCodex workflows on top of Codex CLI.
It is a supporting command, not the primary work surface.

## Check List

The first version checks:

- Codex CLI availability
- Codex CLI version detection
- Codex login status
- MCP visibility through `codex mcp list --json`
- Git workspace presence
- `~/.codex/config.toml` availability

## Output Shape

The command produces:

- a normalized session summary
- a structured list of checks
- a saved `doctor-report.json` artifact

Each check includes:

- `name`
- `status`
- `required`
- `details`

## Exit Behavior

- exit code `0` when all required checks pass
- exit code `1` when a required check fails
- warnings do not fail the command

## Non-Goals

The first version does not:

- mutate user setup by default
- auto-fix environment problems
- replace the real `run` workflow
