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
- `opencodex service telegram set-setting`
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
- a protected environment file with the Telegram bot token and inherited proxy settings
- persistent stdout and stderr logs for the background listener
- an optional stay-open macOS menu bar app when `--install-menubar` is enabled

## Inputs

### `telegram install`

- `--cwd <dir>`
- `--chat-id <id>`
- `--bot-token <token>` or `OPENCODEX_TELEGRAM_BOT_TOKEN`
- `--poll-timeout <seconds>`
- `--profile <name>`; default: `full-access`
- `--install-menubar`
- `--open-menubar`
- `--no-load`
- `--json`

### `telegram status | start | stop | restart | send-status | task-history | uninstall`

- `--state-dir <dir>`
- `--launch-agent-dir <dir>`
- `--applications-dir <dir>`
- `--json`

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
- `show_workflow_ids` → `on` or `off`
- `show_paths` → `on` or `off`

### `telegram reset-cto-soul`

- `--json`

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
