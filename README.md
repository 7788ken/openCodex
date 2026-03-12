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
- keep the CTO role on the host machine while sandbox child sessions stay subordinate helpers.
- let the CTO support chat, discussion, and research before switching into orchestration.

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
- `opencodex im` — connect openCodex to IM platforms like Telegram without depending on local IP reachability, and route messages into a host-resident CTO supervisor workflow with task splitting, progress replies, and confirmation gates.
- `opencodex service` — install a macOS launchd service and optional menu bar app for the Telegram CTO bridge, with a configurable permission mode and host-supervisor control loop.
- `opencodex install` — create or inspect a detached local runtime, plus a thin `OpenCodex.app` shell and CLI shim that stay off the development checkout.

## Installed Product Boundary

openCodex can ship as a menu bar app and a CLI at the same time, but they should resolve to one detached installed runtime.
The source checkout remains a development workspace only.
See `docs/en/install-layout.md` for the current packaging direction.

## Installation Guide

### Prerequisites

- Node.js 20 or newer
- Codex CLI installed and already logged in
- macOS if you want to use the current detached app + `launchd` service flow

### One-Command Bootstrap

If you want Codex or a terminal to install openCodex in one shot, use:

```bash
curl -fsSL https://raw.githubusercontent.com/7788ken/openCodex/main/scripts/install-opencodex.sh | bash
```

This bootstrap script will:

- clone openCodex
- run `doctor`
- build a runtime bundle
- install a detached runtime, CLI shim, and app shell

If you already have a local checkout and want to reuse it instead of cloning again:

```bash
OPENCODEX_SOURCE_DIR="$PWD" bash ./scripts/install-opencodex.sh
```

### Run From Source

Use this path when you are developing openCodex itself.

```bash
git clone https://github.com/7788ken/openCodex.git
cd openCodex
node --version
node ./bin/opencodex.js doctor
node ./bin/opencodex.js run "summarize this repository"
```

There is no build step yet.
The CLI runs directly from the checkout.

### Install A Detached Local Runtime

Use this path when you want the CLI, app shell, and long-lived services to stop depending on the current repository checkout.

```bash
cd /path/to/openCodex
node ./bin/opencodex.js install bundle
node ./bin/opencodex.js install detached --bundle ./dist/opencodex-runtime-<version>-<timestamp>.tgz
node ./bin/opencodex.js install status
open "$HOME/Applications/OpenCodex.app"
```

The detached install currently defaults to:

- runtime root: `~/Library/Application Support/OpenCodex`
- CLI shim: `~/.local/bin/opencodex`
- app shell: `~/Applications/OpenCodex.app`

### Development Shortcut

If you intentionally want the installed app shell and CLI shim to keep following your live checkout while you are iterating locally, use:

```bash
node ./bin/opencodex.js install detached --link-source
```

This is for development only.
Long-lived services should normally point at a detached installed runtime instead of a source checkout.
The bootstrap script is meant for detached installs, not `--link-source` development setups.

## Quick Start

```bash
npm test
node ./bin/opencodex.js doctor
node ./bin/opencodex.js install detached
open "$HOME/Applications/OpenCodex.app"
node ./bin/opencodex.js run "summarize this repository"
node ./bin/opencodex.js review --uncommitted
node ./bin/opencodex.js auto --review "stabilize this repository"
node ./bin/opencodex.js remote serve --host 0.0.0.0
node ./bin/opencodex.js im telegram listen --bot-token "$OPENCODEX_TELEGRAM_BOT_TOKEN"
node ./bin/opencodex.js im telegram listen --chat-id "$OPENCODEX_TELEGRAM_CHAT_ID" --cto --bot-token "$OPENCODEX_TELEGRAM_BOT_TOKEN"
# Long-lived services should normally be installed from an installed openCodex CLI.
# Use --allow-project-cli only when you intentionally want this source checkout to stay coupled to the service.
node ./bin/opencodex.js service telegram install --cwd "$PWD" --chat-id "$OPENCODEX_TELEGRAM_CHAT_ID" --profile full-access --install-menubar --open-menubar --allow-project-cli
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
