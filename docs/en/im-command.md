# IM Command

## Purpose

`opencodex im` connects openCodex to chat platforms without depending on a changing local IP address.
The first provider is Telegram because it supports long polling from the local machine with no inbound public webhook requirement.

## First-Version Scope

The first version supports Telegram only:

- `opencodex im telegram listen`
- `opencodex im telegram inbox`
- `opencodex im telegram send`

## Telegram Flow

`telegram listen` does this:

- calls `getMe` to verify the bot token
- checks `getWebhookInfo` so long polling does not silently conflict with an active webhook
- polls `getUpdates` with long polling
- stores normalized inbound messages in a session artifact
- sends an automatic acknowledgement back to the same Telegram chat
- optionally turns each inbound message into a CTO orchestration workflow with default `full-access` worker permissions
- plans the request into non-blocking tasks, starts ready tasks in the background, and keeps waiting workflows visible in local sessions
- injects a default maintenance task to inspect and repair historical stuck CTO workflows when stale workflow state is detected
- sends an acknowledgement, task-plan update, and final result or confirmation request back to the same Telegram chat
- answers workflow-status questions without spawning a new workflow when the CEO asks about the latest or a referenced CTO workflow
- answers `recent tasks` / `task history` style questions with a compact mobile-friendly task-history summary
- keeps the bridge visible in the normal session store

`telegram inbox` reads the latest stored messages from the newest Telegram IM session.
`telegram send` sends a reply message back to a specific Telegram chat.

## Inputs

### `telegram listen`

- `--cwd <dir>`
- `--bot-token <token>` or `OPENCODEX_TELEGRAM_BOT_TOKEN`
- `--chat-id <id>` to restrict inbound messages to one chat
- `--poll-timeout <seconds>`
- `--clear-webhook`
- `--cto` to delegate each message to local Codex CLI as the openCodex CTO
- `--profile <name>` to control the delegated `opencodex run` profile in `--cto` mode; default: `full-access`

`--cto` requires `--chat-id <id>` for safety.
This prevents arbitrary Telegram users from driving the local machine.

### `telegram inbox`

- `--cwd <dir>`
- `--limit <n>`
- `--json`

### `telegram send`

- `--cwd <dir>`
- `--bot-token <token>` or `OPENCODEX_TELEGRAM_BOT_TOKEN`
- `--chat-id <id>`
- `--reply-to-message-id <id>`
- message text as positionals

## Stored Artifacts

Each Telegram listen session stores:

- `telegram-updates.jsonl` — normalized inbound messages
- `telegram-replies.jsonl` — acknowledgement and result replies
- `telegram-state.json` — last polling offset and listener state
- `telegram-log.txt` — listener lifecycle log
- `telegram-runs.jsonl` — delegated CTO planner and task run records when `--cto` is enabled

In `--cto` mode, each inbound Telegram message now creates a dedicated `cto` workflow session under the same local session store. That workflow can contain planner and worker `run` child sessions, remain waiting for a CEO confirmation, and resume from the next Telegram reply in the same chat.

## Security Notes

- Treat the bot token like a password.
- If a webhook is already configured for the same bot, openCodex fails fast unless `--clear-webhook` is explicitly passed.
- `--cto` mode should always be paired with a specific `--chat-id`.
- This design keeps the local machine on outbound long polling, so phone connectivity does not depend on a stable local IP.

## Official Reference

- Telegram Bot API: `https://core.telegram.org/bots/api`

## Telegram CTO Follow-up Queries

In `--cto` mode, the same chat can ask lightweight follow-up questions without creating a new workflow.

Current supported follow-up patterns include:

- workflow-status questions such as `安排了哪些任务`, `what tasks`, `workflow status`, or `task status`
- explicit workflow references such as `Workflow: cto-... 安排了哪些任务`
- recent-history questions such as `最近任务`, `任务历史`, `recent tasks`, or `task history`

Status queries return the matching workflow summary. Recent-history queries return a compact list of the latest known CTO task records for that Telegram chat.
