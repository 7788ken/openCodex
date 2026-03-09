# T014 — Sandbox Advisor Session Contract

## Objective

Define a clear contract for sandbox child sessions so they act as advisors, planners, reviewers, or narrowly scoped helpers under the host supervisor.

## Why Now

Once the CTO identity moves to the host layer, child sessions need an explicit subordinate role.
Without that contract, prompts, status semantics, and adoption rules will stay ambiguous.

## Scope

- Define advisor, planner, reviewer, and helper roles for sandbox child sessions.
- Make prompts explicitly state that child sessions are not the CEO-facing CTO identity.
- Standardize how advice is returned to the host supervisor.
- Define when the supervisor adopts, rejects, reroutes, or escalates child output.
- Keep the schema machine-readable and session-friendly.

## Acceptance Criteria

- Child-session prompts clearly describe the subordinate role.
- Structured outputs are sufficient for host-level adoption and routing decisions.
- Session records can tell whether a child acted as planner, reviewer, or helper.
- No child session is treated as the supervisor of record.
