# Status Log

## 2026-03-12

- Audited the `todo/` board against the current codebase and corrected several overstated or stale status labels.
- Initially marked `T013`, `T014`, and `T015` as only partially implemented during the doc audit: the host-supervisor direction was real, but the runtime/contract/UI closure still lagged the design docs.
- Marked `T016` as mostly implemented in the Telegram CTO path rather than still being purely planned.
- Updated `T017` to reflect the real detached-install state: bundle/install/status flow, relink path, and bootstrap installer now exist, even though broader packaging polish is still pending.
- Added `T018` and fixed Telegram CTO follow-up status binding so colloquial questions like `这个任务完成没有？` now report the latest relevant workflow instead of starting a new empty workflow.
- Added `T019` and expanded host-executor reroute detection so sandbox-blocked `partial` export tasks can continue automatically on the host executor.
- Telegram CTO regression coverage now includes colloquial waiting-workflow follow-ups and a Downloads-style export task that first hits `Operation not permitted` and then completes after reroute.
- Validation passed for the Telegram CTO follow-up/reroute fixes: `node --test tests/cto-workflow.test.js` and `node --test tests/im.test.js`.
- Follow-up implementation closed the ordinary running-workflow restart gap in the Telegram CTO listener, so rehydrated workflows can now resume queued downstream tasks and finish after listener restart.
- Follow-up implementation also closed the planning-stage restart gap: a rehydrated Telegram CTO workflow can now wait for its planner child session, reuse the returned plan, and continue execution after listener restart.
- Added shared `session-contract` helpers and wired them through `im`, `auto`, `run`, `review`, `session-store`, child-session capture, and service payloads so host/child role metadata is machine-readable.
- Service workflow/dispatch history and detail payloads now expose `thread_kind`, `thread_kind_label`, `session_role`, `session_scope`, `session_layer`, `execution_surface`, and `session_contract`.
- The legacy `session` CLI now also surfaces the same host/child thread metadata in `list`, `show`, `latest`, and `tree` output, including fallback child-session contract hints carried by parent workflow records.
- `session repair` now keeps and backfills `session_contract` metadata when rebuilding stale auto/cto child-session records, reducing one of the remaining fallback/inference gaps in historical session data.
- Reclassified `T013`, `T014`, and `T015` to mostly implemented after the runtime, contract, and UI-separation follow-up landed; the remaining gaps are a fully standalone host supervisor runtime plus legacy-session backfill.
- Validation passed for the follow-up supervisor/contract work: `node --test tests/auto.test.js tests/im.test.js tests/service.test.js` and `node --test tests/run.test.js tests/review.test.js`.

## 2026-03-10

- Fixed a merge-conflict residue in `src/commands/run.js` that was blocking the CLI from starting.
- `opencodex service telegram install` now refuses by default to bind a long-lived service to the current source checkout; `--allow-project-cli` is required for an intentional temporary coupling.
- Service status now exposes launcher provenance (`launcher_scope`, `cli_path`, `node_path`, `launcher_warning`) so checkout-coupled installs are visible without opening raw config files.
- Added `opencodex service telegram relink --cli-path <path>` so an existing Telegram service can move to a detached openCodex launcher without a full uninstall/reinstall cycle.
- Added shared launcher detection helpers and updated `doctor` to warn when either the current launcher or an installed Telegram service still points at a source checkout.
- Added install-layout documents in English and Chinese, plus `T017`, to define the detached runtime boundary for the app surface, CLI shim, and long-lived services.
- Added `opencodex install detached` / `status` as the first detached-runtime installer skeleton, with versioned runtime copies, a `current` pointer, and a user CLI shim.
- The detached installer now also compiles a thin `OpenCodex.app` host shell, so the installed app surface and CLI shim share the same `current` runtime.
- The detached installer now reports both `current` and version-slot CLI paths, so `service relink` can target `current/bin/opencodex.js` and follow future upgrades.
- Telegram services now default to a user workspace under `~/.opencodex/workspaces/telegram-cto`, keep a service-local `cto-soul.md`, and support `set-workspace` migration with session-history carry-forward.
- Service and doctor docs were updated in English and Chinese to document the launcher-boundary workflow.
- Validation passed for the launcher-boundary and installer-skeleton changes: `node --test tests/install.test.js`, `tests/doctor.test.js`, and focused `tests/service.test.js` coverage are green.

## 2026-03-08

- CTO authorization confirmed by project owner.
- Delivery mode set to proactive execution for low-risk changes.
- Execution decision confirmed: openCodex wraps Codex CLI instead of rebuilding a local coding engine.
- Product direction confirmed: `run` is the main local work surface; `session` is the same-machine coordination surface; `doctor` is support-only.

- T001 completed: Codex CLI integration surfaces inventoried.
- T002 initial command specification documented in English and Chinese.
- T005 initial session and summary model documented in English and Chinese.
- Architecture decision documented: openCodex uses Codex CLI as the local execution layer.

- First CLI skeleton implemented: `run`, `session`, and `doctor` commands now exist.
- T003 initial run wrapper implemented with session storage and structured summary output.
- T004 initial review wrapper implemented and connected to the CLI.
- T006 initial profile layer implemented with `safe` and `balanced` presets for `run` and `review`.
- T007 initial doctor command implemented as support tooling.

- Review and doctor command docs added in both English and Chinese.
- `session latest` added to improve same-machine handoff and local coordination.
- `session repair` added to repair stale queued/running sessions based on terminal evidence.
- Review summary extraction improved to prefer the final Codex conclusion instead of transport metadata.
- `run` default schema path fixed to resolve from the package, not the caller working directory.
- Run summary schema updated to keep optional sections (`risks`, `validation`, `changed_files`, `findings`) without breaking Codex structured output.

