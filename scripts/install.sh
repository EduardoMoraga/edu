#!/bin/sh
# Edu installer for macOS and Linux (POSIX sh).
#   curl -fsSL https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.sh | sh
#
# 1. Node.js >= 22: kept if present; on macOS with Homebrew, `brew install node`; otherwise it offers
#    fnm (user-level, no sudo) or explains how to install Node. It never runs sudo.
# 2. npm install -g <release asset>, then `edu setup --yes`.
# 3. Next steps, in Spanish or English (EDU_LANG, else LC_ALL / LC_MESSAGES / LANG).
#
# Environment:
#   EDU_ASSET        package to install (default: the latest GitHub release asset)
#   EDU_LANG         es | en
#   EDU_DRY_RUN=1    print what would run instead of running it (used by scripts/smoke-install.sh)
#   EDU_YES=1        accept the fnm offer without asking (no terminal needed)
set -eu

ASSET="${EDU_ASSET:-https://github.com/EduardoMoraga/edu/releases/latest/download/edu-agent.tgz}"
NODE_MAJOR=22
DRY_RUN="${EDU_DRY_RUN:-0}"

case "${EDU_LANG:-${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}}" in
  es*|ES*) L=es ;;
  *) L=en ;;
esac

say() { printf '  %s\n' "$1"; }
# msg <english> <spanish>
msg() { if [ "$L" = es ]; then say "$2"; else say "$1"; fi; }

run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '  [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

node_ok() { [ "$(node_major)" -ge "$NODE_MAJOR" ]; }

ask_yes() {
  [ "${EDU_YES:-0}" = 1 ] && return 0
  # A terminal must be openable (curl | sh keeps stdin busy; CI and Docker have no tty).
  (: </dev/tty) 2>/dev/null || return 1
  printf '  %s [y/N] ' "$1"
  read -r answer </dev/tty || return 1
  case "$answer" in y|Y|yes|s|S|si|sí) return 0 ;; *) return 1 ;; esac
}

node_help() {
  msg "Node.js $NODE_MAJOR or newer is required. Install it one of these ways, then run this installer again:" \
      "Se necesita Node.js $NODE_MAJOR o superior. Instálalo de una de estas formas y vuelve a ejecutar este instalador:"
  say "  - https://nodejs.org/en/download   (official installer / instalador oficial)"
  say "  - fnm (no sudo): curl -fsSL https://fnm.vercel.app/install | bash && fnm install $NODE_MAJOR"
  if [ "$(uname -s)" = Darwin ]; then say "  - Homebrew: brew install node"; fi
}

install_with_fnm() {
  run sh -c 'curl -fsSL https://fnm.vercel.app/install | bash'
  [ "$DRY_RUN" = 1 ] && return 0
  for dir in "${FNM_DIR:-}" "$HOME/.local/share/fnm" "$HOME/Library/Application Support/fnm" "$HOME/.fnm"; do
    if [ -n "$dir" ] && [ -x "$dir/fnm" ]; then PATH="$dir:$PATH"; export PATH; break; fi
  done
  command -v fnm >/dev/null 2>&1 || return 1
  eval "$(fnm env --shell bash)"
  fnm install "$NODE_MAJOR" && fnm default "$NODE_MAJOR" && fnm use "$NODE_MAJOR"
}

ensure_node() {
  node_ok && return 0
  if [ "$(node_major)" -gt 0 ]; then
    msg "Found Node.js $(node --version); Edu needs $NODE_MAJOR or newer." "Encontré Node.js $(node --version); Edu necesita $NODE_MAJOR o superior."
  fi
  if [ "$(uname -s)" = Darwin ] && command -v brew >/dev/null 2>&1; then
    msg 'Installing Node.js with Homebrew (brew install node)...' 'Instalando Node.js con Homebrew (brew install node)...'
    if [ "$(node_major)" -gt 0 ]; then run brew upgrade node || run brew install node; else run brew install node; fi
    hash -r 2>/dev/null || true
  elif ask_yes "$( [ "$L" = es ] && echo "¿Instalar Node.js $NODE_MAJOR con fnm en tu usuario (sin sudo)?" || echo "Install Node.js $NODE_MAJOR with fnm for your user (no sudo)?" )"; then
    install_with_fnm || { node_help; exit 1; }
  else
    node_help
    exit 1
  fi
  if [ "$DRY_RUN" != 1 ] && ! node_ok; then
    msg 'Node.js was installed but is not on PATH yet. Open a new terminal and run this installer again.' \
        'Node.js quedó instalado pero aún no está en el PATH. Abre una terminal nueva y vuelve a ejecutar este instalador.'
    exit 1
  fi
}

echo
say 'EDU - a second brain that learns, a crew you can see'
echo

ensure_node

msg 'Installing Edu...' 'Instalando Edu...'
run npm install -g "$ASSET" --no-fund --no-audit

EDU=edu
if [ "$DRY_RUN" != 1 ] && ! command -v edu >/dev/null 2>&1; then
  EDU="$(npm prefix -g)/bin/edu"
  msg "Installed, but 'edu' is not on PATH. Add $(npm prefix -g)/bin to PATH (using $EDU for now)." \
      "Instalado, pero 'edu' no está en el PATH. Agrega $(npm prefix -g)/bin al PATH (por ahora uso $EDU)."
fi
if [ "$DRY_RUN" != 1 ]; then msg "Edu $("$EDU" --version) installed." "Edu $("$EDU" --version) instalado."; fi
echo
run "$EDU" setup --yes || msg 'Setup did not finish; run: edu setup --yes' 'El setup no terminó; ejecuta: edu setup --yes'
echo
if [ "$L" = es ]; then
  say 'Listo. Siguientes pasos:'
  say '  1. Crea tu primer espacio desde un documento:'
  say '       edu create <documento> --name <NombreDelAgente>'
  say '  2. Ábrelo en Obsidian: Open folder as vault -> la carpeta creada'
  say '  3. Entra con tu CLI (claude, codex, pi, opencode) y pregunta: "¿quién eres?"'
  say '  4. Mantente al día: edu update'
else
  say 'Done. Next steps:'
  say '  1. Create your first workspace from a document:'
  say '       edu create <document> --name <AgentName>'
  say '  2. Open it in Obsidian: Open folder as vault -> the new folder'
  say '  3. Open it with your CLI (claude, codex, pi, opencode) and ask: "who are you?"'
  say '  4. Stay current: edu update'
fi
