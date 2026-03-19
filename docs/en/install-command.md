# Install Command

## Purpose

`opencodex install` creates or inspects a detached local runtime so the installed CLI and long-lived services do not depend on a source checkout.

## First-Version Scope

The first version supports:

- `opencodex install bundle`
- `opencodex install detached`
- `opencodex install status`
- `opencodex install prune`

`bundle` creates a portable runtime artifact that can be handed off outside the current checkout.
`detached` installs a versioned runtime tree, rewrites a `current` pointer, creates a user CLI shim, and compiles a thin `OpenCodex.app` shell that points at the same `current` runtime.
That app shell is intentionally lightweight and delegates work back to the installed CLI runtime.

## Bootstrap Script

For a one-command install from a terminal or Codex session, the repository now ships:

```bash
curl -fsSL https://raw.githubusercontent.com/7788ken/openCodex/main/scripts/install-opencodex.sh | bash
```

That script defaults to the detached install flow:

1. clone openCodex
2. run `doctor`
3. run `opencodex install bundle`
4. run `opencodex install detached --bundle <path>`

If you already have a local checkout, you can reuse it with:

```bash
OPENCODEX_SOURCE_DIR="$PWD" bash ./scripts/install-opencodex.sh
```

## Inputs

### `bundle`

- `--output <path>`; default: `./dist/opencodex-runtime-<version>-<timestamp>.tgz`
- `--force`
- `--json`

### `detached`

- `--root <dir>`; default: `~/Library/Application Support/OpenCodex`
- `--bin-dir <dir>`; default: `~/.local/bin`
- `--applications-dir <dir>`; default: `~/Applications`
- `--bundle <path>`; optional packaged runtime artifact or extracted bundle directory
- `--name <id>`; optional install slot name
- `--link-source`; link the install slot back to the current checkout instead of copying files; development only
- `--force`
- `--json`

### `status`

- `--root <dir>`
- `--bin-dir <dir>`
- `--applications-dir <dir>`
- `--keep <n>`; preview prune candidates using retention `n` (no deletion)
- `--json`

### `prune`

- `--root <dir>`
- `--keep <n>`; keep at most `n` install slots (always preserving the current target when present), default `3`
- `--dry-run`; report candidates without deleting
- `--json`

## Output

`bundle` reports:

- the created bundle path
- whether the bundle is an archive or directory
- the packaged runtime version
- the provenance of the source used to create that bundle

`detached` reports:

- the versioned runtime path
- the `current` CLI path for `service relink`
- the `current` pointer location
- the CLI shim path
- the installed app bundle path and generated app source path
- launcher provenance for the installed runtime
- whether the install came from a direct copy, a source link, or a packaged bundle
- bundle provenance when `--bundle` was used

`status` reports whether the detached runtime, CLI shim, and app shell are present, and which runtime `current` resolves to.
It also reports install-slot lifecycle metadata, including total slot count, the current slot name, and prune preview signals.
By default the preview uses `keep=3`, and `--keep <n>` can be used to preview a different retention policy before running `prune`.
If the install was created from a bundle, `status` also reports the bundle path plus the original source provenance captured in the bundle manifest.

`prune` reports which install slots were kept or removed, and supports a dry-run mode for previewing cleanup before applying it.

## Preferred Flow

For product-like installs, prefer:

1. `opencodex install bundle`
2. `opencodex install detached --bundle <path>`

Direct `install detached` from a live checkout still exists for local development convenience, but it is no longer the recommended handoff path.
If you want the installed CLI and app shell to follow your current repository without reinstalling after each edit, use `opencodex install detached --link-source`.
That mode is for active local development only and keeps the runtime intentionally coupled to the checkout.

## Non-Goals

The first version does not:

- build a notarized desktop application
- install a system-wide launcher
- mutate existing Telegram services automatically
