# T020 — Mobile Control Plane Boundary

## Objective

Define the next-stage mobile/web entry for openCodex as a constrained control plane on top of the existing runtime, service, and supervisor layers.

## Why Now

`opencodex remote` already provides a minimal phone-friendly bridge, but it is still only an MVP.
The retained review notes from `mobileCodexHelper` point to a clearer second-stage direction:

- keep the phone surface narrow
- improve user-facing deployment and troubleshooting

This follow-up should sharpen the product boundary without dragging openCodex into a patched third-party web UI route.

## Scope

- Define the allowed capability boundary for a phone/web surface.
- Define which actions stay local-only and must not move onto the phone surface.
- Define the default exposure model as local-first and private-network-first.
- Define the user-facing deployment, validation, and troubleshooting guidance for this surface.

## First-Version Shape

The outcome of this task should be a concrete boundary note for the next mobile/web control plane.

That note should define:

- the allowed phone-side capabilities:
  - view state
  - chat-style control
  - lightweight status inspection
- the forbidden phone-side capabilities:
  - no remote desktop
  - no full IDE
  - no blanket high-risk controls
- the deployment stance:
  - local-first
  - private-network-first
  - no default public exposure model
- the support stance:
  - a shortest deployment path
  - success checks
  - common failure points

## Non-Goals

- Rebuild openCodex around a patched upstream web UI.
- Make browser session state the system of record.
- Introduce a heavy sidecar stack as the default installed shape.
- Replace the detached runtime, service, or host-supervisor architecture.
- Turn the first phone surface into a general-purpose remote IDE.

## Acceptance Criteria

- The task produces a concrete product note or command-adjacent design note for the next-stage mobile/web control plane.
- The note explicitly lists what the phone/web surface may do and what it must not do.
- The phone/web surface remains explicitly narrower than the local CLI/runtime surface.
- The design keeps private-network guidance as the default exposure model and does not assume a managed public relay.
- The note includes user-facing deployment and troubleshooting expectations rather than only architecture text.
- The result stays aligned with `remote`, `service`, detached install, and host-supervisor boundaries.

## Deliverables

- One boundary/design note for the next-stage mobile/web control plane.
- A clear capability matrix for phone-side allowed vs forbidden actions.
- A deployment/troubleshooting checklist outline suitable for later product docs.

## Current Status

- Boundary/design note drafted in:
  - [docs/zh/mobile-control-plane.md](/Users/lijianqian/svn/tools/openCodex/docs/zh/mobile-control-plane.md)
  - [docs/en/mobile-control-plane.md](/Users/lijianqian/svn/tools/openCodex/docs/en/mobile-control-plane.md)
- Command-adjacent implementation follow-through started:
  - `opencodex remote status` now exposes a lightweight status snapshot with deployment checks and common troubleshooting hints.
  - `remote status` now also includes a live `/health` probe signal for running bridge sessions, reducing blind troubleshooting loops.
  - `remote` command docs and command-spec docs now include the new status surface and support guidance entrypoint.
- The remaining work is broader phone/web control-plane implementation follow-through, not boundary discovery.
- The retained direction is:
  - keep the phone entry as a control plane rather than a web IDE
  - improve deployment/troubleshooting guidance for normal users
