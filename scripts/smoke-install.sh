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

VERSION=$(cd "$ROOT" && node -p "require('./package.json').version")

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) WINDOWS=1 ;;
  *) WINDOWS=0 ;;
esac

npm pack "$ROOT" --pack-destination "$TMP" >"$TMP/pack.log"
(
  cd "$TMP"
  npm i -g --prefix "$TMP/prefix" edu-agent-*.tgz >"$TMP/install.log"
)

# npm places global bins in <prefix>/bin on POSIX and directly in <prefix> on Windows.
if [[ "$WINDOWS" == 1 ]]; then
  EDU="$TMP/prefix/edu"
  ENTRY="$TMP/prefix/node_modules/edu-agent/dist/cli.js"
else
  EDU="$TMP/prefix/bin/edu"
  ENTRY="$TMP/prefix/lib/node_modules/edu-agent/dist/cli.js"
fi

if [[ ! -f "$EDU" ]]; then
  echo "Expected installed edu binary at $EDU" >&2
  exit 1
fi
if [[ "$WINDOWS" == 0 && ! -x "$EDU" ]]; then
  echo "Expected installed edu binary to be executable at $EDU" >&2
  exit 1
fi

FIRST_LINE=$(head -n 1 "$ENTRY" | tr -d '\r')
if [[ "$FIRST_LINE" != "#!/usr/bin/env node" ]]; then
  echo "Expected the installed CLI entry to keep the Node shebang, got: $FIRST_LINE" >&2
  exit 1
fi

INSTALLED_VERSION=$("$EDU" --version | tr -d '\r')
if [[ "$INSTALLED_VERSION" != "$VERSION" ]]; then
  echo "Expected edu --version to print $VERSION, got $INSTALLED_VERSION" >&2
  exit 1
fi

"$EDU" --help >/dev/null

echo "Smoke install passed for edu-agent@$VERSION"
