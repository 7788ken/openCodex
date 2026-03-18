# Project Status Snapshot (2026-03-18)

## Positioning

openCodex is a local orchestration layer built on top of Codex CLI rather than a reimplementation of the local coding engine.
The product focus is workflow orchestration, normalized sessions, policy mapping, same-machine coordination, and multi-entry control surfaces.

## Project Goals

1. Keep the path from user intent to verified code change observable end to end.
2. Prefer minimal and rollback-friendly changes over broad risky rewrites.
3. Keep `run` as the primary local execution surface and `session` as the handoff/trace surface.
4. Keep the CTO supervisor identity and final control on the host, with sandbox child sessions as subordinate helpers.

## Outlook

- Continue converging on a stable "host supervisor + sandbox advisors" model.
- Keep phone/web entry as a narrow control plane, not a remote IDE.
- Keep local-first and private-network-first as the default exposure model.
- Keep App, CLI, and long-lived services on one detached runtime boundary.

## Current Progress

### Implemented Capability Surface

- Command surface includes:
  - `run`
  - `session`
  - `doctor`
  - `review`
  - `auto`
  - `remote`
  - `im`
  - `service`
  - `install`
- Test status (2026-03-18):
  - `npm test` is green, `172/172` passed.

### Board Status Summary

- Implemented/completed:
  - `T001` through `T012`
  - `T018`
  - `T019`
- Mostly implemented:
  - `T013` Host supervisor runtime (remaining gap: single dedicated host runtime lifecycle)
  - `T014` Session contract (remaining gap: historical record consistency)
  - `T015` Supervisor/session UI separation (remaining gap: historical backfill consistency)
  - `T016` Conversation/research mode (remaining gap: product-wide persisted visibility)
- Partially implemented:
  - `T017` Detached install layout (core boundary complete; packaging/lifecycle polish remains)
- Planned:
  - `T020` Mobile/Web control-plane boundary follow-through (boundary note is drafted; implementation remains)
- Parked:
  - `T008` Gateway spike

### Recent Iteration Focus

- Strengthened host-supervisor recovery paths, concurrency leases, and periodic supervisor ticks in service mode.
- Extended session-contract metadata across `im/auto/run/review/session/service` flows.
- Completed detached install bundle/install/status flows, service relink path, and bootstrap install path.
- Added bilingual `mobile-control-plane` boundary notes and linked follow-up tracking in `T020`.

## Risks and Remaining Convergence

- Supervisor lifecycle still relies on launchd + CLI wrappers instead of one dedicated runtime lifecycle.
- Historical sessions and legacy producers still require some contract inference/backfill paths.
- Phone/web control plane is at "boundary converged, implementation pending" stage.
- Detached install is usable, but broader packaging/product polish remains.

