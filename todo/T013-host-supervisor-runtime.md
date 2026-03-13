# T013 — Host Supervisor Runtime

## Objective

Move the CTO identity, workflow ownership, and long-lived control loop into a host-resident supervisor instead of representing the CTO as a sandbox child agent.

## Why Now

The Telegram bridge and tray UI already behave like long-lived control surfaces.
The remaining architectural gap is that the product still leans on child Codex sessions for parts of the CTO workflow model.
That makes the identity boundary blurry.

## Scope

- Define a host-owned CTO supervisor runtime.
- Keep workflow state, routing, queue ownership, and CEO-facing replies at the host layer.
- Treat Codex child sessions as subordinate tools invoked by the supervisor.
- Preserve traceability between the host workflow record and child sessions.
- Reuse existing session artifacts where possible instead of inventing a second history system.

## Acceptance Criteria

- The CTO role is modeled as a host-owned workflow record.
- Telegram and tray actions attach to the host supervisor instead of a sandbox child identity.
- Workflow resume, repair, reroute, and final replies remain correct after process restart.
- Child Codex sessions stay linked but no longer define the CTO identity of record.

## Current Status

- Mostly implemented.
- The CTO prompts, workflow wording, and control-surface docs now consistently describe the CTO as a host-level supervisor instead of a sandbox child identity.
- Telegram CTO workflow state is stored in host-owned `cto` session artifacts, and the listener can now rehydrate waiting-for-user, planning, rerouted, and ordinary `running` workflows on restart.
- There is now also a one-shot host-supervisor entrypoint outside the polling loop: `im telegram supervise`, with `service telegram supervise` as the installed-service wrapper.
- The installed Telegram service now provisions a second periodic supervisor agent, so the host-supervisor path is no longer only reachable through the listener process itself.
- Rehydrated workflow recovery now uses a host-side resume lease, so concurrent listener/supervisor ticks do not both resume the same Telegram CTO workflow.
- Host-executor queue claims now also use a short host-side lease, so concurrent listener/supervisor workers do not both take the same rerouted job.
- Child Codex sessions are captured as subordinate planner/reply/worker records under the host workflow instead of defining the supervisor identity themselves.
- The remaining gap is that the supervisor lifecycle is still assembled from launchd-managed CLI wrappers rather than a single dedicated host runtime with its own state machine and lifecycle management.
