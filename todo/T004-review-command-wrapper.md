# T004 — Review Command Wrapper

## Objective

Implement `opencodex review` as a wrapper around `codex review`.

## Scope

- Pass through repository context.
- Normalize review output into a stable summary shape.
- Provide a clean exit status for automation.

## Acceptance Criteria

- The wrapper can run a code review in the current repository.
- The result can be consumed by humans and automation.
- The implementation stays thin and avoids feature duplication.
