# T001 — Codex CLI Capability Inventory

## Objective

Document the stable Codex CLI integration points that openCodex can safely build on.

## Scope

- Inspect `codex exec` machine-readable output paths.
- Inspect `--json` and `--output-schema` support.
- Inspect `mcp`, `mcp-server`, and `app-server` entry points.
- Record version-sensitive areas that may require compatibility guards.

## Deliverables

- A short capability matrix.
- A list of preferred integration surfaces.
- A list of unstable or risky integration surfaces to avoid.

## Acceptance Criteria

- The inventory clearly distinguishes stable vs. experimental interfaces.
- The output recommends what openCodex should depend on first.
- The result is written for product and implementation decisions, not just raw command dumps.
