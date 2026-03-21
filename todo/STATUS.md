# Status Log

## 2026-03-21

- Extended `T021` Phase 3 snapshot visibility for bridge-owned sessions:
  - added `opencodex bridge tail` to inspect recent output from a bridge-owned session
  - bridge runtime now captures child stdout/stderr into `bridge-output.log`
  - `opencodex bridge status` now surfaces recent output lines for the active bridge-owned session
  - validated with `node --test tests/bridge.test.js` and `node --test tests/doctor.test.js`
- Extended `T021` Phase 3 with the first external control path for bridge-owned live sessions:
  - added `opencodex bridge send` to queue external messages into the active bridge-owned session
  - added `opencodex bridge inbox` to inspect queued and delivered bridge messages
  - bridge runtime now uses a PTY relay for terminal launches and a pipe relay for non-TTY launches while keeping the same inbox-delivery model
  - validated with `node --test tests/bridge.test.js`, `node --test tests/doctor.test.js`, `node ./bin/opencodex.js bridge --help`, and `node ./bin/opencodex.js bridge status --json`
- Started `T021` Phase 3 with the first bridge-owned live-session slice:
  - `opencodex bridge exec-codex` now creates a bridge-owned session record under the workspace session store before launching the real Codex process
  - bridge runtime metadata now persists as `bridge-runtime.json` plus lifecycle events for launch/exit auditing
  - `opencodex bridge status` now reports the current active bridge-owned session through `~/.opencodex/bridge/active-session.json`
  - validated with `node --test tests/bridge.test.js` and `node --test tests/doctor.test.js`
- Completed `T021` Phase 2 implementation:
  - added `opencodex bridge install-shim`, `repair-shim`, and the internal `exec-codex` handoff path
  - persisted installed shim metadata in the global bridge state so detached installs can inspect the active control entrypoint
  - extended `doctor` with shim-health checks for visibility, PATH precedence, and recursion risk
  - hardened launcher inspection so bridge status/doctor detect the installed shim without recursively executing it
  - validated with `node --test tests/bridge.test.js`, `node --test tests/doctor.test.js`, `node ./bin/opencodex.js bridge --help`, and `node ./bin/opencodex.js bridge status --json`
- Started `T021` Phase 1 implementation:
  - added a first installed bridge state under `~/.opencodex/bridge/bridge.json`
  - added `opencodex bridge status` and `opencodex bridge register-codex`
  - extended `doctor` with bridge-state visibility so detached installs can verify the saved real Codex launcher
  - added focused bridge and doctor regression coverage
- Added `T021-installed-oc-codex-control-bridge.md` to define the next execution track:
  - installed openCodex becomes a path-independent control bridge over Codex CLI
  - the product keeps the `codex` habit instead of forcing users onto wrapper-only entrypoints
  - Telegram and remote control are explicitly redirected toward bridge-owned live sessions rather than misleading parallel workflows
- Synced `todo/README.md` and `todo/BOARD.md` so the new bridge task is visible in the task index and execution order.

## 2026-03-19

- Added selector-mismatch warning for explicit historical targeting:
  - `remote status --session-id latest` now warns when it resolves to a terminal session while active remote sessions still exist.
  - this prevents operators from mistaking historical diagnostics for the active bridge state.
- Added regression coverage for explicit-latest selector warning behavior in `tests/remote.test.js`.

- Brought selector diagnostics parity to human-readable output:
  - text-mode `remote inbox` / `remote status` now print `Session candidates: total <n>, active <n>` alongside selection mode.
- Added text-mode regression coverage for selector/candidate rendering in `tests/remote.test.js`.

- Added remote selector candidate statistics for explainable diagnostics:
  - `session_selection` now includes `candidate_count` and `active_candidate_count` for inbox/status JSON output.
  - this makes explicit/default selector outcomes auditable when multiple remote sessions coexist.
- Added regression assertions for selector candidate statistics in `tests/remote.test.js`.
- Synced EN/ZH remote docs and command-spec wording for selector statistics visibility.

- Extended explicit session targeting to remote inbox:
  - `remote inbox` now supports `--session-id <id|latest>` and uses the same selector contract as `remote status`.
  - text-mode inbox selection output now reuses the same explicit selection rendering (`explicit_latest(<requested>)`, `explicit_id(<requested>)`).
