# Review Command

## Purpose

`opencodex review` wraps `codex review` and stores the result as a local openCodex session.
It is the first review-oriented workflow surface in the project.

## Inputs

The command accepts one review selector plus an optional custom prompt.

### Supported Selectors

Exactly one of these selectors may be used per invocation.

- `--uncommitted`
- `--base <branch>`
- `--commit <sha>`

### Additional Flags

- `--title <text>`
- `--output <file>`
- `--cwd <dir>`

## Artifacts

Each review session stores:

- a normalized `session.json`
- a raw `review-report.txt`
- a stderr log when available

When `codex review` fails after already printing partial stdout, openCodex keeps both stdout and stderr details in the main report artifact so failure diagnosis is not hidden behind the separate log.
- an exported summary file when `--output` is used

## Summary Strategy

`codex review` does not currently provide the same structured schema flow as `codex exec --output-schema`.
For MVP, openCodex stores the full raw review text and generates a normalized summary.

The wrapper prefers the final `codex` section when it exists, so transport metadata and transcript scaffolding do not dominate the summary.
When the report contains a standard `Full review comments:` block, openCodex also extracts structured findings with:

- `priority`
- `title`
- `location.path` / `location.start_line` / `location.end_line`
- `detail`

If the report does not include that standard block, openCodex still preserves a non-clean plain-text conclusion as a string finding. Explicit clean conclusions remain finding-free, and positive phrases only count as clean when the whole conclusion is still clearly issue-free.

The normalized summary keeps:

- a stable title
- a result line
- a status field
- a short highlight list
- follow-up next steps

## Exit Behavior

- exit code `0` when the wrapped `codex review` succeeds
- exit code `1` when the wrapped command fails
- the session is still written even when review fails

## Non-Goals

The first version does not try to:

- replace Codex review logic
- invent a new review engine
- fully normalize every possible review format into a rigid schema
