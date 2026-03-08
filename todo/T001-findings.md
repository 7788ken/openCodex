# T001 Findings — Codex CLI Capability Inventory

## Environment Snapshot

- Codex CLI version: `0.111.0`
- Inventory date: `2026-03-08`

## Stable MVP Integration Surfaces

### Primary Execution Surface

- `codex exec`
- `codex exec --json`
- `codex exec --output-schema <FILE>`
- `codex exec --output-last-message <FILE>`

These flags provide the safest machine-readable path for openCodex.
They should be treated as the default foundation for `opencodex run`.

### Secondary Execution Surface

- `codex review`

This should be the second wrapped command for openCodex after `run`.
It enables review workflows without rebuilding a review engine.

### Ecosystem / Management Surface

- `codex mcp`
- `codex mcp list --json`
- `codex mcp add --url <URL>`
- `codex mcp add -- <COMMAND>...`

This surface is useful for environment inspection and ecosystem management, but it should not be the first MVP dependency.

## Deferred or High-Risk Surfaces

### Phase 2 Candidates

- `codex mcp-server`

This is useful for future system-level integration, but not required for MVP.

### Avoid in MVP Core Path

- `codex app-server`
- `codex cloud`
- any strategy that depends on parsing interactive TUI text output
- `--dangerously-bypass-approvals-and-sandbox` as a default behavior

## MVP Dependency Order

1. `codex exec --json --output-schema`
2. `codex review`
3. `codex mcp`
4. `codex mcp-server`

## Product Decision

openCodex should be built as a thin orchestration layer on top of Codex CLI.
The MVP must wrap stable non-interactive interfaces and avoid reimplementing a local coding engine.

## Evidence Notes

- `codex exec` is explicitly documented as a non-interactive entry point.
- `--json` is explicitly documented as JSONL output.
- `--output-schema` is explicitly exposed as a structured response contract.
- `codex review` is explicitly exposed as a non-interactive review command.
- `codex app-server` is explicitly marked experimental.
