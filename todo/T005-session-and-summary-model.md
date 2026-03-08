# T005 — Session and Summary Model

## Objective

Define how openCodex stores session metadata, summaries, and result artifacts.

## Scope

- Define a normalized session structure.
- Define summary fields for success, failure, and partial completion.
- Define where local artifacts should be stored.

## Acceptance Criteria

- The model works for both `run` and `review`.
- The structure supports future session resume or history features.
- The schema is simple enough to implement early.
