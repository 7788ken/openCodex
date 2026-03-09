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
