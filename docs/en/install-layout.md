# Installed Product Layout

## Objective

Define a detached installation layout where the openCodex app surface, CLI surface, and long-lived services can coexist without binding production runtime ownership to a source checkout.

## Core Rule

openCodex can ship as both:

- a desktop or menu bar application
- a CLI entry such as `opencodex`

They should coexist, but they must not drift apart.
The installed app, CLI shim, and `launchd` services should all resolve to the same detached runtime root.
The source checkout remains a development workspace, not the default launcher for persistent installs.
The preferred handoff between those worlds is an explicit runtime bundle, not a live copy from the active checkout.

## First Supported Layout

The first supported distribution target should be a user-scoped macOS install.
That keeps permissions simple and matches the current Telegram service model.

Suggested layout:

```text
~/Library/Application Support/OpenCodex/
├── installs/
│   └── <version>/
│       ├── bin/
│       │   └── opencodex.js
│       ├── package.json
│       ├── src/
│       └── resources/
└── current -> installs/<version>

~/Applications/OpenCodex.app
~/.local/bin/opencodex -> ~/Library/Application Support/OpenCodex/current/bin/opencodex.js
~/.opencodex/
├── service/
├── sessions/
└── ...
```

## Responsibility Split

- `~/Library/Application Support/OpenCodex/current` is the runtime of record.
- `~/Applications/OpenCodex.app` is a thin host shell around that runtime. In the current implementation it is a generated AppleScript app that launches detached CLI flows.
- `~/.local/bin/opencodex` is a thin CLI shim to the same runtime.
- `~/.opencodex` stores mutable user state and must stay outside the installed runtime tree.

## Service Binding Rules

- `launchd` wrappers and tray actions should point to the detached installed CLI, not to a repository checkout.
- In practice they should prefer `current/bin/opencodex.js` instead of a version-slot path so upgrades can move with the `current` pointer.
- `service.json` should record launcher provenance so `doctor` and `service status` can detect checkout-coupled installs.
- `service relink` is the repair path for legacy installs that still point at a source checkout.

## Upgrade Model

Preferred release/install handoff:

1. Run `opencodex install bundle` from the source tree being prepared for release.
2. Move that bundle artifact to the target machine or operator handoff point.
3. Run `opencodex install detached --bundle <path>` from the packaged bundle.

Runtime upgrade after installation:

1. Install a new version under `installs/<version>`.
2. Atomically move the `current` pointer.
3. Keep the app shell and CLI shim pointing at `current`.
4. Restart or refresh long-lived services only when needed.
5. Leave the development checkout untouched.
6. Optionally run `opencodex install status` first to inspect slot inventory and prune candidates (default `keep=3`, overridable with `--keep <n>`).
7. Optionally run `opencodex install prune --keep <n>` to clean stale runtime slots.

This model keeps the app, CLI, and services on one versioned runtime without forcing a full uninstall on every upgrade.

## Development Rule

The repository checkout is for development, testing, and temporary local experiments.
If a developer intentionally wants a checkout-coupled service during active local work, that must stay opt-in and visibly marked as temporary.
Direct `install detached` from the current checkout remains available for local testing, but it should be treated as a development shortcut rather than the default production handoff.
When the goal is development speed rather than isolation, `opencodex install detached --link-source` can keep the installed app and CLI pointed at the active checkout so source edits take effect immediately.

## Non-Goals

This document does not define:

- the final packaging technology
- notarization or code-signing details
- a system-wide root install under `/Library` or `/Applications` as the first target
- cross-platform installer behavior for Windows or Linux
