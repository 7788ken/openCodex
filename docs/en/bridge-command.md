# Bridge Command

## Purpose

`opencodex bridge` is the product mainline for one specific goal:

- keep the user's normal `codex` habit
- launch bridge-owned Codex sessions under openCodex supervision
- let remote/mobile/IM surfaces continue the same mainline session instead of opening a parallel lane
- keep session history, recent output, and external-control audit trails visible through one shared session model

This command is not a side utility.
It is the control-plane entry that makes "continue the real Codex session from elsewhere" a supported product path.

## Product Boundary

The bridge model is intentionally narrow:

- openCodex does support bridge-owned Codex sessions
- openCodex does not promise takeover of arbitrary foreign Codex processes that were started outside the bridge
- remote/mobile/Telegram control should attach to the active bridge-owned session when one exists
- if no attachable bridge-owned session exists, the system must say that directly instead of pretending a new workflow is the same thing

## Mainline User Story

The intended path is:

1. the user keeps using `codex ...`
2. the installed openCodex bridge shim sits in front of the real Codex launcher
3. the launched Codex process becomes a bridge-owned live session
4. later, the user can:
   - inspect bridge status
   - inspect recent output
   - inspect queued/delivered external messages
   - send a continuation message into the active session
   - attach remote/mobile/Telegram surfaces to that same session

This is the mainline product shape for "view history and continue the same Codex work remotely."

## Supported Subcommands

Current bridge subcommands:

- `opencodex bridge status`
- `opencodex bridge tail`
- `opencodex bridge inbox`
- `opencodex bridge send`
- `opencodex bridge register-codex`
- `opencodex bridge install-shim`
- `opencodex bridge repair-shim`

## Command Roles

### `bridge register-codex`

Persist the real Codex launcher path that the bridge should forward to.

This is the prerequisite for a stable installed-product bridge.

### `bridge install-shim`

Install a transparent `codex` shim ahead of the real Codex binary on `PATH`.

The user-visible habit stays `codex`.
The bridge gains process ownership and session lineage.

### `bridge repair-shim`

Repair or rewrite the shim when `PATH` order, launcher targets, or detached-runtime upgrades drift.

### `bridge status`

Inspect the installed bridge state and the active bridge-owned live session.

This is the first operator surface to answer:

- is the bridge installed correctly
- which real Codex binary is registered
- is there an active attachable bridge session
- what recent output and pending bridge messages exist

### `bridge tail`

Read recent captured output from a bridge-owned session.

This is the fastest "what is the current Codex session doing" surface when the user is remote.

### `bridge inbox`

Read queued and delivered external messages associated with the selected bridge session.

This is the audit trail for remote/mobile/IM continuation input.

### `bridge send`

Queue one external message into the active or selected bridge-owned session.

This is the command-path equivalent of "continue this Codex session from elsewhere."

## Bridge-Owned Live Session Model

A bridge-owned session should preserve:

- stable session identity
- launcher provenance
- lifecycle status
- recent output
- queued and delivered external messages
- attachment semantics for remote/mobile/Telegram entry surfaces

The core distinction is:

- bridge-owned live session: supported attach target
- historical bridge-owned session: readable history, not necessarily attachable
- foreign Codex process: outside the supported attach contract

The current operator boundary is now explicit:

- live continuation only trusts the single bridge session referenced by the global active pointer
- `tail` / `inbox` may fall back to the latest historical session for read-only inspection when no active pointer exists
- the product meaning of `send` remains "write input into the current running mainline", not "try to revive history"
- `completed` / `failed` / `cancelled` bridge sessions do not currently support reopen / resume
- dangling active pointers, orphaned controllers, and runtime crashes are currently detected and surfaced, not automatically revived into new live sessions

So the bridge supports live attachment today, not historical-session revival.
Today it provides "recognize broken state and point to manual repair actions," not "automatically recover the old mainline."

## Relation To Other Surfaces

### Relation to `remote`

`remote` is a phone-friendly entry surface.
It should not become its own execution lane.
Its correct job is to relay messages into the active bridge-owned session and expose status/history for that same session.

### Relation to `im`

Telegram CTO mode should attach to the active bridge-owned session when the user intent is "continue current Codex work."
It must not silently open a parallel workflow lane for that intent.

### Relation to `session`

`session` remains the repository-visible history and handoff surface.
Bridge-owned sessions must stay visible there as first-class session records.

## Current Gaps

The main remaining gaps are:

- stronger session-history inspection paths for bridge-owned work
- a formal repair command for orphaned controllers or dangling active pointers
- automatic or semi-automatic consistency rules between the active pointer and the session record after bridge runtime crashes
- installed-product documentation and troubleshooting polish

These gaps are tracked in `T021-installed-oc-codex-control-bridge.md`.

## Related Documents

- `install-layout.md` — detached runtime and installed launcher ownership
- `remote-command.md` — phone-friendly bridge entry surface
- `im-command.md` — Telegram entry surface and current attach behavior
- `project-status.md` — current execution status
