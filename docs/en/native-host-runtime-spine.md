# Native Host Runtime Spine

## Purpose

This document defines why openCodex needs a native host/runtime spine and what that spine should own.

The driver is not language preference.
The driver is ownership.

If a capability needs:

- OS-level process ownership
- PTY lifecycle control
- stronger service/runtime identity
- tighter detached-install ownership
- privileged or native framework integration

then JS should not remain the default implementation layer merely because it is faster to write.

## Core Rule

Keep JS for:

- orchestration logic
- workflow policy
- session summarization
- cross-command product logic
- repo-facing business rules

Move native-host ownership into Swift for:

- bridge launcher ownership
- live-session runtime ownership
- PTY/input/output control
- native service/process lifecycle
- future host-side state publishing that depends on native OS integration

## Why This Matters For The Product

The product goal is not "write openCodex in as much JS as possible."
The product goal is:

- bridge into real Codex sessions
- let remote surfaces continue those sessions safely
- keep installed-product runtime ownership coherent

That means the bridge/runtime layer is infrastructure, not convenience glue.
If that layer stays in JS only because it was quick to prototype, the architecture eventually inverts:

- JS ends up holding the process/runtime truth
- native host integration becomes an afterthought
- install/service/process semantics get harder to stabilize

## Proposed Responsibility Split

### Swift native spine owns

- detached launcher/runtime entry
- process spawn and attach ownership for bridge-launched Codex sessions
- PTY relay and low-level IO control
- long-lived service/runtime lifecycle
- native host state surfaces that need stronger OS guarantees

### JS core owns

- command semantics
- orchestration policies
- session normalization rules
- remote/IM/control-plane routing logic
- product-level summaries and user-facing explanations

## Incremental Migration Rule

This is not a blind rewrite plan.

The migration should proceed in this order:

1. document the boundary clearly
2. identify the OS-facing bridge/runtime surfaces that currently leak host ownership into JS
3. migrate those surfaces one slice at a time
4. keep the session model and product semantics stable while the host layer moves

## First Candidate Slices

The first candidates for native ownership are:

- bridge launcher/runtime entry
- PTY-backed live-session ownership
- service/runtime lifecycle management
- state publication surfaces that represent the active bridge session to external clients

## Relation To T021

`T021` is the product mainline.
It defines the Codex session bridge.

`T023` exists to support `T021`, not to replace it.
The native spine is the host/runtime foundation under the bridge model.

## Non-Goals

- rewriting all openCodex command logic into Swift
- removing JS from places where it is still the best orchestration layer
- inventing a framework-heavy abstraction before the boundary is proven

## Acceptance

- the repository has one explicit native-vs-JS boundary
- bridge/runtime ownership surfaces are assigned to the native spine
- future implementation slices can be planned without re-debating the architectural intent every time
