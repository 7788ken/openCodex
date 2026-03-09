# T010 — Remote Mobile Bridge

## Objective

Let a phone send messages into the local openCodex workspace without requiring direct terminal access.

## Why Now

The project already has strong same-machine workflows, but the maintainer explicitly wants a phone-to-openCodex remote entry point.
A minimal HTTP bridge is the fastest path that still fits the thin-wrapper strategy on top of Codex CLI.

## Scope

- Add a `remote` command surface.
- Start a token-protected local HTTP server.
- Save inbound phone messages as local artifacts.
- Expose a CLI inbox reader for the latest bridge session.

## First-Version Shape

Suggested commands:

- `opencodex remote serve`
- `opencodex remote inbox`

Suggested first capabilities:

- mobile-friendly HTML form
- JSON API submission
- token-based auth
- session-backed artifact log
- local-only bridge by default

## Non-Goals

The first version should not try to:

- ship a managed relay service
- introduce account systems or OAuth
- send push notifications to the phone
- control a live Codex process remotely

## Acceptance Criteria

- A phone can submit a message through the bridge with a shared token.
- openCodex stores the message in a durable local artifact.
- The latest bridge messages are inspectable through the CLI.
- The implementation stays dependency-light and local-first.

## Current Status

- MVP implemented with `remote serve` and `remote inbox`.
- Mobile messages are saved into the active `remote` session artifact `messages.jsonl` and tracked through a normal `remote` session.
- The root page serves a mobile-friendly form and `/api/messages` supports token-authenticated JSON access.
