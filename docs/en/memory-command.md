# Memory Command

## Goal

`opencodex memory sync` turns an append-only memory note file into two generated artifacts:

- a latest-view summary document
- a machine-readable state file

This lets recurring schedulers call one openCodex-owned capability instead of carrying repo-local parsing scripts.

## Usage

```bash
node ./bin/opencodex.js memory sync --source "$HOME/.codex/memories/global_session_insights.md"
```

Optional flags:

- `--summary <file>` — override the generated summary path
- `--state <file>` — override the generated state path
- `--cwd <dir>` — resolve relative `--source`, `--summary`, and `--state` paths from a specific working directory
- `--now <timestamp>` — override the generation timestamp for deterministic tests
- `--json` — emit structured output with resolved paths and counts

When `--summary` and `--state` are omitted, openCodex derives them from the source file name.
For a source ending with `_insights.md`, it generates:

- `_summary.md`
- `_summary_state.json`

## Consolidation Rule

- The newest entry for the same topic key becomes the active summary row.
- If a note does not contain `主题键`, openCodex falls back to a normalized title match.
- When legacy title-only notes and newer keyed notes share the same normalized title, openCodex merges them only if that title maps to exactly one explicit topic key.
- The append-only source is never rewritten by this command.

## Recommended Note Shape

For stable consolidation, each entry should include:

- `主题键`
- `关键判断`
- `动作`
- `验证`
- `进度`
- `下一步`
- `可复用规则`
- `关键词`

## Scheduling

`opencodex memory sync` is intentionally just the capability surface.
You can schedule it with:

- Codex desktop automations
- `launchd`
- other local schedulers

The scheduler should call openCodex, not a repo-local parser script.
