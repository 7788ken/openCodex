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

## Current Status

- Mostly implemented.
- The tray/service surface already exposes main-thread counts, child-thread counts, rerouted-task counts, workflow history, and task history.
- The `session` CLI surface now also exposes explicit thread metadata for list/show/tree views, so host workflows and child sessions are not only separated in the tray-facing payloads.
- The service status surface can now also report the latest supervisor-tick session separately from the long-lived listener session, so one-shot host-supervisor activity is visible in the installed control plane.
- Workflow history, workflow detail, dispatch history, and dispatch detail payloads now expose explicit supervisor/child metadata such as `thread_kind`, `thread_kind_label`, `session_role`, `session_scope`, `session_layer`, and `execution_surface`.
- Session/service workflow and dispatch payloads now also expose `session_contract_source`, so UI consumers can distinguish explicit metadata from fallback/inferred projections in older records.
- Human-readable `session`/`service` detail outputs now include the same source marker (`source inferred|fallback|explicit`), so manual triage does not require JSON mode.
- Service workflow/dispatch aggregation now hydrates child-session contract metadata from child `session.json` files, reducing stale-parent-data ambiguity in history/detail views.
- Legacy workflow/detail and dispatch/detail views now infer missing child-session contracts from workflow context as well, so old review/planner/reply child records do not collapse into generic worker threads when parent metadata is sparse.
- Legacy `session show/tree` now also infer child-thread contracts from `parent_session_id`, so older child `run`/`review` records remain visibly subordinate even when both parent `child_sessions` metadata and `session_contract` are missing.
- Telegram workflow and service detail views can now distinguish host workflows, child sessions, and rerouted host-executor work without relying only on command names or labels.
- The remaining gap is backward compatibility for legacy planner/reply child runs that lack both `session_contract` and parent task metadata; those records still fall back to generic worker labeling until a richer backfill source exists.
