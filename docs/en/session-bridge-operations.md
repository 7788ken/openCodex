# Session Bridge Operations

## Purpose

This document is the operator-facing guide for the Codex session bridge.

It answers four practical questions:

1. how to tell whether there is an active attachable bridge session
2. how to inspect recent output and message history
3. how to continue the same session instead of opening a parallel lane
4. when the system should fail closed instead of pretending continuation worked

## Core Rule

The bridge only supports continuation for bridge-owned Codex sessions.

If the current Codex process was not launched through the bridge-owned `codex` shim path, openCodex should not pretend it can safely attach to it.

## Main Operator Flow

### 1. Check whether a live bridge session exists

Start with:

```bash
opencodex bridge status
```

This should answer:

- whether the real Codex launcher is registered
- whether the transparent `codex` shim is installed correctly
- whether an active bridge-owned session exists
- which session ID is currently attachable

If there is no attachable session, stop here.
The correct behavior is a direct "no attachable session" result.

### 2. Inspect current output before sending continuation input

Use:

```bash
opencodex bridge tail
```

This is the fastest way to answer:

- what the current Codex session is doing
- whether it is blocked
- whether the next remote/mobile message should be a continuation, an answer, or no-op

### 3. Inspect recent external-control history

Use:

```bash
opencodex bridge inbox
```

This tells the operator:

- which remote/mobile/Telegram messages have already been queued
- which were delivered
- whether the same continuation instruction has already been sent

### 4. Continue the same session

Use:

```bash
opencodex bridge send "continue with <message>"
```

This is the canonical command-line continuation path.
Remote/mobile/Telegram entry surfaces should reuse the same underlying bridge-session message model.

## History Inspection Model

There are two kinds of history:

### Active-session operational history

Use:

- `opencodex bridge status`
- `opencodex bridge tail`
- `opencodex bridge inbox`

This is for "what is happening right now on the current mainline session."

### Repository-visible session history

Use:

- `opencodex session latest`
- `opencodex session list`
- `opencodex session show <id>`
- `opencodex session tree <id>`

This is for "what happened across sessions over time."

The rule is simple:

- `bridge *` answers "current live bridge session"
- `session *` answers "stored session history and lineage"

## Session Selection Rules

### For bridge commands

Current selection contract:

- `active` means the currently attachable bridge-owned live session
- `latest` means the latest stored bridge-owned session by update time
- explicit session IDs should be used when an operator needs one exact historical record

More concretely, the current implementation resolves selection like this:

- `bridge status` only reads the global bridge-state `active-session.json`
- `bridge tail` / `bridge inbox` use the active pointer first when no selector is given
- if there is no active pointer, `bridge tail` / `bridge inbox` fall back to the latest bridge session in the current workspace by `updated_at`
- when an explicit session ID is provided, that stored session is read directly

This means the current version does not implement a richer arbitration strategy across multiple live bridge sessions.
The only session treated as the current live mainline attach target is the one referenced by the global active pointer.

### Current rule when multiple candidates coexist

The current implementation does not compare multiple attachable candidates and then choose the best one.

The effective rule is only:

- live continuation trusts the single session referenced by the global active pointer
- history inspection is the only place that falls back to the latest stored session by `updated_at`

So in practice:

- if multiple bridge sessions are still running and the active pointer references only one of them, bridge continuation will only target that one
- if the active pointer is missing, `tail` / `inbox` can still inspect history; `send` must not pretend that means the live mainline has been reattached
- there is currently no public selector tie-break contract based on working directory, recent output, recent external messages, or lock ownership

### For remote status and inbox

The current preferred selection rule is:

- default to the active remote session when one exists
- otherwise fall back to the latest historical remote session

This keeps operational status focused on the live path first.

Note that the `remote` selector is its own session selector, not the bridge live-session selector:

- `remote status` / `remote inbox` default to a non-terminal remote session
- only the bridge-attach inspection inside remote status checks the active bridge session
- so remote "active" is not the same thing as the bridge continuation mainline

## Fail-Closed Cases

The system should fail closed in these situations:

- no active bridge-owned session exists
- the registered real Codex launcher is missing or invalid
- the installed bridge shim would recurse into itself
- the selected session is historical and not attachable for live continuation
- multiple candidates exist and policy cannot choose one deterministically

In those cases, the correct output is an explicit operator-facing explanation.
The system must not silently open a new workflow and label it as continuation of the same Codex session.

## Session State And Attachability

The current continuation contract is narrower than "the latest bridge session."

### States that allow live continuation

In the current implementation, a session only qualifies for actual continuation delivery when all of these are true:

- `session.command === "bridge"`
- `session.status === "running"`
- the session record is still readable, so `record_found === true`
- a valid `working_directory` exists

Operationally, this means:

- a `running` bridge-owned session that is still held by the bridge runtime can continue

### States that are read-only or explicitly blocked

These states or conditions are inspectable only and must not be treated as live continuation targets:

- `completed`
- `failed`
- `cancelled`
- `missing`
- `invalid`
- a dangling active pointer where `record_found === false`

In practice:

- `tail` / `inbox` can inspect historical sessions read-only
- `send` only works for a running bridge session
- Telegram / remote attach logic also uses the same `record found + running` gate

