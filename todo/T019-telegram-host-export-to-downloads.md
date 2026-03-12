# T019 — Telegram Host Export Reroute for Sandbox-Blocked Partial Runs

## Objective

When a Telegram CTO task only partially completes because the current environment cannot write to host-only locations such as `~/Downloads`, automatically reroute that work into the host executor queue instead of stalling in a partial state.

## Why Now

The host executor path already fixes hard host-sandbox failures.
But real export tasks can also return `partial` with concrete permission errors like `Operation not permitted`, which currently leaves the CEO with an unfinished export even though a safe host-side continuation path already exists.

## Scope

- Expand host-executor reroute detection beyond `summary.status === "failed"`.
- Detect sandbox/permission-blocked partial summaries from `result`, `validation`, `findings`, and related text.
- Keep the existing host-executor queue and workflow tracking unchanged.
- Add regression coverage for a partial export-to-Downloads task that completes after reroute.

## Acceptance Criteria

- A Telegram CTO task that returns `partial` with sandbox/permission-blocked evidence is rerouted automatically when the host executor is enabled.
- The workflow sends the interim reroute reply and later finishes with a normal final completion reply.
- The rerouted host-executor job records complete successfully.
- Existing fail-closed behavior for hard host-sandbox mismatches remains intact.

## Current Status

- Implemented on 2026-03-12.
- Partial sandbox-blocked exports now enter the host executor queue automatically.
- Regression coverage now includes a Downloads-style export task that first fails inside the worker sandbox and then completes on the host executor.
