# T011 — Telegram IM Connector

## Objective

Let the maintainer reach openCodex from a phone through Telegram instead of relying on a changing local IP address.

## Why Now

The maintainer explicitly rejected a local-IP gateway as the main remote path.
Telegram is the fastest official IM route because the local machine can use long polling and does not need an inbound public webhook.

## Scope

- Add an `im` command surface.
- Support Telegram `listen`, `inbox`, and `send`.
- Store inbound Telegram messages as session artifacts.
- Keep the implementation outbound-only and dependency-light.

## Acceptance Criteria

- A Telegram bot token can start a local listener.
- The listener stores inbound Telegram messages in durable session artifacts.
- The latest Telegram messages can be inspected from the CLI.
- openCodex can send a reply message back to a Telegram chat.

## Current Status

- MVP implemented with `opencodex im telegram listen`, `inbox`, and `send`.
- Listener state is stored in `telegram-state.json`, while normalized inbound messages are saved in `telegram-updates.jsonl`.
- Webhook conflicts now fail fast unless the user explicitly opts into `--clear-webhook`.
