#!/usr/bin/env bash
# Install matrix (manual / CI; not part of `npm test`).
#
#   scripts/install-matrix.sh                 # node:22-bookworm-slim and node:24-alpine in Docker
#   scripts/install-matrix.sh node:26-slim    # any images that already have Node >= 22
#   scripts/install-matrix.sh --local         # the same case on this machine, in a temp HOME
#
# Packs this checkout (`npm pack`), then runs scripts/install-matrix-case.sh per image: install.sh from
# the local package with a fake HOME and stub claude/codex/pi/opencode/agy, `edu setup --yes`, doctor,
# `edu bench context --json`, the session-start hooks, `edu uninstall --yes` twice, and a byte-for-byte
# comparison of HOME outside ~/.edu. Needs the npm registry for dependencies; nothing else.
#
# Not covered: ubuntu:24.04 without Node. install.sh would fetch fnm from GitHub and Node from
# nodejs.org, which is network beyond npm.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
LOCAL=0
IMAGES=()
for arg in "$@"; do
  case "$arg" in
    --local) LOCAL=1 ;;
    -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) IMAGES+=("$arg") ;;
  esac
done
[[ ${#IMAGES[@]} -gt 0 ]] || IMAGES=(node:22-bookworm-slim node:24-alpine)

OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
echo "Packing $ROOT"
(cd "$ROOT" && npm pack --pack-destination "$OUT" >"$OUT/pack.log" 2>&1) || { cat "$OUT/pack.log"; exit 1; }
mv "$OUT"/edu-agent-*.tgz "$OUT/edu-agent.tgz"
cp "$ROOT/scripts/install.sh" "$ROOT/scripts/install-matrix-case.sh" "$OUT/"
chmod -R a+rX "$OUT"

declare -a RESULTS=()
status=0
run_case() {
  local name=$1; shift
  local started=$SECONDS
  if "$@" >"$OUT/$name.log" 2>&1; then RESULTS+=("PASS  $name  $((SECONDS - started))s")
  else status=1; RESULTS+=("FAIL  $name  $((SECONDS - started))s"); fi
  sed 's/^/  /' "$OUT/$name.log"
}

if [[ $LOCAL == 1 ]]; then
  echo "Case: local ($(node --version))"
  run_case local env EDU_MATRIX_PKG="$OUT" EDU_MATRIX_WORK="$OUT/local" sh "$OUT/install-matrix-case.sh"
else
  command -v docker >/dev/null || { echo "docker not found; use --local" >&2; exit 1; }
  docker info >/dev/null 2>&1 || { echo "cannot reach the Docker daemon (permissions?); use --local" >&2; exit 1; }
  for image in "${IMAGES[@]}"; do
    echo "Case: $image"
    name=$(printf '%s' "$image" | tr '/:' '__')
    run_case "$name" docker run --rm -v "$OUT:/pkg:ro" -e EDU_MATRIX_PKG=/pkg -e EDU_MATRIX_WORK=/tmp/matrix "$image" sh /pkg/install-matrix-case.sh
  done
fi

echo
echo "Install matrix"
printf '  %s\n' "${RESULTS[@]}"
exit $status