So the current product meaning is not "continue whichever bridge session was most recent."
It is "continue only the bridge-owned mainline that is still running right now."

## Recommended Remote/Mobile Flow

For a remote operator, the recommended sequence is:

1. `opencodex remote status`
2. inspect bridge attachability and recent output summary
3. if needed, inspect `opencodex bridge tail`
4. if needed, inspect `opencodex bridge inbox`
5. then send one continuation message through the chosen surface

The critical product rule is:

remote/mobile entry surfaces are not separate work lanes.
They are control surfaces for the same bridge-owned session.

## Historical Reopen / Resume Semantics

The current bridge mainline does not yet support explicitly reopening or resuming a historical bridge session into a new live session.

What is supported today is only:

- sending more external input into a running bridge session
- inspecting historical bridge sessions read-only

What is explicitly not supported today:

- reattaching directly to `completed` / `failed` / `cancelled` bridge sessions
- pretending a historical session is still the current live session and continuing message delivery into it
- relaunching a historical bridge session as a new process through a bridge command

There are other "resume" concepts in the repository, but they are not bridge-session reopen:

- `opencodex auto --resume` only applies to `auto` workflows
- Telegram CTO workflow restart resume only applies to workflow rehydration in that subsystem

Neither of those should be treated as an existing bridge-history reopen capability.

## Repair / Recovery Contract

The current implementation can already identify several broken states, but "identified" is not the same thing as "has a dedicated repair command."

An operator should think about recovery in two layers:

- install-layer repair: bridge state, real Codex launcher, shim, and PATH
- live-session recovery: accept that the current mainline is no longer safely attachable, then choose between read-only inspection and starting a new bridge-owned `codex ...`

### 1. Install-layer breakage

These cases are already surfaced directly by `opencodex bridge status` and `opencodex doctor`:

- missing or corrupted bridge state
- an invalid registered real Codex launcher
- missing, stale, or mismatched shim state
- shim recursion back into itself
- PATH still resolving `codex` somewhere else first

The currently supported repair actions are:

- `opencodex bridge register-codex --path <real-codex-path>`
- `opencodex bridge install-shim`
- `opencodex bridge repair-shim`
- fixing PATH precedence so the bridge shim wins before other `codex` launchers

The product meaning here is simple:

- if the install layer is broken, repair the install layer first
- do not misdiagnose remote/mobile/Telegram attach failure as a session problem when bridge state or shim state is already broken

### 2. Dangling active pointer

When `active-session.json` still exists but the referenced session record is unreadable, missing, or broken, the bridge currently classifies that mainline as:

- `missing`
- `invalid`
- or a dangling active pointer where `record_found === false`

In those cases, the current operator-facing behavior is:

- `bridge status` may still show the pointer, but it is not an attachable mainline
- `bridge send` will not treat it as a continuation target
- `remote status` / the remote page report either no attachable bridge-owned session or a detected-but-not-attachable one
- Telegram bridge attach also tells the user the mainline cannot be continued right now instead of silently opening a parallel workflow

The currently supported recovery actions are only:

- inspect the state first with `bridge status`
- inspect history read-only with `bridge tail`, `bridge inbox`, or `session show`
- start a new bridge-owned `codex ...` session locally when continuation is still needed

What does not exist yet:

- a dedicated bridge command to clear or rebuild the active pointer
- automatic conversion of a dangling pointer into a new live session

### 3. Orphaned controller / runtime crash

During normal completion, failure, or signal termination, the bridge runtime already tries to clear the active pointer in `finally`.

So after a clean:

- `completed`
- `failed`
- `cancelled`

shutdown path, the system should not keep advertising that session as the active mainline.

But when the failure is harsher than that, such as a host crash, controller abort, or a timing break between active-pointer writes and session persistence, the operator-facing state usually degrades into the dangling-pointer / missing-record cases above instead of entering a richer automatic recovery flow.

In other words, the current recovery meaning is:

- the system tries to recognize that the mainline is no longer trustworthy
- it does not automatically revive that old bridge session

The supported actions are still:

- inspect with `bridge status`
- inspect read-only details with `bridge tail`, `bridge inbox`, and `session show <id>`
- repair bridge state / shim / PATH when the install layer is the real problem
- start a new bridge-owned `codex ...` session when the old live session is no longer attachable

### 4. Repair capabilities that do not exist yet

This round should state explicitly that the following are not supported yet:

- automatic detection and cleanup of stale active pointers
- automatic re-claim of an orphaned bridge process into a continuation-safe live session
- automatic rebuilding of active-pointer and session-record consistency after a crash
- explicit reopen of a historical bridge session into a new live session

## Details Still Worth Adding

This round now makes selector rules, attachability, no-reopen semantics, and the repair contract explicit.
The remaining useful follow-ups are:

- a formal repair command for orphaned controllers or dangling running records
- automatic or semi-automatic consistency rules between the active pointer and the session record after a bridge runtime crash
- if historical reopen is ever supported, an explicit lineage contract where a new session inherits the old lineage instead of mutating the old record

Those follow-ups belong under `T021`.
