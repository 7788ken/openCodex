# T021 — Installed openCodex as the Codex Control Bridge

## Objective

Make the installed openCodex product act as a system-level control plane for Codex work without requiring users to abandon the `codex` entrypoint or depend on any source checkout path.

The first supported target is Codex CLI.
App control is only in scope when there is a stable, supported control surface to attach to.

## Why Now

The current Telegram and remote surfaces can control openCodex-owned workflows, but they do not attach to the user's real mainline Codex work.
That creates a split-brain product shape:

- users already have Codex installed
- users naturally keep using `codex`
- openCodex currently asks them to enter through wrapper flows to gain control

That is the wrong product boundary.
Installed openCodex must become the control layer around Codex, not an alternative work lane beside it.

## Product Constraint

- Codex remains the execution engine.
- Installed openCodex remains the orchestration and control layer.
- Users must be able to install openCodex after Codex and keep their normal `codex` habit.
- The design must not depend on where the repository checkout lives.
- The design must not depend on where the detached openCodex runtime is installed.
- The system must not promise takeover of arbitrary pre-existing Codex processes that were started outside the bridge.

## Scope

- Define one installed-product control path for Codex CLI.
- Keep the visible user entrypoint compatible with normal Codex usage.
- Add a stable global state root for installed openCodex control data.
- Introduce a bridge-owned live session model for Codex work started through the bridge.
- Route Telegram and future remote control surfaces toward the active live session instead of silently spawning unrelated workflows.
- Keep auditability, session history, and recovery under the existing openCodex session model.

## Non-Goals

- Replacing Codex CLI with a different local execution engine.
- Requiring users to switch their habit to `opencodex run` for normal work.
- Claiming reliable takeover of already-running Codex processes that were not launched through the bridge.
- Building a brittle desktop automation layer to fake control over a GUI app.
- Expanding the first milestone into a full multi-device sync system.

## First-Version Shape

The first implementation should introduce one clear product path:

1. installed openCodex registers and validates the real Codex binary path
2. installed openCodex installs a transparent `codex` bridge shim ahead of the real Codex binary on PATH
3. the shim launches the real Codex process under an openCodex-owned live session runtime
4. Telegram and other remote control surfaces attach to the active bridge-owned live session instead of opening a parallel workflow by default

If no active bridge-owned session exists, control surfaces must say that explicitly.
They must not silently pretend that a new workflow is the same thing as the user's current Codex work.

## Implementation Plan

### Phase 1 — Global Installed Control State

Define one stable installed-product state root outside any project checkout.

Deliverables:

- one canonical state root for installed control data
- a persisted Codex launcher record:
  - resolved real binary path
  - provenance of how it was discovered
  - last validation timestamp
- a persisted bridge config:
  - default execution surface
  - active session pointer
  - external-control defaults
- doctor coverage for missing, stale, or conflicting Codex bridge state

Acceptance for this phase:

- installed openCodex can discover and remember the real Codex binary path
- the state survives detached-runtime upgrades
- the state is independent from repository workspaces

### Phase 2 — Transparent `codex` Bridge Shim

Add one supported bridge install path that preserves the `codex` habit.

Deliverables:

- a command to install or repair the `codex` bridge shim
- a command to inspect bridge status
- a command to remove or disable the shim
- launcher rules that preserve access to the real Codex binary without recursion
- regression coverage for PATH precedence, repair, and reinstall cases

Rules:

- the visible command name stays `codex`
- the bridge shim must forward arguments faithfully
- the bridge must fail fast when the real Codex target is missing or ambiguous
- the bridge must record that the session was started under openCodex supervision

Acceptance for this phase:

- users can keep typing `codex ...`
- installed openCodex can prove whether a given `codex` launch is bridge-owned or not
- detached-runtime upgrades do not break the shim target

### Phase 3 — Live Session Runtime for Bridge-Owned Codex Work

Add a live session runtime instead of treating Codex work as a fire-and-forget wrapper command.

Deliverables:

- a live session record with stable IDs and lifecycle states
- PTY-backed process ownership for bridge-launched Codex CLI sessions
- an inbox/outbox control model for external messages
- a snapshot surface for:
  - active session metadata
  - recent output
  - pending external commands
  - current control owner or lock state
- recovery rules for crashed controllers and orphaned sessions

Rules:

- only bridge-launched sessions are attachable
- session ownership and audit trails must be explicit
- the system must distinguish:
  - active live session
  - historical completed session
  - orphaned process

Acceptance for this phase:

