# Service Command

## Purpose

`opencodex service` turns the Telegram CTO bridge into a local macOS background service.
It installs a user `launchd` agent, keeps the Telegram listener alive across terminal windows, and can also create a lightweight menu bar app.

## First-Version Scope

The first version supports Telegram CTO service management only:

- `opencodex service telegram install`
- `opencodex service telegram status`
- `opencodex service telegram start`
- `opencodex service telegram stop`
- `opencodex service telegram restart`
- `opencodex service telegram set-profile`
- `opencodex service telegram set-workspace`
- `opencodex service telegram relink`
- `opencodex service telegram set-setting`
- `opencodex service telegram supervise`
- `opencodex service telegram send-status`
- `opencodex service telegram workflow-history`
- `opencodex service telegram workflow-detail`
- `opencodex service telegram task-history`
- `opencodex service telegram dispatch-detail`
- `opencodex service telegram reset-cto-soul`
- `opencodex service telegram uninstall`

## What `install` Does

`telegram install` creates and manages these local assets:

- a `launchd` plist under `~/Library/LaunchAgents`
- a wrapper shell script that starts `opencodex im telegram listen --cto`
- a second periodic `launchd` plist and wrapper shell script that run a one-shot Telegram supervisor tick
- a protected environment file with the Telegram bot token and inherited proxy settings
- persistent stdout and stderr logs for the background listener
- persistent stdout and stderr logs for the periodic supervisor tick
- an optional stay-open macOS menu bar app when `--install-menubar` is enabled
- a detached default workspace under `~/.opencodex/workspaces/telegram-cto` when `--cwd` is omitted
- a set of service-local CTO soul files under the service state directory:
  `cto-soul.md`, `cto-chat-soul.md`, and `cto-workflow-soul.md`
- a set of service-local child-agent soul files:
  `cto-reply-agent-soul.md`, `cto-planner-agent-soul.md`, and `cto-worker-agent-soul.md`

By default, `install` refuses to bind the long-lived service to the current source checkout.
Install the service from an installed openCodex CLI, or use `--allow-project-cli` only when you intentionally want a temporary source-coupled setup.

## Inputs

### `telegram install`

- `--cwd <dir>`; optional workspace root. Default: `~/.opencodex/workspaces/telegram-cto`
- `--chat-id <id>`
- `--bot-token <token>` or `OPENCODEX_TELEGRAM_BOT_TOKEN`
- `--cli-path <path>`; optional explicit openCodex CLI entry for the background service
- `--cto-soul-path <path>`; optional explicit shared-layer service-local CTO soul path; the chat/workflow layers default to sibling files in the same directory
- `--poll-timeout <seconds>`
- `--supervisor-interval <seconds>`; periodic supervisor tick interval; supported values: `15`, `30`, `60`, `300`; default: `60`
- `--profile <name>`; default: `full-access`
- `--allow-project-cli`; explicitly allow binding the service to the current project checkout
- `--install-menubar`
- `--open-menubar`
- `--no-load`
- `--json`

### `telegram relink`

- `--cli-path <path>`; required detached openCodex CLI entry
- `--allow-project-cli`; only for an intentional temporary rollback to a source checkout
- `--json`

`telegram relink` keeps the existing service config and chat binding, but rewrites the saved launcher path, wrapper script, and menu bar app bindings to the new CLI entry.
For a detached install created by `opencodex install detached`, prefer the `current/bin/opencodex.js` path so later upgrades can move with the `current` pointer.

### `telegram set-workspace`

- `--cwd <dir>`; required next workspace root for the service
- `--cto-soul-path <path>`; optional override path for the shared-layer service-local CTO soul file; the chat/workflow layers follow it into the same directory
- `--json`

`telegram set-workspace` keeps the installed launcher and chat binding, but rewrites the saved workspace path, wrapper script, and menu bar app bindings.
If the active CTO soul text was still coming from the old workspace, openCodex copies it into the service-local soul file before switching over.
If the new workspace has no `.opencodex/sessions` tree yet, openCodex also copies the existing session history forward so status and tray history stay continuous after the move.

### `telegram status | start | stop | restart | send-status | task-history | uninstall`

