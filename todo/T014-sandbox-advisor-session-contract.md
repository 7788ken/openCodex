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

## Current Status

- Mostly implemented.
- Telegram CTO planner, reply, and worker prompts already describe sandbox children as advisors or helpers under the host supervisor.
- A shared machine-readable `opencodex/session-contract/v1` layer now exists and is emitted across `im`, `auto`, `run`, and `review`, with session creation also able to inherit the contract from environment variables.
- Child-session records and service payloads now preserve role/thread metadata such as `thread_kind`, `role`, `scope`, `layer`, and `supervisor_session_id`.
- Session repair now preserves and backfills child-session contract metadata in the `auto` and `cto` repair paths instead of collapsing repaired child records back to bare `command/session_id/status` tuples.
- Auto repair now also backfills legacy child session contracts when historical records are missing explicit metadata, using command-aware fallback roles (`executor` for `run`, `reviewer` for `review`) under the auto supervisor scope.
- CTO repair fallback now also infers planner/reply/worker/reviewer child roles from command, label, and task context when explicit child contracts are missing.
- Session and service payloads now expose `session_contract_source` (`explicit` / `fallback` / `inferred` / `none`) so legacy inferred metadata is visible instead of silently looking explicit.
- The remaining gap is historical consistency: legacy records and a few fallback paths still rely on inferred metadata instead of every producer persisting the full contract end to end.
