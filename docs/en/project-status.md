# Project Status Snapshot (2026-03-29)

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
- Make the Codex session bridge the mainline product path for remote continuation and history inspection.
- Move bridge/runtime host ownership into a native spine when OS integration, PTY control, or service ownership makes JS the wrong layer.

## Current Progress

### Implemented Capability Surface

- Command surface includes:
  - `run`
  - `session`
  - `doctor`
  - `review`
  - `auto`
  - `bridge`
  - `remote`
  - `im`
  - `service`
  - `install`
- Test status (2026-03-29):
  - targeted bridge/remote/im/install coverage is in active use
  - full-suite health should be re-baselined again after the next bridge-mainline implementation slice

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
  - `T021` Installed Codex control bridge (installed bridge state, shim install/repair, live-session records, remote/Telegram attach, recent output, and external message relay are in place; the operator-facing selector / attachability / no-reopen contract is now documented explicitly; remaining gaps are orphaned/dangling recovery semantics, post-crash consistency rules, and the installed-product plus native-runtime follow-through)
- Newly opened:
  - `T023` Native host runtime spine (documented as the supporting refactor path for bridge/runtime OS ownership)
- Partially implemented:
  - `T017` Detached install layout (core boundary complete; packaging/lifecycle polish remains)
  - `T020` Mobile/Web control-plane boundary follow-through (boundary docs are in place and `remote status` already covers deployment checks/troubleshooting; broader control-plane follow-through remains)
- Parked:
  - `T008` Gateway spike

### Recent Iteration Focus

- Re-centered the product mainline on `T021`: bridge into real Codex sessions, inspect the same session remotely, and continue the same mainline work instead of opening parallel lanes.
- Added docs-first planning for `T023` so bridge/runtime host ownership can move into a native Swift spine incrementally instead of remaining in JS by convenience.
- Wrote down the current `T021` operator contract explicitly in the bridge wiki: live selection trusts only the global active pointer, attachability requires a running bridge-owned session, and historical bridge sessions are read-only with no reopen/resume path today.
- Wrote down the current `T021` repair/recovery contract too: installed-surface repair and live-session recovery are now described separately, and current recovery is limited to diagnosis plus a fresh bridge-owned relaunch rather than reviving the old live lane.
- Strengthened host-supervisor recovery paths, concurrency leases, and periodic supervisor ticks in service mode.
- Extended session-contract metadata across `im/auto/run/review/session/service` flows.
- Service workflow/dispatch aggregation now hydrates child-session contract snapshots from child `session.json` artifacts when parent linkage metadata is stale.
- Rehydrated supervisor resume now re-checks persisted workflow/session state after lease acquisition to prevent duplicate resume in race windows.
- Completed detached install bundle/install/status flows, service relink path, and bootstrap install path.
- Added bilingual `mobile-control-plane` boundary notes and linked follow-up tracking in `T020`.

## Risks and Remaining Convergence

- Supervisor lifecycle still relies on launchd + CLI wrappers instead of one dedicated runtime lifecycle.
- Historical sessions and legacy producers still require some contract inference/backfill paths.
- Phone/web control plane is at "boundary converged, implementation pending" stage.
- Detached install is usable, but broader packaging/product polish remains.
- Bridge-owned session recovery semantics after orphaned controllers, dangling active pointers, or bridge-runtime crashes still need tighter convergence.
- The bridge/runtime layer still leans on JS more than the desired host-ownership boundary.