- Added regression coverage for inbox explicit targeting and missing-session fast-fail in `tests/remote.test.js`.
- Synced EN/ZH remote docs and command-spec docs for inbox/status selector parity.

- Added explicit remote-session targeting for operational diagnostics:
  - `remote status` now supports `--session-id <id|latest>` to inspect one exact remote session without relying on default active-first selection.
  - selection provenance now includes explicit modes (`explicit_latest`, `explicit_id`) and preserves requested selector metadata.
- Added regression coverage for explicit status targeting and missing-session fast-fail in `tests/remote.test.js`.
- Synced EN/ZH remote docs and command-spec docs with the new `remote status --session-id` surface.

- Added explicit remote session-selection provenance to operator surfaces:
  - `remote inbox` / `remote status` JSON now include `session_selection` (`active` or `latest_history`) with a short description.
  - text-mode `remote inbox` / `remote status` now print the same selection mode for quick diagnostics.
- Added regression assertions for `session_selection` metadata in `tests/remote.test.js` (active and fallback paths).
- Synced EN/ZH remote docs and command-spec wording to include session-selection source visibility.

- Tightened remote diagnostic session selection for deployment support:
  - `remote inbox` / `remote status` now prefer active `remote` sessions (`running` / `queued`) before falling back to the latest historical session record.
  - this avoids stale diagnostics when a newer completed remote session exists but another bridge is still active.
- Added regression coverage for active-session preference in both inbox and status paths (`tests/remote.test.js`).
- Synced remote docs and command-spec docs in English/Chinese to match the active-first session selection contract.

- Synced command-spec docs to reflect remote probe timing visibility in `remote status` (`probed_at` / `duration_ms`).

- Extended `remote status` probe diagnostics with timing metadata:
  - `health_probe` now includes `probed_at` and `duration_ms`
  - text-mode remote status now prints probe latency and timestamp when a probe is attempted
- Added regression coverage for remote probe timing metadata in both JSON and text output paths (`tests/remote.test.js`).

- Improved prune text readability for empty cleanup states:
  - `install prune` now renders explicit `(none)` placeholders when kept/removed sections are empty
  - avoids ambiguous blank sections in dry-run/no-slot scenarios
- Added regression coverage for empty-section prune text rendering in `tests/install.test.js`.

- Unified prune lifecycle timestamps across JSON and text surfaces:
  - `install prune` now includes `updated_at` for both kept and removed slots in JSON
  - text-mode prune output now renders those timestamps inline (including current-slot marking)
- Added regression coverage for prune timestamp fields and text-mode prune rendering in `tests/install.test.js`.

- Added slot timestamp visibility to install lifecycle status output:
  - `install status` JSON now includes `updated_at` for recency-ordered slots and prune preview candidates
  - text mode now shows the same timestamps inline for candidate and inventory rows
- Extended install status tests to assert deterministic timestamp rendering for preview and inventory lines.

- Improved slot inventory visibility in `install status` text mode:
  - status now prints `Slots (newest first)` and marks the active slot as `(current)`
  - this makes retention and pointer state readable without inspecting JSON fields

- Improved side-by-side retention readability in `install status` text mode:
  - when `--keep <n>` differs from the default, status now prints both preview and default-policy prune candidate counts
  - this makes retention impact comparison visible without switching to JSON

- Improved install lifecycle readability for operators in text mode:
  - `opencodex install status` now lists preview prune candidate slot names (`Prune Candidate Slots (preview)`) in addition to candidate counts
  - this keeps JSON and text surfaces aligned for pre-cleanup decisions
- Added regression coverage for text-mode preview candidate rendering in `tests/install.test.js`.

- Extended install lifecycle preview control in `opencodex install status`:
  - status now accepts `--keep <n>` to preview prune candidates under custom retention without deleting slots
  - status JSON now includes both preview (`prune_keep_preview`, `prune_candidate_count_preview`) and default-policy (`keep=3`) candidate fields
  - next-step guidance now mirrors non-default keep values when suggesting `install prune --dry-run`
