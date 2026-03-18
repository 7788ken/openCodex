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
`remote inbox` reads the latest stored messages from the newest `remote` session.
`remote status` reads the latest `remote` session and prints a deployment-oriented status snapshot:

- bind scope and exposure label
- message count and latest message
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
- `--json`

### `remote status`

- `--cwd <dir>`
- `--json`

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

The newest `remote` session remains visible through `opencodex session` and `opencodex remote inbox`.
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
