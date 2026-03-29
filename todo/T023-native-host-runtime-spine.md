# T023 — Native Host Runtime Spine

## Objective

Refactor openCodex so bridge/runtime capabilities with real OS ownership do not depend on JS simply because JS is faster to write.

The main plan is:

- keep JS where it is genuinely valuable for orchestration and product logic
- move OS-integrated, privilege-sensitive, install-sensitive, or lifecycle-critical bridge/runtime surfaces into a native Swift host/runtime spine

## Why This Exists

The bridge mainline already needs stronger host ownership than a convenience-layer JS wrapper provides.
The pressure points are:

- tighter OS integration around launched Codex sessions
- stronger install/runtime ownership for the `codex` bridge path
- more privileged launch, PTY, and service behavior
- a cleaner host boundary for future mobile/session-control surfaces

If those surfaces stay in JS only for implementation convenience, the architecture is upside down.

## Scope

- native host launcher / service spine
- bridge-owned live-session runtime ownership
- PTY/input/output/session-control ownership
- future mobile/session-control publisher boundaries
- clear split between native host shell and JS orchestration core

## Non-Goals

- rewriting every openCodex module into Swift immediately
- removing JS from orchestration paths that do not benefit from native migration
- inventing a multi-language abstraction framework before the native split is proven

## Acceptance

- one explicit native-vs-JS boundary is documented
- OS-facing privileged surfaces are assigned to the native spine
- the refactor plan is incremental rather than a blind full rewrite
