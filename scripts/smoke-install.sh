#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TMP=$(mktemp -d)
cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

export HOME="$TMP/home"
export npm_config_cache="$TMP/npm-cache"
mkdir -p "$HOME" "$npm_config_cache" "$TMP/prefix"

VERSION=$(node -p "require('$ROOT/package.json').version")

npm pack "$ROOT" --pack-destination "$TMP" >"$TMP/pack.log"
(
  cd "$TMP"
  npm i -g --prefix "$TMP/prefix" edu-agent-*.tgz >"$TMP/install.log"
)

EDU="$TMP/prefix/bin/edu"
if [[ ! -x "$EDU" ]]; then
  echo "Expected installed edu binary to be executable at $EDU" >&2
  exit 1
fi

FIRST_LINE=$(head -n 1 "$EDU")
if [[ "$FIRST_LINE" != "#!/usr/bin/env node" ]]; then
  echo "Expected installed edu binary to preserve the Node shebang, got: $FIRST_LINE" >&2
  exit 1
fi

INSTALLED_VERSION=$("$EDU" --version)
if [[ "$INSTALLED_VERSION" != "$VERSION" ]]; then
  echo "Expected edu --version to print $VERSION, got $INSTALLED_VERSION" >&2
  exit 1
fi

HELP_OUTPUT=$("$EDU" --help 2>&1 || true)
if [[ "$HELP_OUTPUT" == *"under construction"* ]]; then
  echo "Notice: edu --help is not wired yet; version smoke check passed."
else
  "$EDU" --help >/dev/null
fi

echo "Smoke install passed for edu-agent@$VERSION"
