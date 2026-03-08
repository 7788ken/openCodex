# Command Specification

## Scope

openCodex is a thin CLI layer built on top of Codex CLI.
The first version should wrap stable non-interactive Codex CLI interfaces instead of duplicating engine behavior.

## Command Set

### `opencodex run`

**Purpose**

Run a task against the current repository through Codex CLI and return a normalized openCodex summary.

**Preferred backend**

- `codex exec --json --output-schema`

**Minimal flags**

- `--profile <name>`
- `--schema <file>`
- `--output <file>`
- `--cwd <dir>`

**Non-goals**

- replacing Codex CLI execution logic
- parsing interactive TUI output
- inventing a second task language for MVP

### `opencodex review`

**Purpose**

Run repository review flows through Codex CLI and return a stable openCodex review summary.

**Preferred backend**

- `codex review`

**Minimal flags**

- `--uncommitted`
- `--base <branch>`
- `--commit <sha>`
- `--output <file>`

**Non-goals**

- implementing a separate review engine
- supporting every advanced review mode in v1
- replacing native Codex review controls

### `opencodex doctor`

**Purpose**

Check whether the local machine is ready to run openCodex on top of Codex CLI.

**Expected checks**

- Codex CLI availability
- Codex CLI version
- local authentication readiness when detectable
- required config or workspace prerequisites

**Minimal flags**

- `--json`
- `--verbose`
- `--fix` (reserved for later)

**Non-goals**

- mutating user setup by default
- hiding failing checks
- managing remote infrastructure

### `opencodex session`

**Purpose**

Inspect or manage local session metadata produced by openCodex commands.

**Initial scope**

- list sessions
- show a session summary
- show related artifact paths

**Minimal flags**

- `list`
- `show <id>`
- `--json`

**Non-goals**

- remote synchronization in MVP
- multi-device session management
- deep replay tooling in v1

## Command Design Rules

- Keep the top-level command set small.
- Prefer passthrough to stable Codex CLI capabilities.
- Normalize final summaries instead of reimplementing execution internals.
- Avoid flags that only mirror rarely used upstream options in the first release.
