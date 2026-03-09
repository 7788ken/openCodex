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

## Explicit Non-Goals

The first version should not:

- rebuild a local coding engine
- reduce the product to a health-check utility
- parse interactive TUI text as a primary contract
- depend on experimental app-server features
- expand into a gateway platform before the local CLI flow works well
