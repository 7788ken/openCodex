# openCodex

openCodex is an open-source coding agent project inspired by openclaw.
It is built on top of Codex CLI instead of reimplementing a local coding engine.

The goal of this repository is to explore a practical, repo-aware coding workflow that can:

- understand a task,
- inspect project context,
- propose an execution plan,
- apply targeted changes,
- verify results with focused validation,
- support same-machine task coordination.

## Language Policy

- Project-facing content stays in English.
- Bilingual documentation lives under `docs/en` and `docs/zh`.
- Discussion with the maintainer can happen in Chinese, while repository artifacts remain English-first.

## Product Direction

- `opencodex run` is the primary local work surface.
- `opencodex session` is the local coordination and trace surface.
- `opencodex doctor` is a supporting readiness command, not the core product.
- `opencodex review` is the second-wave local review surface.
- `safe` / `balanced` profiles are available for `run` and `review`, with project defaults from `opencodex.config.json`.

## Current Commands

- `opencodex run` — run a task through Codex CLI and store a normalized session.
- `opencodex session` — inspect local session history, latest handoff state, repair stale sessions based on saved terminal evidence, and artifact paths.
- `opencodex doctor` — validate local readiness for openCodex workflows.
- `opencodex review` — run a repository review and store a normalized review session with structured findings when the report format allows.
- `opencodex auto` — run an unattended local workflow with a parent session, chained child sessions, optional retries, and optional review.
- `opencodex remote` — open a token-protected HTTP bridge so your phone can send messages into the current workspace.
- `opencodex im` — connect openCodex to IM platforms like Telegram without depending on local IP reachability, and route messages into a local CTO orchestration workflow with task splitting, progress replies, and confirmation gates.
- `opencodex service` — install a macOS launchd service and optional menu bar app for the Telegram CTO bridge, with a configurable permission mode.

## Quick Start

```bash
npm test
node ./bin/opencodex.js doctor
node ./bin/opencodex.js run "summarize this repository"
node ./bin/opencodex.js review --uncommitted
node ./bin/opencodex.js auto --review "stabilize this repository"
node ./bin/opencodex.js remote serve --host 0.0.0.0
node ./bin/opencodex.js im telegram listen --bot-token "$OPENCODEX_TELEGRAM_BOT_TOKEN"
node ./bin/opencodex.js im telegram listen --chat-id "$OPENCODEX_TELEGRAM_CHAT_ID" --cto --bot-token "$OPENCODEX_TELEGRAM_BOT_TOKEN"
node ./bin/opencodex.js service telegram install --cwd "$PWD" --chat-id "$OPENCODEX_TELEGRAM_CHAT_ID" --profile full-access --install-menubar --open-menubar
node ./bin/opencodex.js session latest
node ./bin/opencodex.js session repair --stale-minutes 30
node ./bin/opencodex.js session repair
```

## Repository Layout

```text
openCodex/
├── bin/
├── docs/
│   ├── en/
│   └── zh/
├── schemas/
├── src/
├── tests/
└── README.md
```

## Documentation

- English docs index: `docs/en/README.md`
- Chinese docs index: `docs/zh/README.md`

## Status

This repository has moved from project definition into the first implementation pass.
The current version includes the first CLI skeleton, session storage, and wrapper-level validation.
