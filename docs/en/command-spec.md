# Command Specification

## Scope

openCodex is a thin CLI layer built on top of Codex CLI.
The first version should wrap stable non-interactive Codex CLI interfaces instead of duplicating engine behavior.

## Command Set

### `opencodex run`

**Purpose**

Run real local work against the current repository through Codex CLI and return a normalized openCodex summary.

**Preferred backend**

- `codex exec --json --output-schema`

**Minimal flags**

- `--profile <name>`
- When omitted, openCodex falls back to `opencodex.config.json` in the current directory or a parent directory.
- `--schema <file>`
- `--output <file>`
- `--cwd <dir>`

**Non-goals**

- replacing Codex CLI execution logic
- parsing interactive TUI output
- inventing a second task language for MVP

### `opencodex session`

**Purpose**

Inspect local sessions and provide the same-machine coordination surface for openCodex runs.

**Initial scope**

- list sessions
- show a session summary
- show the latest session for same-machine handoff
- show a session tree for parent/child lineage
- repair stale running sessions from terminal evidence and command-specific artifacts
- show related artifact paths

**Minimal flags**

- `list`
- `show <id>`
- `latest`
- `tree <id>`
- `repair`
- `--json`
- `--stale-minutes <n>`

**Non-goals**

- remote synchronization in MVP
- multi-device session management
- deep replay tooling in v1

### `opencodex auto`

**Purpose**

Run a first unattended local workflow by chaining stable openCodex wrapper commands.

**Initial scope**

- repair stale sessions before execution
- run the main local task
- optionally run a follow-up review
- resume a previous partial or failed `auto` workflow into a new parent session
- continue iteration numbering and max-iteration budgeting across resumed parents

**Minimal flags**

- `--profile <name>`
- `--cwd <dir>`
- `--review`
- `--uncommitted`
- `--base <branch>`
- `--commit <sha>`
- `--skip-repair`
- `--max-iterations <n>`
- `--run-retries <n>`
- `--fail-on-review`
- `--resume <session-id|latest>`

**Non-goals**

- long-running background agents in v1
- distributed job execution
- replacing `run` as the actual Codex execution engine

### `opencodex remote`

**Purpose**

Receive remote messages from a phone through a token-protected HTTP bridge tied to the current workspace.

**Initial scope**

- run a lightweight local HTTP server
- accept mobile message submission with token auth
- save inbound messages as local artifacts
- expose a CLI inbox view for the latest remote session
- expose a CLI status snapshot with deployment checks and troubleshooting hints

**Minimal flags**

- `serve`
- `inbox`
- `status`
- `--cwd <dir>`
- `--host <host>`
- `--port <n>`
- `--token <value>`
- `--limit <n>`
- `--json`

**Non-goals**

- internet relay infrastructure in v1
- background push notifications
- direct live control of a Codex turn from the phone

### `opencodex im`

**Purpose**

Connect openCodex to chat platforms without relying on local IP reachability.

**Initial scope**

- support Telegram long polling as the first provider
- store inbound IM messages as session artifacts
- expose inbox inspection and outbound replies from the CLI
- keep the machine on outbound-only connectivity where possible

**Minimal flags**

- `telegram listen`
- `telegram inbox`
- `telegram send`
- `--cwd <dir>`
- `--bot-token <token>`
- `--chat-id <id>`
- `--poll-timeout <seconds>`
- `--clear-webhook`
- `--cto`
- `--profile <name>` for delegated CTO worker runs inside the Telegram workflow
- `--limit <n>`
- `--json`

`--cto` requires `--chat-id <id>` for safety. In this mode openCodex keeps a CTO orchestration thread per chat, can pause for confirmation, and resumes from the next Telegram reply.

**Non-goals**

- replacing the local openCodex session model
- adding hosted relay infrastructure in v1
- supporting every IM provider in the first pass

### `opencodex install`

**Purpose**

Create and inspect a detached local runtime so the installed CLI and long-lived services stop depending on a source checkout.

**Initial scope**

- create a portable runtime bundle for release handoff
- install a versioned detached runtime under a user-owned root
- rewrite a `current` pointer to the active installed runtime
- create a CLI shim for shell usage
- compile a thin `OpenCodex.app` shell that launches the same detached runtime
- report the runtime CLI path that `service relink` should use
- prune stale install slots while preserving the active runtime target

**Minimal flags**

- `bundle`
- `detached`
- `status`
- `prune`
- `--output <path>`
- `--root <dir>`
- `--bin-dir <dir>`
- `--applications-dir <dir>`
- `--bundle <path>`
- `--name <id>`
- `--keep <n>`
- `--dry-run`
- `--link-source`
- `--force`
- `--json`

**Non-goals**

- shipping a notarized desktop app in the first pass
- mutating existing services automatically
- defining a system-wide installer in v1

### `opencodex service`

**Purpose**

Install and control a macOS background service for the Telegram CTO bridge, with an optional menu bar app.

**Initial scope**

- install a user `launchd` agent for `opencodex im telegram listen --cto`
- persist the Telegram bot token and proxy-related env in a dedicated env file
- expose start / stop / restart / status / send-status / task-history / dispatch-detail / uninstall controls
- optionally compile a lightweight stay-open menu bar app with task browsing and task-detail dialogs

**Minimal flags**

- `telegram install`
- `telegram status`
- `telegram start`
- `telegram stop`
- `telegram restart`
- `telegram send-status`
- `telegram set-workspace`
- `telegram relink`
- `telegram task-history`
- `telegram dispatch-detail`
- `telegram uninstall`
- `--cwd <dir>`
- `--chat-id <id>`
- `--bot-token <token>`
- `--cli-path <path>`
- `--cto-soul-path <path>`
- `--poll-timeout <seconds>`
- `--profile <name>`
- `set-profile --profile <name>`
- `set-workspace --cwd <path>`
- `relink --cli-path <path>`
- `--allow-project-cli`
- `--install-menubar`
- `--open-menubar`
- `--no-load`
- `--remove-menubar`
- `--json`

**Non-goals**

- replacing `im telegram listen` as the actual Telegram engine
- building a hosted relay service
- shipping a fully custom native desktop client in v1

### `opencodex doctor`

**Purpose**

Check whether the local machine is ready to run openCodex on top of Codex CLI.
This is a support command, not the primary work surface.

**Expected checks**

- Codex CLI availability
- Codex CLI version
- local authentication readiness when detectable
- required config or workspace prerequisites

**Minimal flags**

- `--json`
- `--verbose`
- `--cwd <dir>`
- `--fix` (reserved for later)

**Non-goals**

- mutating user setup by default
- hiding failing checks
- replacing the main `run` workflow

### `opencodex review`

**Purpose**

Run repository review flows through Codex CLI and return a stable openCodex review summary.

**Preferred backend**

- `codex review`

**Minimal flags**

- `--profile <name>`
- When omitted, openCodex falls back to `opencodex.config.json` in the current directory or a parent directory.
- `--uncommitted`
- `--base <branch>`
- `--commit <sha>`
- `--title <text>`
- `--output <file>`
- `--cwd <dir>`

**Non-goals**

- implementing a separate review engine
- supporting every advanced review mode in v1
- replacing native Codex review controls

## Command Design Rules

- Keep the top-level command set small.
- Prefer passthrough to stable Codex CLI capabilities.
- Make `run` the primary path for real local work.
- Use `session` to retain local traceability and handoff context.
- Keep `doctor` as a supporting guardrail, not the product center.
- Avoid flags that only mirror rarely used upstream options in the first release.