- installed openCodex can identify the current active bridge-owned Codex session
- external commands can be queued against that session through one audited path
- stale or crashed session controllers can be repaired without rewriting history

### Phase 4 — Attach Telegram and Remote Control to the Active Live Session

Move phone-side control from “parallel workflow lane” to “active session control lane”.

Deliverables:

- Telegram attach rules for the active live session
- explicit fallback behavior when no attachable session exists
- operator-facing status output that tells the user:
  - attached to active session
  - no attachable session
  - multiple candidates blocked by policy
- remote/mobile control routing through the same live-session inbox
- session history views that show external commands as part of the same mainline session

Rules:

- Telegram must not silently create a parallel workflow when the user intent is “continue current work”
- external control must target one session explicitly or deterministically
- high-risk actions still require the existing confirmation rules

Acceptance for this phase:

- a user can start work locally with `codex`
- later continue the same mainline work from Telegram through the installed openCodex bridge
- status/history surfaces explain exactly which live session is being controlled

### Phase 5 — Packaging, Migration, and Product Docs

Turn the bridge into a supported installed-product feature instead of an engineering-only capability.

Deliverables:

- install and upgrade docs for bridge mode
- migration docs for users who already have Codex installed
- clear product wording about supported and unsupported takeover cases
- troubleshooting guidance for:
  - missing real Codex binary
  - PATH order conflicts
  - stale active-session pointer
  - external control sent with no attachable session
- focused validation matrix for detached install, service runtime, and bridge runtime coexistence

Acceptance for this phase:

- a detached installed openCodex can be upgraded without losing bridge state
- users understand the exact boundary between supported bridge-owned sessions and unsupported foreign sessions
- service, tray, CLI, and bridge docs all describe one consistent model

## Execution Order

`Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5`

This task should not start from Telegram prompt tweaks.
The control-plane entry must be fixed at the installed bridge/runtime layer first.

## Dependencies

- `T013-host-supervisor-runtime.md`
- `T014-sandbox-advisor-session-contract.md`
- `T015-supervisor-session-and-ui-separation.md`
- `T017-detached-install-layout.md`
- `T020-mobile-control-plane-boundary.md`

`T017` provides the installed runtime boundary.
`T013`/`T014`/`T015` provide the host-supervisor and session lineage model.
`T020` provides the control-plane boundary so mobile entry does not expand into a remote IDE.

## Acceptance Criteria

- Installed openCodex can operate as a path-independent control layer over Codex CLI.
- Users can keep the `codex` entrypoint instead of being forced onto `opencodex run`.
- The bridge clearly differentiates bridge-owned sessions from foreign sessions.
- Telegram and remote control surfaces can continue the active bridge-owned mainline session instead of opening a misleading parallel lane.
- The implementation does not rely on a source checkout path.
- The implementation does not promise unsupported takeover of arbitrary pre-existing Codex processes.

## Deliverables

- one installed-product bridge design and execution path
- bridge install/status/repair command surface
- live-session runtime contract for bridge-owned Codex work
- Telegram/remote attach semantics for active live sessions
- docs and validation covering upgrade, repair, and operator troubleshooting

## Current Status

- Phase 1 completed:
  - added an installed bridge state file under `~/.opencodex/bridge/bridge.json`
  - added `opencodex bridge status`
  - added `opencodex bridge register-codex`
  - added `doctor` coverage for missing or valid bridge state
- Phase 2 completed:
  - added `opencodex bridge install-shim`
  - added `opencodex bridge repair-shim`
  - added a transparent `codex` shim that forwards to `opencodex bridge exec-codex`
  - persisted shim install metadata in the global bridge state
  - added `doctor` coverage for shim visibility, PATH precedence, and recursion risk
  - hardened launcher inspection so bridge status and doctor do not recurse when PATH already resolves `codex` to the bridge shim
- Phase 3 started:
  - `opencodex bridge exec-codex` now creates a bridge-owned session record under the workspace session store
  - bridge-launched sessions now persist runtime metadata and lifecycle events
  - `opencodex bridge status` now reports the current active bridge-owned session through a dedicated runtime pointer under `~/.opencodex/bridge/active-session.json`
  - the remaining gap is an attachable PTY/inbox control runtime rather than a pure launch/observe flow
- Product direction is now clear:
  - Codex stays the execution engine.
  - Installed openCodex becomes the control bridge.
  - The first real target is bridge-owned Codex CLI sessions, not arbitrary foreign processes and not GUI automation.
