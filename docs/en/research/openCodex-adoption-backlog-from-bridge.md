# openCodex Adoption Backlog (from telegram-codex-bridge)

- Inputs:
  - `docs/zh/research/telegram-codex-bridge-baseline.md`
  - `docs/zh/research/telegram-codex-bridge-orchestration-patterns.md`
  - `docs/zh/research/telegram-codex-bridge-reliability-ops.md`
- Repository baseline: `/Users/lijianqian/svn/tools/openCodex`
- Objective: convert proven bridge orchestration/reliability patterns into an execution-ready adoption backlog for openCodex.

## Main Direction (single path)
Prioritize three items first: workflow/interaction state semantics, per-workflow event serialization, and Telegram delivery reliability. Then add readiness gate hardening and event taxonomy, with minimal reversible changes.

## Top 5 High-Leverage Adoptions

### 1) Make interaction a first-class state (instead of only `pending_question_zh` text gating)
- Target modules: `src/lib/cto-workflow.js`, `src/commands/im.js`, `schemas/cto-workflow-plan.schema.json`, `tests/cto-workflow.test.js`, `tests/im.test.js`
- Minimal reversible scope:
  - Add lightweight `pending_interactions` and `interaction_status` fields to workflow state.
  - Keep `pending_question_zh` for compatibility during first step; write both fields in parallel.
  - Cover only the most common CTO confirmation path in batch-1.
- Acceptance checks:
  - Add transition tests for `running -> waiting_for_user -> running/completed`.
  - Verify duplicate inbound confirmation does not create duplicate interactions.
  - Workflow artifacts include interaction id/state/resolved_at.
- Risk level: Medium.

### 2) Per-workflow serialized event queue (prevent concurrent callback state races)
- Target modules: `src/commands/im.js`, `src/lib/cto-workflow.js`, `tests/im.test.js`
- Minimal reversible scope:
  - Add `Map<workflow_session_id, Promise>` queue in Telegram CTO runtime.
  - Serialize `applyWorkflowTaskResult`, `finalizeWorkflowStatus`, and workflow persistence per workflow.
  - Keep current parallel task limit (`MAX_PARALLEL_CTO_TASKS`) unchanged.
- Acceptance checks:
  - Fast consecutive updates on the same workflow produce one coherent final state.
  - No duplicate final message and no status rollback.
- Risk level: Medium-Low.

### 3) Telegram API retry/backoff with `retry_after` awareness
- Target modules: `src/commands/im.js`, `tests/im.test.js`
- Minimal reversible scope:
  - Turn `callTelegramApi` into a strategy-aware wrapper:
    - 429: retry using `retry_after` when available.
    - 5xx/network errors: bounded exponential backoff + jitter.
    - 4xx except 429: fail fast.
  - Keep existing call sites unchanged.
- Acceptance checks:
  - Simulated 429/5xx/4xx paths verify retry count and delay behavior.
  - Logs distinguish `retry_scheduled` vs `retry_exhausted`.
- Risk level: Low.

### 4) Move readiness gate to long-running IM entry points (`listen`/`supervise`)
- Target modules: `src/commands/im.js`, `src/commands/service.js`, `src/commands/doctor.js`, `tests/im.test.js`, `tests/doctor.test.js`
- Minimal reversible scope:
  - Add `checkImReadiness` for Codex availability, token validity, webhook state, and writable runtime paths.
  - Enforce gate before entering long polling/supervisor loop.
  - Expose checks in `doctor` with concrete next-step hints.
- Acceptance checks:
  - Missing critical prerequisites fail before loop startup.
  - `doctor` output contains actionable remediation text.
- Risk level: Low.

### 5) Standard event taxonomy (`event_code` + `severity`) for operations visibility
- Target modules: `src/commands/im.js`, `src/lib/summary.js`, docs under `docs/en` and `docs/zh`, `tests/im.test.js`
- Minimal reversible scope:
  - Add standard fields: `event_code`, `severity`, `workflow_session_id`, `task_id`.
  - First batch coverage: workflow start/finish, reroute, interaction pending/resolved, Telegram delivery retry.
  - Add fields incrementally without reformatting existing log structure.
- Acceptance checks:
  - Key lifecycle events are queryable by `event_code`.
  - Session summary can aggregate failure and waiting-for-confirmation counts.
- Risk level: Low.

## First-Batch Change Plan (start now, no external approvals)

### Batch-1 Task A: Implement Telegram API retry/backoff strategy
- Scope: `src/commands/im.js`, `tests/im.test.js`
- Deliverable: unified retry logic in `callTelegramApi` with deterministic tests.
- Done criteria: expected behavior for 429/5xx/4xx; no CLI interface change.

### Batch-1 Task B: Add per-workflow serialization queue in CTO runtime
- Scope: `src/commands/im.js`, `src/lib/cto-workflow.js`, `tests/im.test.js`
- Deliverable: serialized state writes per `workflow_session_id`.
- Done criteria: no duplicate finalization and no state regression under concurrent updates.

### Batch-1 Task C: Add IM readiness gate and wire into doctor
- Scope: `src/commands/im.js`, `src/commands/doctor.js`, `tests/doctor.test.js` (and `tests/im.test.js` if needed)
- Deliverable: pre-loop readiness checks for `listen/supervise` and matching doctor checks.
- Done criteria: fail-fast on missing prerequisites with explicit remediation guidance.

## Sequencing and rollback points
1. Task A first (lowest risk, highly localized).
2. Task B second (highest consistency benefit).
3. Task C third (push runtime failure to startup phase).

Rollback strategy: keep each task isolated and test-backed, so rollback can be done per task without coupling across the batch.

## Deferred from first batch
- Full interaction persistence/recovery across restarts.
- Log rotation and storage quota policy.
