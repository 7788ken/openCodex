# Architecture

## Core Decision

openCodex is built on top of Codex CLI.
It does not aim to replace or reimplement the local coding engine provided by Codex CLI.

## Layered Model

### Layer 1 — Codex CLI

Codex CLI is the local execution engine.
It is responsible for:

- repository-aware execution
- file editing
- shell command execution
- sandbox and approval controls
- machine-readable command surfaces

### Layer 2 — openCodex Runtime

openCodex provides the orchestration layer on top of Codex CLI.
It is responsible for:

- workflow packaging
- command presets
- session normalization
- result summaries
- policy and profile mapping
- project-level conventions
- same-machine task coordination

### Layer 2A — Host Supervisor

The openCodex CTO should live here.
This host-resident supervisor is responsible for:

- CEO-facing identity and long-lived thread ownership
- workflow state, routing, and queue supervision
- dispatching CTO task execution onto the host Codex CLI path instead of letting the current control surface become the executor
- deciding when to continue, reroute, stop, or ask for confirmation
- merging advice from child sessions into one coherent CTO response
- owning tray, Telegram, and other persistent control surfaces

### Layer 2B — Sandbox Advisor Sessions

Sandbox child sessions should be subordinate helpers, not the CTO identity.
They can act as:

- planners
- analysts
- reviewers
- narrowly scoped implementation helpers

They must not become the supervisor of record.
The host supervisor owns the final decision, status, and user-facing reply.

## Installed Product Boundary

The installed app surface, CLI surface, and long-lived services should share one detached runtime root.
They should not use a source checkout as the default launcher of record.
See `install-layout.md` for the current packaging direction.

### Layer 3 — openCodex Gateway

This layer is reserved for later phases.
It can provide:

- remote entry points
- chat or web triggers
- session routing
- long-running control surfaces

## MVP Boundary

The MVP focuses on Layer 2.
The first commands should be thin wrappers around stable Codex CLI surfaces.

Recommended MVP path:

- `opencodex run` -> the primary local work surface
- `opencodex session` -> local trace and coordination surface
- `opencodex doctor` -> supporting readiness checks
- `opencodex review` -> second-wave review workflow
- `opencodex service` / `opencodex im` -> host-supervisor control surfaces for CTO mode

## Explicit Non-Goals

The first version should not:

- rebuild a local coding engine
- let a sandbox child session become the CTO identity
- reduce the product to a health-check utility
- parse interactive TUI text as a primary contract
- depend on experimental app-server features
- expand into a gateway platform before the local CLI flow works well
