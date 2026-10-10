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

# The one-line installer, in dry-run mode against fake Node binaries (no network, no sudo, no tty).
mkdir -p "$TMP/node20" "$TMP/node22"
printf '#!/bin/sh\necho 20\n' >"$TMP/node20/node"
printf '#!/bin/sh\necho 22\n' >"$TMP/node22/node"
chmod +x "$TMP/node20/node" "$TMP/node22/node"
if [[ "$WINDOWS" == 0 ]]; then
  if PATH="$TMP/node20:/usr/bin:/bin" EDU_DRY_RUN=1 EDU_LANG=en sh "$ROOT/scripts/install.sh" </dev/null >"$TMP/old-node.log" 2>&1; then
    echo "Expected install.sh to stop when Node is older than 22" >&2
    exit 1
  fi
  grep -q 'nodejs.org' "$TMP/old-node.log" || { echo "install.sh did not explain how to install Node" >&2; exit 1; }
  PATH="$TMP/node22:/usr/bin:/bin" EDU_DRY_RUN=1 EDU_LANG=es sh "$ROOT/scripts/install.sh" >"$TMP/dry.log"
  grep -q '\[dry-run\] npm install -g' "$TMP/dry.log" || { echo "install.sh did not plan the npm install" >&2; exit 1; }
  grep -q 'edu create <documento> --name <NombreDelAgente>' "$TMP/dry.log" || { echo "install.sh did not print the Spanish next steps" >&2; exit 1; }
fi

echo "Smoke install passed for edu-agent@$VERSION"
