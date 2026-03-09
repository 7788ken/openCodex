# Auto Command

## Purpose

`opencodex auto` is the first unattended local workflow surface.
It chains existing openCodex commands so local work can continue without manual handoff between each step.

## First-Version Flow

The first version runs these steps in order:

- `session repair`
- `run`
- optional `review`

This keeps the implementation thin and reuses the existing session and summary contracts.
The parent `auto` session records child sessions and per-step output artifacts so the unattended chain stays traceable. Child `run` and `review` sessions also carry `parent_session_id` back-links to that parent session. When `--resume` is used, openCodex creates a new parent `auto` session and links it back to the previous `auto` session instead of mutating the old record.

## Inputs

- a required goal prompt, unless `--resume <session-id|latest>` is used
- `--cwd <dir>`
- `--profile <name>`
- `--review`
- `--uncommitted`
- `--base <branch>`
- `--commit <sha>`
- `--skip-repair`
- `--max-iterations <n>`
- `--run-retries <n>`
- `--fail-on-review`
- `--resume <session-id|latest>`

## Resume Behavior

- `--resume <id>` resumes a previous `partial` or `failed` `auto` session by creating a new parent workflow session.
- `--resume latest` picks the latest resumable `auto` session in the target working directory.
- Resume reuses the stored prompt and workflow arguments from the previous session; if findings remain, the follow-up run prompt includes them.
- Resume continues from the stored `iteration_count`, so iteration labels and the `--max-iterations` budget continue across the new parent session.
- Use `opencodex session tree <id>` to inspect the resulting lineage across parent and child sessions.

## Review Behavior

- If `--review` is set without a review target, openCodex runs `review --uncommitted`.
- `--uncommitted`, `--base`, and `--commit` are mutually exclusive in auto mode, matching `opencodex review`.
- If `--base` or `--commit` is provided, that target is used for the review step.
- If no review flag or target is provided, the workflow stops after `run`.
- If `--max-iterations` is greater than `1`, openCodex keeps iterating with review feedback until findings clear or the limit is reached.
- Non-clean plain-text review conclusions also become findings, so `auto` does not treat an unparsed review as a clean pass.
- If `--run-retries` is greater than `0`, each unattended `run` step can retry after failure before the parent workflow stops.
- Retry cleanup repairs fresh stale child sessions immediately, while skipping the currently running parent `auto` session itself.
- If `--fail-on-review` is set, remaining findings after the final iteration make the parent auto session fail.

## Exit Behavior

- exit code `0` when every executed step succeeds
- non-zero exit code when any step fails
- previously completed child sessions remain stored locally

## Non-Goals

The first version does not yet provide:

- multi-step autonomous planning
- retry policies beyond command failure propagation
- background daemons or schedulers
- distributed execution