- Added regression coverage for status keep-preview customization and invalid-keep validation in `tests/install.test.js`.

- Extended `opencodex install status` with detached-runtime lifecycle preview data:
  - status payload now includes `slots_total`, `current_slot_name`, and slot ordering by recency
  - status payload also includes default prune preview fields (`prune_keep_default=3`, candidate count, and candidate slots)
  - text-mode status now prints current slot, slot count, and prune candidate summary for the active preview keep value
- Added regression coverage for install lifecycle preview reporting in `tests/install.test.js`.
- Validation passed for the install lifecycle follow-up:
  - `node --test tests/install.test.js`

- Added a live health probe to `opencodex remote status` for running bridge sessions:
  - status payload now includes `health_probe` with attempted/ok/url/status fields
  - text-mode status now prints probe outcome and adds a direct warning when a running bridge fails health checks
- Added regression coverage for remote health-probe paths in `tests/remote.test.js`:
  - stale fixture path (probe attempted + failed)
  - live `remote serve` path (probe succeeds with `200` and `ok: true`)
- Validation passed for the remote follow-up:
  - `node --test tests/remote.test.js`

- Service workflow/dispatch aggregation now reconciles child-session contract metadata from child `session.json` artifacts, reducing stale parent-link fallback noise.
- Rehydrated supervisor resume handling was hardened so a tick re-reads persisted workflow/session state after acquiring the resume lease before resuming.
- Added regression coverage for stale parent child-session metadata vs child-session contract reconciliation in `tests/service.test.js`.
- Validated the resume-race hardening with focused coverage:
  - `node --test tests/im.test.js --test-name-pattern "does not duplicate a rehydrated workflow when two supervisor ticks race$"`
- Full regression is green after the follow-up:
  - `npm test` (`179/179`)
- Synced command and status docs to current service surface (`supervise`, workflow history/detail, settings/reset controls, contract-source and hydration notes).

## 2026-03-18

- Reviewed the retained `mobileCodexHelper` comparison notes after manual trimming and converted the surviving direction into a dedicated follow-up todo.
- Added `T020` to capture the next-stage mobile/web control-plane boundary:
  - phone surface stays narrow
  - user-facing deployment and troubleshooting need a clearer product surface
- Linked `T020` from `T010` as the follow-up boundary/productization track instead of keeping the comparison note as a standalone docs artifact.
- Drafted the formal mobile/web control-plane boundary note in both Chinese and English docs and linked `T020` to those design artifacts.
- Added `opencodex remote status` as a command-adjacent implementation follow-through for `T020`.
- `remote status` now outputs bind/exposure snapshot, message counters, success checks, and common troubleshooting hints in both text and JSON modes.
- Updated remote docs and command-spec docs in both languages to include the `status` subcommand and its deployment/diagnostic role.
- Reclassified `T020` from planned to partially implemented after the status/checklist follow-through landed.
- Extended `session repair` contract backfill for legacy auto child-session records:
  - when old child records miss `session_contract`, repair now infers command-aware fallback roles (`run -> executor`, `review -> reviewer`)
  - fallback contracts are persisted under `child_session` / `auto` scope with `supervisor_session_id` bound to the parent auto workflow
- `cto` repair fallback contract inference was also tightened for missing child metadata, using command/label/task context to map planner/reply/worker/reviewer roles when possible.
- Validation passed for contract-backfill follow-up:
  - `node --test tests/session-repair.test.js tests/session-cli.test.js`
  - `npm test` (full suite, `175/175`)
- Added `opencodex install prune` as a detached-runtime lifecycle cleanup command:
  - supports `--keep <n>` retention
  - supports `--dry-run` preview
  - always preserves the active `current` install target when present
- Added install lifecycle tests for prune apply/dry-run paths in `tests/install.test.js`.
- Updated install docs, install-layout docs, and command-spec docs in English and Chinese to include the `prune` surface.
- Validation passed for install lifecycle follow-up:
  - `node --test tests/install.test.js`
  - `npm test` (full suite)
