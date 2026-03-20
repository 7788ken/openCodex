# Remote Command

## Purpose

`opencodex remote` opens a phone-friendly message bridge into the local openCodex workspace.
It gives the maintainer a lightweight remote inbox without replacing Codex CLI as the local execution engine.

## First-Version Flow

The first version provides three subcommands:

- `opencodex remote serve`
- `opencodex remote inbox`
- `opencodex remote status`

`remote serve` starts a token-protected local HTTP server.
It creates a `remote` session, prints phone URLs, stores incoming messages in a session artifact, and keeps a normal openCodex audit trail.
`remote inbox` reads stored messages from the preferred `remote` session by default (active first, otherwise latest completed/failed record), and can explicitly target one session.
`remote status` reads the same selection model and prints a deployment-oriented status snapshot:

- session selection source (`active`, `latest_history`, `explicit_latest`, `explicit_id`) plus candidate counts (`candidate_count`, `active_candidate_count`)
- bind scope and exposure label
- message count and latest message
- live `/health` probe result (when the preferred remote session is running), including probe timestamp and latency
- success checks (health URL, form submit, inbox visibility)
- common troubleshooting hints

## Inputs

### `remote serve`

- `--cwd <dir>`
- `--host <host>`
- `--port <n>`
- `--token <value>`
- `--json`

### `remote inbox`

- `--cwd <dir>`
- `--limit <n>`
- `--session-id <id|latest>` (optional)
- `--json`

### `remote status`

- `--cwd <dir>`
- `--json`
- `--session-id <id|latest>` (optional, status only)

Session selection rules (`remote inbox` and `remote status`):

- default: prefer active `remote` session (`running` / `queued`), otherwise use latest history (`latest_history`)
- `--session-id latest`: force latest remote session by update time (`explicit_latest`)
- `--session-id <id>`: inspect exactly one stored remote session (`explicit_id`)
- when `explicit_latest` resolves to a terminal session while active sessions still exist, status emits a warning so operators do not confuse history with the active bridge

## HTTP Surface

The first version exposes:

- `GET /` — mobile-friendly HTML page
- `GET /health` — readiness check
- `GET /api/messages?token=...` — recent messages as JSON
- `POST /api/messages` — submit a message with token auth
- `POST /send` — HTML form submission path

Accepted auth inputs:

- `Authorization: Bearer <token>`
- `token` in the query string
- `token` in the JSON or form body

## Stored Artifacts

The bridge stores incoming messages in the active `remote` session artifact:

- `messages.jsonl` — append-only message log under the session artifacts directory

The preferred `remote` session remains visible through `opencodex session` and `opencodex remote inbox` (active first, fallback to the latest historical record).
Use `opencodex remote status` when you want a quick operational snapshot plus validation/troubleshooting guidance.

## Security Notes

- The first version is local-first and token-protected.
- The generated token should be treated like a password.
- For true internet reachability, place the local HTTP bridge behind a secure tunnel or VPN you control.
- openCodex does not ship a hosted relay service in this version.

## Non-Goals

The first version does not yet provide:

- a managed public relay
- multi-user identity
- remote control of a live Codex turn
- push notifications back to the phone
