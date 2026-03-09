# T015 — Supervisor Session and UI Separation

## Objective

Make the host-supervisor model visible in session history, workflow inspection, and tray UI so the CEO always sees the CTO as the central thread and child sessions as subordinate records.

## Why Now

Even if the internal architecture is correct, the product still feels wrong when history and UI blur the line between the CTO and its child sessions.
The control surfaces need to reflect the supervisor model directly.

## Scope

- Add host-supervisor-oriented status fields to workflow and dispatch views.
- Distinguish host workflow records from advisor/planner/helper child sessions.
- Update tray summaries, history lists, and detail views to show the separation.
- Make rerouted and host-executed work understandable from the UI.
- Keep backward compatibility with existing session artifacts where possible.

## Acceptance Criteria

- Workflow history clearly identifies the host supervisor thread.
- Task and dispatch views show whether a record is a host workflow or a child advisory session.
- Tray UI presents counts and labels that match the supervisor model.
- The CEO can inspect execution lineage without mistaking a child session for the CTO itself.