- Added `session_contract_source` visibility across `session` and `service` JSON payloads:
  - normalized source enum is now explicit in output (`explicit`, `fallback`, `inferred`, `none`)
  - session list/show/latest/tree now report whether thread metadata came from stored contract data vs fallback/inference
  - service workflow/dispatch history and detail views now expose the same source marker for UI and tooling
- Added regression coverage for explicit/fallback/inferred source reporting in `tests/session-cli.test.js` and `tests/service.test.js`.
- Extended human-readable outputs to show contract provenance too:
  - `opencodex session list/show/tree` now prints `source <explicit|fallback|inferred>` when available
  - `service telegram workflow-history/workflow-detail/dispatch-detail` now show the same source marker in text mode
- Service history/detail aggregation now also hydrates child-session contract snapshots from child `session.json` records:
  - when parent `child_sessions` metadata is stale/missing, dispatch/workflow payloads can still surface explicit child contract metadata from the child session itself
  - this reduces avoidable `fallback` labels in `service telegram status` and `workflow-detail` when explicit child contracts already exist on disk
- Added regression coverage for stale-parent vs child-session contract reconciliation in `tests/service.test.js`.
- Hardened rehydrated supervisor resume lease handling:
  - after acquiring the resume lease, supervisor ticks now re-read the latest workflow/session artifacts and re-check rehydration eligibility before resuming
  - this prevents stale in-memory runtime state from re-running an already-finished rehydrated workflow during sequential supervisor races
- Validation for contract-hydration + resume-race hardening:
  - `node --test tests/service.test.js` (passed)
  - `node --test tests/im.test.js --test-name-pattern "does not duplicate a rehydrated workflow when two supervisor ticks race$"` (passed)
  - `npm test` (full suite, `179/179`)
- Validation passed for the source-visibility follow-up:
  - `node --test tests/session-cli.test.js tests/service.test.js`
  - `npm test` (full suite, `178/178`)

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
- Added a one-shot host-supervisor path outside Telegram polling: `im telegram supervise` can now resume persisted CTO workflows without starting the long-poll listener, and `service telegram supervise` reuses the installed service config to run the same tick.
- Service status/tray surfaces now also track the latest supervisor-tick session separately from the long-lived listener session, and the tray app can trigger `service telegram supervise` directly.
- The installed Telegram service now provisions and manages a second periodic launchd agent for supervisor ticks, so `start` / `stop` / `restart` no longer control only the listener process.
- The periodic supervisor agent is now configurable through `--supervisor-interval` at install time and `service telegram set-setting --key supervisor_interval_seconds --value ...`, with the tray settings surface exposing the same control.
- The installed service can now pause or resume the periodic supervisor agent through `service telegram set-setting --key supervisor_enabled --value on|off`, and the tray settings surface exposes the same toggle.
- Rehydrated Telegram CTO workflows now use a host-side resume lease, so concurrent supervisor ticks do not duplicate task execution or final replies for the same workflow.
- Host-executor job claiming now also uses a short filesystem lease, so concurrent listener/supervisor workers do not both claim the same rerouted task.
- Added shared `session-contract` helpers and wired them through `im`, `auto`, `run`, `review`, `session-store`, child-session capture, and service payloads so host/child role metadata is machine-readable.
- Service workflow/dispatch history and detail payloads now expose `thread_kind`, `thread_kind_label`, `session_role`, `session_scope`, `session_layer`, `execution_surface`, and `session_contract`.
- The legacy `session` CLI now also surfaces the same host/child thread metadata in `list`, `show`, `latest`, and `tree` output, including fallback child-session contract hints carried by parent workflow records.
- `session repair` now keeps and backfills `session_contract` metadata when rebuilding stale auto/cto child-session records, reducing one of the remaining fallback/inference gaps in historical session data.
- Reclassified `T013`, `T014`, and `T015` to mostly implemented after the runtime, contract, and UI-separation follow-up landed; the remaining gaps are a fully standalone host supervisor runtime plus legacy-session backfill.
- Validation passed for the follow-up supervisor/contract work: `node --test tests/auto.test.js tests/im.test.js tests/service.test.js`, `node --test tests/run.test.js tests/review.test.js`, `node --test tests/session-cli.test.js tests/session-repair.test.js`, and focused `im/service` supervisor coverage stayed green.

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
