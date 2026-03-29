# Memory Command

## Goal

`opencodex memory` now exposes two subcommands:

- `sync`: rebuild a latest-view summary and a machine-readable state file from append-only notes
- `compact`: move stale superseded history out of the active source into archives, then rebuild summary/state

This lets recurring schedulers call one openCodex-owned capability instead of carrying repo-local parsing scripts.

## Usage

```bash
node ./bin/opencodex.js memory sync --source "$HOME/.codex/memories/global_session_insights.md"

node ./bin/opencodex.js memory compact --source "$HOME/.codex/memories/global_session_insights.md"
```

`sync` flags:

- `--summary <file>` — override the generated summary path
- `--state <file>` — override the generated state path
- `--cwd <dir>` — resolve relative `--source`, `--summary`, and `--state` paths from a specific working directory
- `--now <timestamp>` — override the generation timestamp for deterministic tests
- `--json` — emit structured output with resolved paths and counts

`compact` flags:

- `--archive-dir <dir>` — override the archive root directory, defaulting to `archives/` beside the source
- `--retention-days <days>` — archive only entries older than this window when a newer record already supersedes them; default `7`
- `--summary <file>` — override the regenerated summary path after compaction
- `--state <file>` — override the regenerated state path after compaction
- `--cwd <dir>` — resolve relative paths from a specific working directory
- `--now <timestamp>` — override the current time for deterministic tests
- `--json` — emit structured output with active/archive counts and paths

When `--summary` and `--state` are omitted, openCodex derives them from the source file name.
For a source ending with `_insights.md`, it generates:

- `_summary.md`
- `_summary_state.json`

## Consolidation and Retention Rules

- The newest entry for the same topic key becomes the active summary row.
- If a note does not contain `主题键`, openCodex falls back to a normalized title match.
- When legacy title-only notes and newer keyed notes share the same normalized title, openCodex merges them only if that title maps to exactly one explicit topic key.
- `sync` never rewrites the append-only source.
- `compact` preserves the newest active record for every topic, then archives only older superseded entries.
- Archive output is split by `project / month`, for example `archives/opencodex/2026-03.md`.
- Generated summaries are grouped by project so the active view stays shorter and easier to scan.

## Recommended Note Shape

For stable consolidation, each entry should include:

- `项目`
- `主题键`
- `关键判断`
- `动作`
- `验证`
- `进度`
- `下一步`
- `可复用规则`
- `关键词`

## Scheduling

`opencodex memory` is intentionally just the capability surface.
You can schedule it with:

- Codex desktop automations
- `launchd`
- other local schedulers

The scheduler should call openCodex, not a repo-local parser script.

## Recommended Strategy

If memory volume grows quickly, do not keep hot notes, cold history, and long-term rules in one flat append-only file forever. A better operating model is:

- keep recent detailed notes and each topic's newest state in the active source
- move stale superseded history into archives
- write an explicit `项目` field so both summaries and archives can segment by project
- trigger compaction using both time and file-size pressure instead of a day-based rule alone
