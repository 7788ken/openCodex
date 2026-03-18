# T017 — Detached Install Layout and Packaging Surface

## Objective

Define and later implement a detached installation layout where the openCodex app surface, CLI surface, and long-lived services share one installed runtime instead of binding to a source checkout.

## Why Now

The repository already has a tray app, Telegram `launchd` service, and CLI workflow surfaces.
Without an explicit install boundary, those surfaces can accidentally bind to the development checkout.
That breaks the separation between project work and installed product runtime.

## Scope

- Define the first supported install layout for macOS.
- Keep App, CLI, and `launchd` services on the same versioned runtime.
- Keep mutable user state outside the installed runtime tree.
- Define upgrade and relink behavior for long-lived services.
- Preserve an explicit opt-in path for temporary checkout-coupled local debugging.

## Acceptance Criteria

- The install layout specifies exact runtime, shim, app, and state paths.
- The app surface and CLI surface are documented as coexisting on one detached runtime.
- Long-lived services default to the detached launcher instead of a source checkout.
- Legacy checkout-coupled installs have a documented repair path.

## Current Status

- Partially implemented, beyond the earlier “docs + skeleton” stage.
- The repository now has `install bundle`, `install detached`, `install status`, `install prune`, Telegram service relink support, and a one-command bootstrap installer script.
- `install status` now also exposes install-slot lifecycle visibility (slot count, current slot, and default prune preview) so runtime cleanup can be planned before `install prune`.
- The detached runtime, CLI shim, app shell, launcher provenance checks, and repair/relink path are all covered by focused install and service tests.
- The remaining work is broader product packaging and lifecycle polish, not the core detached-runtime boundary itself.
