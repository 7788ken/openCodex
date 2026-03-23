#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[openCodex bootstrap] %s\n' "$*"
}

fail() {
  printf '[openCodex bootstrap] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Bootstrap openCodex into a detached local runtime.

Default behavior:
1. clone openCodex into a temporary checkout
2. run `opencodex doctor`
3. build a runtime bundle
4. install a detached runtime, CLI shim, and app shell

Environment overrides:
  OPENCODEX_REPO_URL              Git URL to clone from
  OPENCODEX_REPO_REF              Git ref to clone (default: main)
  OPENCODEX_SOURCE_DIR            Use an existing checkout instead of cloning
  OPENCODEX_INSTALL_ROOT          Detached runtime root
  OPENCODEX_BIN_DIR               CLI shim directory
  OPENCODEX_APPLICATIONS_DIR      App shell directory
  OPENCODEX_BUNDLE_PATH           Bundle output path
  OPENCODEX_INSTALL_NAME          Optional detached install slot name
  OPENCODEX_DOCTOR_CWD            Workspace used by `opencodex doctor`
  OPENCODEX_BOOTSTRAP_SKIP_DOCTOR Set to 1 to skip `doctor`
  OPENCODEX_INSTALL_FORCE         Set to 0 to avoid passing --force
  OPENCODEX_OPEN_APP              Set to 1 to open OpenCodex.app after install
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

ensure_node_version() {
  if ! node -e 'const major = Number(process.versions.node.split(".")[0]); process.exit(Number.isFinite(major) && major >= 20 ? 0 : 1);'; then
    fail 'Node.js 20 or newer is required.'
  fi
}

ensure_codex_login() {
  if ! codex login status >/dev/null 2>&1; then
    fail 'Codex CLI is not logged in. Run `codex login` first.'
  fi
}

ensure_codex_version() {
  local minimum_version='0.116.0'
  local detected_line=''
  local detected_version=''

  if ! detected_line="$(codex --version 2>/dev/null | head -n 1)"; then
    fail 'Codex CLI version check failed. Run `codex --version` and fix the CLI installation.'
  fi

  detected_version="$(printf '%s' "$detected_line" | sed -nE 's/.*([0-9]+\.[0-9]+\.[0-9]+).*/\1/p')"
  if [[ -z "$detected_version" ]]; then
    fail "Could not parse Codex CLI version from: $detected_line"
  fi

  if ! node -e '
const [detected, required] = process.argv.slice(1);
const parse = (value) => value.split(".").map((part) => Number(part));
const [a1, a2, a3] = parse(detected);
const [b1, b2, b3] = parse(required);
const ok = (a1 > b1) || (a1 === b1 && a2 > b2) || (a1 === b1 && a2 === b2 && a3 >= b3);
process.exit(ok ? 0 : 1);
' "$detected_version" "$minimum_version"; then
    fail "Codex CLI $detected_version is too old. Require >= $minimum_version."
  fi
}

cleanup() {
  if [[ -n "${BOOTSTRAP_TMP_DIR:-}" && -d "${BOOTSTRAP_TMP_DIR:-}" ]]; then
    rm -rf "${BOOTSTRAP_TMP_DIR}"
  fi
}

main() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    usage
    exit 0
  fi

  local repo_url="${OPENCODEX_REPO_URL:-https://github.com/7788ken/openCodex.git}"
  local repo_ref="${OPENCODEX_REPO_REF:-main}"
  local source_dir="${OPENCODEX_SOURCE_DIR:-}"
  local install_root="${OPENCODEX_INSTALL_ROOT:-$HOME/Library/Application Support/OpenCodex}"
  local bin_dir="${OPENCODEX_BIN_DIR:-$HOME/.local/bin}"
  local applications_dir="${OPENCODEX_APPLICATIONS_DIR:-$HOME/Applications}"
  local bundle_path="${OPENCODEX_BUNDLE_PATH:-$HOME/.local/share/openCodex/dist/opencodex-runtime-bootstrap.tgz}"
  local install_name="${OPENCODEX_INSTALL_NAME:-}"
  local doctor_cwd="${OPENCODEX_DOCTOR_CWD:-$HOME}"
  local skip_doctor="${OPENCODEX_BOOTSTRAP_SKIP_DOCTOR:-0}"
  local install_force="${OPENCODEX_INSTALL_FORCE:-1}"
  local open_app="${OPENCODEX_OPEN_APP:-0}"
  local checkout_dir=""
  local bundle_args=()
  local detached_args=()

  require_command git
  require_command node
  require_command codex
  ensure_node_version
  ensure_codex_version
  ensure_codex_login

  if [[ -n "$source_dir" ]]; then
    checkout_dir="$(cd "$source_dir" && pwd)"
    [[ -f "$checkout_dir/bin/opencodex.js" ]] || fail "OPENCODEX_SOURCE_DIR does not look like an openCodex checkout: $checkout_dir"
    log "Using existing checkout: $checkout_dir"
  else
    BOOTSTRAP_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opencodex-bootstrap-XXXXXX")"
    trap cleanup EXIT
    checkout_dir="$BOOTSTRAP_TMP_DIR/openCodex"
    log "Cloning $repo_url#$repo_ref"
    git clone --depth 1 --branch "$repo_ref" "$repo_url" "$checkout_dir"
  fi

  mkdir -p "$(dirname "$bundle_path")" "$doctor_cwd"
  cd "$checkout_dir"

  if [[ "$skip_doctor" != "1" ]]; then
    log 'Running doctor'
    node ./bin/opencodex.js doctor --cwd "$doctor_cwd"
  fi

  bundle_args=(node ./bin/opencodex.js install bundle --output "$bundle_path")
  if [[ "$install_force" != "0" ]]; then
    bundle_args+=(--force)
  fi
  log "Building runtime bundle at $bundle_path"
  "${bundle_args[@]}"

  detached_args=(
    node ./bin/opencodex.js install detached
    --bundle "$bundle_path"
    --root "$install_root"
    --bin-dir "$bin_dir"
    --applications-dir "$applications_dir"
  )
  if [[ -n "$install_name" ]]; then
    detached_args+=(--name "$install_name")
  fi
  if [[ "$install_force" != "0" ]]; then
    detached_args+=(--force)
  fi
  log 'Installing detached runtime'
  "${detached_args[@]}"

  log 'Inspecting detached runtime'
  node ./bin/opencodex.js install status \
    --root "$install_root" \
    --bin-dir "$bin_dir" \
    --applications-dir "$applications_dir"

  if [[ "$open_app" == "1" && "$(uname -s)" == "Darwin" && -d "$applications_dir/OpenCodex.app" ]]; then
    require_command open
    log 'Opening OpenCodex.app'
    open "$applications_dir/OpenCodex.app"
  fi

  log "Bootstrap install completed. If \`opencodex\` is not on PATH yet, add $bin_dir to PATH."
}

main "$@"
