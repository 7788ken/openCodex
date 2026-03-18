# Mobile Control Plane

## Purpose

This document defines the product boundary for the next-stage mobile/web entry surface in openCodex.

It is not an implementation plan and it is not a command-spec patch.
It answers these questions:

- what the mobile/web surface is allowed to do
- what the mobile/web surface must not do
- how the surface should be exposed by default
- how future product docs should explain deployment and troubleshooting to ordinary users

## Core Position

The mobile/web entry in openCodex is a control plane, not a second execution engine and not a remote IDE.

It must remain downstream of these existing boundaries:

- Codex CLI remains the local execution engine
- the openCodex runtime remains the owner of workflow and session structure
- the host supervisor remains the owner of main-thread identity, state ownership, and risky controls
- `remote`, `service`, and `im` remain entry surfaces rather than becoming the product core

This means the phone/web surface can only be a narrow host-facing control layer.
It must not become the system center.

## Allowed Capabilities

The first-stage mobile/web control plane may provide these capabilities:

- view current host status
- inspect recent workflow, task, or message summaries
- send chat-style control input
- inspect lightweight state such as waiting, queued, running, or completed
- inspect recent activity and entry-surface-specific audit traces

If the UI expands later, it should still remain lightweight, summary-oriented, and confirmation-oriented instead of turning into a full workstation.

## Explicitly Forbidden

The first-stage mobile/web control plane should not provide these capabilities:

- remote desktop
- a full IDE or file-tree editor
- blanket high-risk execution from the phone
- turning browser session state into the system of record

In direct terms:

- the phone surface may request actions
- it may not own authoritative host state
- it may show summaries
- it may not replace the local working surface

## Access Model

The default exposure model should remain:

- local-first
- private-network-first
- not publicly exposed by default

Recommended stance:

- local services should listen only on localhost or other controlled addresses by default
- when phone access is needed, it should sit behind a user-controlled VPN, private network, or tunnel
- a managed public relay should not be a first-stage assumption

This stays aligned with the current `remote` direction, but the future docs should make it more explicit as the default path.

## Ordinary-User Documentation Requirements

If the mobile/web control plane continues into a product surface, the user docs should include at least:

- the shortest deployment path
- success checks
- the most common failure points
- the first logs or state surfaces to inspect

The current docs are stronger on architecture, commands, and runtime boundaries.
Any stronger mobile entry should ship with ordinary-user guidance rather than architecture-only notes.

## Relation To Existing Surfaces

### Relation to `remote`

`remote` remains the first-stage minimal message bridge.
It currently answers “how can a phone send a message in,” not “how does a phone become a full control console.”

If the phone surface grows later, it should still keep this sequence:

- first a message bridge
- then a narrow control plane
- not a direct jump to a remote IDE

### Relation to `im`

`im` already proves that the phone entry does not have to be web-first.
The mobile/web control plane is therefore only one remote-entry surface, not the only one.

### Relation to `service` and the supervisor

The phone surface must not own more control than the host control surface.
State ownership and long-lived runtime status must continue to live with the host `service` and supervisor.

## Non-Goals

This document does not define:

- a specific frontend stack
- whether to adopt a given upstream web UI
- account-system implementation details
- a full public relay infrastructure
- a native app packaging plan
- concrete command-flag changes

Those topics belong in later implementation work, after the product boundary is stable.

## Conclusion

The mobile/web direction in openCodex should continue to converge into:

- a narrow control plane built on top of the runtime and supervisor
- a local-first path that prefers private networks and user-controlled tunnels

It should not converge into:

- a patched upstream web-UI product
- a browser-session-centered system
- a remote IDE
- a second install shape built around heavy sidecar dependencies
