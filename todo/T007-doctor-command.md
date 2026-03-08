# T007 — Doctor Command

## Objective

Create `opencodex doctor` to validate whether the local machine is ready to run openCodex.

## Scope

- Check whether Codex CLI is installed.
- Check version compatibility.
- Check authentication status when possible.
- Check required local configuration files.

## Acceptance Criteria

- The command reports clear pass/fail checks.
- The command provides next-step guidance for broken setup.
- The command does not mutate user state unless explicitly requested.
