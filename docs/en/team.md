# Team Structure

This document defines the initial project team structure for openCodex.
The role names are fixed internal nicknames used for task assignment and coordination.

## Leadership

- `CTO` — Lao Zhou
  - Owns technical direction, architecture review, execution standards, and final technical decisions.

## Core Team

- `Product Lead` — A Feng
  - Owns scope definition, milestone shaping, and feature priority.

- `Runtime Architect` — Lao Qin
  - Owns core architecture, session model, policy model, and long-term technical coherence.

- `CLI Engineer` — Xiao Lin
  - Owns wrapper CLI implementation and command behavior.

- `Tooling Engineer` — A Jie
  - Owns Codex CLI integration, MCP-related interfaces, and local developer tooling.

- `QA Lead` — Lao Yan
  - Owns validation strategy, regression checks, health checks, and release readiness.

- `DX Writer` — Xiao Tang
  - Owns README quality, bilingual docs, examples, and onboarding clarity.

- `Gateway Engineer` — Da Liu
  - Owns future gateway exploration, external entry points, and always-on session routing research.

## Management Rules

- All implementation work should have a single directly responsible owner.
- Cross-cutting tasks may have one owner and one reviewer, but not multiple owners.
- `CTO` can reassign work across the team based on priority or risk.
- The current team is role-based and can be expanded later without renaming existing members.
