# Documentation Index

This folder contains the English documentation for openCodex.

## Installation Guide

### Prerequisites

- Node.js 20 or newer
- Codex CLI installed and already logged in
- macOS if you want the current detached app + `launchd` service flow

### One-Command Bootstrap

If you want Codex or a terminal to install openCodex in one shot, use:

```bash
curl -fsSL https://raw.githubusercontent.com/7788ken/openCodex/main/scripts/install-opencodex.sh | bash
```

This script clones the repository, runs `doctor`, builds a runtime bundle, and installs a detached runtime.

If you already have a local checkout and want to reuse it instead of cloning again:

```bash
OPENCODEX_SOURCE_DIR="$PWD" bash ./scripts/install-opencodex.sh
```

### Option 1: Run From Source

Use this when you want to evaluate or develop openCodex from the repository checkout.

```bash
git clone https://github.com/7788ken/openCodex.git
cd openCodex
node --version
node ./bin/opencodex.js doctor
node ./bin/opencodex.js run "summarize this repository"
```

There is no separate build step yet.
The CLI runs directly from the source checkout.

### Option 2: Install A Detached Runtime

Use this when you want the CLI, app shell, and long-lived services to stop depending on the current checkout.

```bash
git clone https://github.com/7788ken/openCodex.git
cd openCodex
node ./bin/opencodex.js doctor
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

If you intentionally want the installed app shell and CLI shim to keep following your live checkout while you iterate locally, use:

```bash
node ./bin/opencodex.js install detached --link-source
```

This is for development only.
Long-lived services should normally point at a detached installed runtime instead of a source checkout.
The bootstrap script is meant for detached installs, not `--link-source` development setups.

### Related Docs

- `install-command.md` — command flags, outputs, and install flows
- `install-layout.md` — detached runtime layout and upgrade model
- `../README.md` — repository-level quick start and command overview

## Available Documents

- `project-overview.md` — project vision, scope, and principles.
- `roadmap.md` — initial milestones and delivery direction.
- `team.md` — team structure, fixed internal role names, and management rules.
- `session-model.md` — normalized session, summary, and artifact structure for wrapper commands.
- `architecture.md` — layered architecture decision and MVP boundary.
- `command-spec.md` — first-pass CLI command surface and boundaries.
- `doctor-command.md` — local readiness checks, output shape, and exit behavior.
- `review-command.md` — review workflow inputs, artifacts, and summary strategy.
- `auto-command.md` — unattended local workflow chaining on top of existing wrapper commands.
- `remote-command.md` — token-protected mobile message bridge over local HTTP.
- `service-command.md` — macOS launchd service and menu bar app management for Telegram CTO mode.
- `install-command.md` — detached runtime installation and local CLI shim management.
- `im-command.md` — Telegram-first instant-messaging connector for phone-to-openCodex reachability.
- `cto-main-thread-sequence.md` — chat-first sequence diagram for the CTO main thread, workflow, and task flow.
- `profile-policy.md` — current wrapper profiles and Codex CLI policy mapping.
- `cto-soul.md` — editable initialization prompt for the CTO main thread.
- `install-layout.md` — detached install layout for the app surface, CLI shim, and long-lived services.

## Notes

- English is the default language for repository artifacts.
- When a document has a Chinese counterpart, the translated version lives under `../zh/`.
