#!/usr/bin/env bash
# Edu installer for macOS and Linux.
#   curl -fsSL https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.sh | bash
set -euo pipefail
ASSET="${EDU_ASSET:-https://github.com/EduardoMoraga/edu/releases/latest/download/edu-agent.tgz}"

echo
echo '  EDU - a second brain that learns, a crew you can see'
echo

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo '  Node.js 22 or newer is required: https://nodejs.org (or: brew install node)'
  exit 1
fi

echo '  Installing Edu...'
npm install -g "$ASSET" --no-fund --no-audit
echo "  Edu $(edu --version) installed."
echo
edu setup --yes
echo
echo '  Done. Open your favorite CLI (claude, codex, pi, opencode, agy) and ask: "what do you remember?"'
