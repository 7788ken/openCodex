# Session Model

## Purpose

This document defines the first session and summary model for openCodex.
The model is intentionally small and implementation-friendly.
It must work for `run`, `review`, and `doctor` without introducing command-specific storage formats.

## Design Goals

1. Keep one shared structure for all first-wave commands.
2. Preserve enough metadata for audit and history.
3. Produce a stable summary shape for human and machine use.
4. Keep MVP fields minimal and postpone advanced tracking.

## Status Enum

The session status should use the following values:

- `queued`
- `running`
- `completed`
- `failed`
- `cancelled`
- `partial`

### Status Meaning

- `completed` means the command finished successfully.
- `failed` means the command ended with an error.
- `partial` means the command finished but the requested result is incomplete.
- `cancelled` means the session was stopped before completion.

## Session Metadata

Each session should store the following top-level fields.

### MVP Required Fields

- `session_id`
- `command`
- `status`
- `created_at`
- `updated_at`
- `working_directory`
- `codex_cli_version`
- `input`
- `summary`
- `artifacts`

### Field Notes

- `session_id` — unique local identifier for the openCodex session.
- `command` — one of `run`, `review`, `doctor`, or `auto`.
- `status` — current final or in-progress session state.
- `created_at` — session creation timestamp.
- `updated_at` — latest session update timestamp.
- `working_directory` — repository or local directory where execution happened.
- `codex_cli_version` — detected Codex CLI version used for the session.
- `input` — normalized user or system input for the command.
- `summary` — normalized output summary.
- `artifacts` — structured references to local result files.

### Post-MVP Fields

- `parent_session_id` — used when child sessions belong to a parent unattended workflow such as `auto`; a resumed `auto` session may also point to the previous parent `auto` session for lineage.
- `profile`
- `approval_mode`
- `sandbox_mode`
- `tags`
- `operator`
- `duration_ms`
- `resume_token`

These fields are useful later, but they should not block the first implementation.

## Input Shape

The `input` object should stay small.

### MVP Required Fields

- `prompt`
- `arguments`

### Field Notes

- `prompt` — the primary task or instruction string.
- `arguments` — normalized command options as key-value data.

### Command-Specific Guidance

- `run` should store the task prompt and wrapper flags.
- `review` should store the review target, such as `uncommitted`, `base`, or `commit`.
- `doctor` should store the requested check scope, if any.

## Summary Shape

The `summary` object is the main stable output contract.
It should be readable by humans and predictable for automation.

### MVP Required Fields

- `title`
- `result`
- `status`
- `highlights`
- `next_steps`

### Field Notes

- `title` — one-line summary of the session outcome.
- `result` — short paragraph describing the outcome.
- `status` — copied final status for convenience.
- `highlights` — list of key findings, changes, or checks.
- `next_steps` — list of suggested follow-up actions.

### Optional Fields

- `risks`
- `validation`
- `changed_files`
- `findings`

`findings` may be a list of strings for simple summaries, or a list of structured review findings with fields such as `priority`, `title`, `location`, and `detail`.
These fields are recommended when available, but the model should not require every command to fill them.

## Artifacts

The `artifacts` field should be a list of structured records.
Each artifact should describe a local file produced or referenced by the session.

### MVP Artifact Fields

- `type`
- `path`
- `description`

### Suggested Artifact Types

- `last_message`
- `jsonl_events`
- `output_schema`
- `review_report`
- `doctor_report`
- `log`

## Minimal Storage Layout

A simple local layout is enough for MVP.

```text
.opencodex/
└── sessions/
    └── <session_id>/
        ├── session.json
        ├── events.jsonl
        ├── last-message.txt
        └── artifacts/
```

### Storage Rules

- `session.json` stores the normalized session object.
- `events.jsonl` stores raw machine-readable command events when available.
- `last-message.txt` stores the final assistant message when available.
- `artifacts/` stores extra files such as reports or exported outputs.

## Command Compatibility Notes

### `run`

- Usually produces `events.jsonl`, `last-message.txt`, and one normalized summary.

### `review`

- Usually produces a normalized summary plus review findings or report artifacts.

### `doctor`

- Usually produces a normalized summary plus structured environment check results.

## MVP Boundaries

The first implementation should not require:

- real-time event streaming state machines,
- cross-device sync,
- multi-user ownership models,
- remote artifact storage,
- session resume beyond basic metadata retention.

## Recommendation

Build the first implementation around a single `session.json` contract and a small artifact directory.
This keeps the model easy to implement while leaving room for future session history, resume, and gateway features.