- Validation passed: `npm test` is green.
- Real `doctor` validation passed against the local Codex CLI environment.
- Real `run` validation now completes successfully against the local Codex CLI and stores a finished session.
- Real review parsing was validated against a saved real `review-report.txt` artifact and now extracts the actual conclusion instead of transport metadata.
- Review parsing now extracts structured findings (`priority`, `title`, `location`, `detail`) from standard `Full review comments:` blocks.
- Project-level profile defaults now load from `opencodex.config.json`, with command-specific overrides and parent-directory lookup.
- Human-readable session output now renders both string findings and structured review findings.
- Removed unused `src/lib/process.js` to reduce duplicate process wrappers.
- Added a stable saved `review-report.txt` fixture so parser tests cover the real Codex review format.
- `src/lib/session.js` now reuses `session-store` helpers instead of duplicating session ID and path assembly logic.
- `T009` added and prioritized: unattended local execution is now the next product track after the current wrapper surfaces.
- First `opencodex auto` command implemented as a thin unattended workflow over `session repair`, `run`, and optional `review`.
- `opencodex auto` now creates a parent auto session, records child sessions, and supports `--max-iterations` plus review-driven continuation.
- `opencodex auto` now prefers stable `--output` files to capture child session IDs and summaries, reducing dependence on human-readable stdout parsing.
- `run` and `review` child sessions now record `parent_session_id`, and `auto` supports `--run-retries` for lightweight unattended recovery.
- `auto` failure policy is now covered by tests for `--fail-on-review`, and retry attempts persist `auto_iteration` / `auto_attempt` metadata on child run sessions.
- Review parsing now preserves non-clean plain-text conclusions as fallback findings, so `auto` no longer treats an unparsed review as a clean pass.
- `session repair` now requires terminal evidence before rewriting stale `queued` or `running` sessions.
- Validation passed again after the unattended workflow correctness fixes: `npm test` is green with 32 passing tests.
- `opencodex auto` now supports `--resume <session-id|latest>` by starting a new parent auto session and linking it back to the previous workflow.
- `opencodex session tree <id>` now renders parent/child lineage for local workflow traceability, with fallback links from stored `child_sessions`.
- Plain-text clean review detection is now stricter, so mixed conclusions like `looks good overall, but ...` still remain findings instead of being treated as clean.
- Run summary normalization and schema now preserve structured findings objects instead of dropping them.
- `session repair` now restores completed stale run summaries from `last-message.txt` when that artifact is already on disk.
- `review` now rejects conflicting target selectors and keeps stderr diagnostics visible even when stdout was already written before failure.
- `session repair` now recovers stale `review` and `auto` sessions from their command-specific artifacts instead of leaving them stuck in `running`.
- Validation passed again after the review/session recovery fixes: `npm test` is green with 44 passing tests.
- `session repair` now preserves failed stale review sessions when `review-report.txt` embeds a trailing `stderr:` footer, and strips that footer before rebuilding the review summary.
- `opencodex auto` retry cleanup now repairs fresh stale child sessions immediately before the next attempt instead of waiting for the default 10-minute stale threshold.
- Run summary schemas now accept both string findings and structured findings using a Codex-compatible schema subset that avoids `oneOf`.
- Validation passed again after the stale review/schema/retry fixes: `npm test` is green with 46 passing tests.
- `opencodex auto` retry cleanup now skips the currently running parent auto session, so immediate stale repair does not rewrite the live workflow itself.
- `opencodex auto --resume` now continues from the stored `iteration_count`, so resumed workflows keep the right iteration numbers and stop budget.
- `opencodex auto` now rejects conflicting review target selectors to match `opencodex review`.
- Validation passed again after the resume/retry-target fixes: `npm test` is green with 52 passing tests.
- `opencodex remote` MVP added: a token-protected local HTTP bridge now lets a phone submit messages into the current workspace and stores them in a `messages.jsonl` session artifact.
- `opencodex remote inbox` now exposes the latest mobile messages from the newest `remote` session through the CLI so the local agent can pick them up.
- Validation passed again after the remote bridge MVP: `npm test` is green with 54 passing tests.
- `opencodex im` MVP added with Telegram `listen`, `inbox`, and `send`, so phone connectivity no longer depends on a changing local IP.
- Telegram listeners now store normalized inbound messages in `telegram-updates.jsonl`, preserve polling state in `telegram-state.json`, and send automatic acknowledgement replies back to the same chat.
- `opencodex im telegram listen --cto` now delegates inbound messages to local `opencodex run`, links the resulting child sessions back to the Telegram session, and sends the Codex CLI result back to the same chat.
- `--cto` now requires an explicit `--chat-id <id>` for safety, and delegated run records are stored in `telegram-runs.jsonl`.
- Validation passed again after the Telegram CTO delegation loop: `npm test` is green with 59 passing tests.


## 2026-03-09

- `opencodex service telegram dispatch-detail` added so one task record can be expanded into a UI-friendly execution summary.
- `opencodex service telegram task-history` added so the tray app can browse the full known dispatch history instead of only the latest 5 records.
- The macOS tray app now shows task-history count in `status`, adds `Browse Task History…`, and opens a detail dialog with shortcuts to the task record, raw events, and last task message.
- Service and command-spec docs were updated in both English and Chinese to keep the tray workflow surface documented.
- Validation passed again after the tray task-history work: `npm test` is green with 76 passing tests.
- Telegram CTO follow-up queries now support `最近任务` / `任务历史` / `recent tasks` / `task history`, returning a compact task-history summary without creating a new workflow.
- Validation passed again after the Telegram task-history reply work: `npm test` is green with 77 passing tests.
