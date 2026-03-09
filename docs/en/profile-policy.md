# Profile Policy

## Purpose

openCodex profiles provide a small policy layer on top of Codex CLI.
The policy surface remains intentionally small and predictable.

## Available Profiles

### `safe`

- approval: `never`
- sandbox: `read-only`
- reasoning effort: `medium`

This profile is intended for inspection, review, and low-risk repository analysis.

### `balanced`

- approval: `never`
- sandbox: `workspace-write` for `run`
- sandbox: `read-only` for `review`
- reasoning effort: `medium`

This profile is the default for normal wrapper usage.
It keeps `run` useful for local work while keeping `review` read-only.

### `full-access`

- approval: `never`
- sandbox: `danger-full-access`
- reasoning effort: `medium`

This profile is intended for same-machine tasks that need broad local access.
It is the default mode for the Telegram CTO bridge and its menu bar service controls.

## Project Defaults

A repository can set project-level default profiles with `opencodex.config.json`.
openCodex looks for this file in the effective working directory and then walks upward through parent directories.

```json
{
  "default_profile": "balanced",
  "commands": {
    "run": { "profile": "balanced" },
    "review": { "profile": "safe" }
  }
}
```

### Resolution Order

- CLI `--profile`
- `commands.<command>.profile`
- `default_profile`
- built-in default: `balanced`

## Current Scope

The current version applies profiles to:

- `opencodex run`
- `opencodex review`
- delegated Telegram CTO runs
- Telegram `launchd` service and menu bar controls

## Non-Goals

The current version does not yet provide:

- custom user-defined profile definitions
- advanced approval policy composition
- per-tool granular allowlists
