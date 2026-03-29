# Island Command

## Goal

`opencodex island` provides a lightweight native macOS overlay that stays near the notch / menu bar region and reflects Codex task state across every known workspace.

It is meant to feel like a system-adjacent task surface:

- collapsed: show current state on the left and active task count on the right
- expanded: show pending replies that still need user action
- global: aggregate status from all known workspaces, not just the current repository

## Usage

```bash
node ./bin/opencodex.js island status --json

node ./bin/opencodex.js island install --open

node ./bin/opencodex.js island open
```

## Subcommands

`status`:

- returns the aggregated task state for the current workspace plus every known workspace discovered from:
- the current `--cwd`
- `~/.opencodex/workspaces`
- the persisted workspace registry
- the Telegram service workspace config
- includes counts, focus session, and `pending_messages`

`install`:

- writes the generated Swift source under `~/.opencodex/island/`
- compiles a small native app bundle into `~/Applications/OpenCodex Island.app` by default
- can override the app path, applications directory, CLI path, Node path, and home directory
- `--open` launches the installed overlay after compilation

`open`:

- opens the installed overlay app without reinstalling it

## Notes

- the overlay is intentionally read-only and polls `opencodex island status`
- the collapsed and expanded UI both follow the current macOS light/dark appearance
- the app is separate from the main `OpenCodex.app` shell, but it is not a menu bar icon workflow
