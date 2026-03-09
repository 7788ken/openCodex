# T012 — Telegram CTO Delegation Loop

## Objective

Let Telegram become a real remote control channel by routing inbound messages into the local Codex CLI workflow instead of stopping at acknowledgement-only replies.

## Why Now

The maintainer wants Telegram to be the active control surface for the current session.
That requires openCodex to hand inbound messages to the local CTO workflow and send the result back over the same chat thread.

## Scope

- Add a `--cto` mode to `opencodex im telegram listen`.
- Require an explicit `--chat-id <id>` when `--cto` is enabled.
- Delegate each inbound Telegram message to `opencodex run`.
- Link delegated child sessions back to the parent Telegram IM session.
- Reply to the same Telegram message with the resulting Codex CLI summary.
- Store delegated run records in `telegram-runs.jsonl`.

## Acceptance Criteria

- `opencodex im telegram listen --cto --chat-id <id>` starts successfully.
- Each accepted Telegram message triggers a local `run` child session.
- The child session stores `parent_session_id` back to the Telegram session.
- Telegram receives both an acknowledgement and a completion reply.
- Delegated runs remain traceable from the parent Telegram session.

## Current Status

- Implemented with `--cto` and optional `--profile <name>`.
- Parent Telegram sessions now record delegated child sessions and add `telegram-runs.jsonl` as an artifact.
- The delegated completion summary is sent back to the same Telegram chat thread.
- This is now a transitional bridge: the next phase is to move the CTO identity and workflow ownership fully into the host supervisor.
- Follow-up tasks `T013`, `T014`, and `T015` will demote sandbox child sessions into advisor/planner/helper roles instead of treating them as the CTO identity.