- `--state-dir <dir>`
- `--launch-agent-dir <dir>`
- `--applications-dir <dir>`
- `--json`

`telegram start`, `stop`, and `restart` now manage both installed agents together: the long-poll listener and the periodic supervisor tick.

### `telegram supervise`

- `--state-dir <dir>`
- `--launch-agent-dir <dir>`
- `--applications-dir <dir>`
- `--json`

`telegram supervise` runs one installed-service host-supervisor tick by reusing the saved workspace, profile, and Telegram bot environment.
Unlike `start` / `restart`, it does not boot the long-poll listener; it only resumes already persisted CTO workflows and queued host-executor work once.

### `telegram workflow-history`

- `--limit <n>`
- `--json`

### `telegram workflow-detail`

- `--index <n>`
- `--json`

### `telegram task-history`

- `--limit <n>`
- `--json`

### `telegram dispatch-detail`

- `--index <n>`
- `--json`

### `telegram set-setting`

- `--key <name>`
- `--value <value>`
- `--json`

Supported keys in the first version:

- `ui_language` → `en` or `zh`
- `badge_mode` → `tasks`, `workflows`, or `none`
- `refresh_interval_seconds` → `5`, `15`, `30`, or `60`
- `supervisor_enabled` → `on` or `off`
- `supervisor_interval_seconds` → `15`, `30`, `60`, or `300`
- `show_workflow_ids` → `on` or `off`
- `show_paths` → `on` or `off`

### `telegram reset-cto-soul`

- `--json`

`telegram reset-cto-soul` writes the default templates back to all three service-local CTO soul files, which default to `<state-dir>/cto-soul.md`, `<state-dir>/cto-chat-soul.md`, and `<state-dir>/cto-workflow-soul.md`.
It also resets the three child-agent soul files: `<state-dir>/cto-reply-agent-soul.md`, `<state-dir>/cto-planner-agent-soul.md`, and `<state-dir>/cto-worker-agent-soul.md`.

### `telegram uninstall`

- `--remove-menubar`

## Menu Bar App

When `--install-menubar` is enabled, openCodex compiles a small stay-open applet that lives in the macOS menu bar.
The app can:

- show current service state, running / waiting workflow counts, task-history count, main-thread and child-thread counts, and the latest workflow
- switch between `safe`, `balanced`, and `full-access` directly from the menu bar
- start, stop, or restart the Telegram CTO service
- browse recent dispatches directly inside the menu bar app and open a detail dialog for each task
- browse the full workflow history from the menu bar, then inspect a selected workflow without leaving the tray workflow
- browse the full task history from the menu bar, then inspect a selected task without leaving the tray workflow
- change tray settings directly in the UI, including language, badge mode, refresh interval, workflow-id visibility, and path shortcuts
- reveal the task record, raw events, latest task message, repository, service log, latest workflow session, and the editable CTO soul file when needed
- reveal the current service workspace, service log, latest workflow session, and the editable service-local CTO soul files when needed
- restore the default Codex-CLI-based CTO soul template from the tray when needed
- send a Telegram status reply back to the configured CEO chat

## Security Notes

- The Telegram bot token is stored locally in a dedicated env file so `launchd` can restart the service without an interactive shell.
- openCodex writes that env file with owner-only permissions.
- Continue to pair the Telegram CTO listener with a fixed `--chat-id`.

## Operational Notes

- The service reuses the normal `opencodex im telegram listen --cto` path instead of introducing a second execution engine.
- Proxy variables from the current shell are captured into the service env file so Codex CLI and Telegram polling keep working after logout or terminal close.

## Task History and Detail Views

`telegram task-history` exposes the full known dispatch history collected from CTO workflow sessions, not just the latest 5 records shown by `telegram status`.

`telegram dispatch-detail --index <n>` resolves one history entry into a human-readable task detail view, including:

- workflow id and workflow goal
- task id, task title, and task status
- updated time and normalized task result
- highlights, next steps, validation notes, and changed files when present
- recent event activity and the latest saved task message
- direct file paths for the task record, event log, and last-message artifact

The menu bar app uses these two service commands to power the `Browse Task History…` picker and the follow-up detail dialog.
