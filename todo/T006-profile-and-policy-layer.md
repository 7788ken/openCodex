# T006 — Profile and Policy Layer

## Objective

Design a small configuration layer that maps openCodex presets to Codex CLI behavior.

## Scope

- Define profile names.
- Map profiles to sandbox and approval defaults.
- Allow project-level conventions without rebuilding the engine.

## Example Profiles

- `safe`
- `balanced`
- `fast`

## Acceptance Criteria

- The design is understandable without reading internal code.
- Profiles map cleanly to Codex CLI flags or config.
- The implementation path is low-risk and maintainable.
