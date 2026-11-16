#!/bin/sh
# Edu installer for macOS and Linux (POSIX sh).
#   curl -fsSL https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.sh | sh
#
# 1. Node.js >= 22: kept if present; on macOS with Homebrew, `brew install node`; otherwise it offers
#    fnm (user-level, no sudo) or explains how to install Node. It never runs sudo.
# 2. Downloads the release package and its SHA256SUMS from the release download URL on GitHub, checks the
#    checksum, then npm install -g <the verified local file> and `edu setup --yes`.
# 3. Next steps, in Spanish or English (EDU_LANG, else LC_ALL / LC_MESSAGES / LANG).
#
# Environment (or the matching flags, e.g. `curl ... | sh -s -- --yes --hosts claude,codex --join <url>`):
#   EDU_ASSET        package to install: a release asset URL under
#                    https://github.com/EduardoMoraga/edu/releases/download/<tag>/ (verified against that
#                    release's SHA256SUMS), or a local .tgz you built yourself (installed as given).
#                    Default: edu-agent.tgz of the latest release, verified.
#   EDU_ALLOW_UNVERIFIED=1  --allow-unverified: also install a release older than 6.0, which has no
#                    SHA256SUMS (not recommended). A 6.0+ release without SHA256SUMS is always refused.
#   EDU_LANG         es | en
#   EDU_DRY_RUN=1    print what would run instead of running it (used by scripts/smoke-install.sh)
#   EDU_YES=1        --yes: never ask (accepts the fnm offer); any failed step makes the exit status 1
#   EDU_HOSTS=a,b    --hosts: only set up these CLIs (claude, codex, pi, opencode, agy); default: detected
#   EDU_JOIN=<url>   --join: after setup, run `edu join <url> --cloud` (shared brain for cloud sandboxes).
#                    Credentials come from GH_TOKEN or a credential helper; never put them in the URL.
set -eu

while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) EDU_YES=1 ;;
    --hosts) shift; EDU_HOSTS="${1:-}" ;;
    --hosts=*) EDU_HOSTS="${1#--hosts=}" ;;
    --join) shift; EDU_JOIN="${1:-}" ;;
    --join=*) EDU_JOIN="${1#--join=}" ;;
    --dry-run) EDU_DRY_RUN=1 ;;
    --allow-unverified) EDU_ALLOW_UNVERIFIED=1 ;;
    *) printf '  Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  [ $# -gt 0 ] && shift
done

ASSET="${EDU_ASSET:-}"
RELEASES=https://github.com/EduardoMoraga/edu/releases
NODE_MAJOR=22
DRY_RUN="${EDU_DRY_RUN:-0}"

case "${EDU_LANG:-${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}}" in
  es*|ES*) L=es ;;
  *) L=en ;;
esac

say() { printf '  %s\n' "$1"; }
# msg <english> <spanish>
msg() { if [ "$L" = es ]; then say "$2"; else say "$1"; fi; }

# Credentials in a URL (https://user:token@host/...) are never printed.
redact() { printf '%s' "$1" | sed 's#//[^/@]*@#//***@#g'; }

run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '  [dry-run] %s\n' "$(redact "$*")"
  else
    "$@"
  fi
}

FAILED=0

# Downloads a release package and its SHA256SUMS only from $RELEASES/download/<tag>/, checks the checksum
# and prints the path of the verified local file (exit 3 and a message otherwise). Node >= 22 is already
# there, so this needs no curl, sha256sum or shasum. EDU_DL_DIR, EDU_DL_ASSET, EDU_ALLOW_UNVERIFIED.
VERIFY_JS='
const { createHash } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const PREFIX = "https://github.com/EduardoMoraga/edu/releases/download/";
const fail = (message) => { console.error("  " + message); process.exit(3); };
(async () => {
  const asset = process.env.EDU_DL_ASSET || "";
  let tag; let name;
  if (asset) {
    const parts = asset.startsWith(PREFIX) ? asset.slice(PREFIX.length).split("/") : [];
    if (parts.length !== 2) fail(`Refusing ${asset}: Edu installs only release packages from ${PREFIX}<tag>/ (or a local .tgz file).`);
    [tag, name] = parts;
  } else {
    const latest = await fetch("https://github.com/EduardoMoraga/edu/releases/latest", { method: "HEAD", redirect: "follow" });
    const match = /\/releases\/tag\/([^/?#]+)$/.exec(latest.url || "");
    if (!match) fail("Could not find the latest Edu release on GitHub.");
    tag = decodeURIComponent(match[1]); name = "edu-agent.tgz";
  }
  if (!/^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag) || !/^edu-agent[\w.-]*\.tgz$/.test(name)) fail(`Refusing ${asset || tag}: not an Edu release package.`);
  const get = async (file) => {
    const response = await fetch(PREFIX + tag + "/" + file, { redirect: "follow" });
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} for ${PREFIX}${tag}/${file}`), { status: response.status });
    return Buffer.from(await response.arrayBuffer());
  };
  const data = await get(name);
  const actual = createHash("sha256").update(data).digest("hex");
  let sums;
  try { sums = (await get("SHA256SUMS")).toString("utf8"); } catch (error) { if (error.status !== 404) throw error; }
  if (sums === undefined) {
    if (Number(tag.replace(/^v/, "").split(".")[0]) >= 6) fail(`Release ${tag} publishes no SHA256SUMS, so its package cannot be verified. Nothing was installed.`);
    if (process.env.EDU_ALLOW_UNVERIFIED !== "1") fail(`Release ${tag} predates verified releases (no SHA256SUMS). Run again with --allow-unverified to install it anyway (not recommended).`);
    console.error(`  WARNING: installing ${tag} WITHOUT a checksum check (--allow-unverified).`);
  } else {
    const line = sums.split(/\r?\n/).map((text) => /^([0-9a-fA-F]{64}) [ *](\S.*)$/.exec(text.trimEnd())).find((found) => found && found[2] === name);
    if (!line) fail(`SHA256SUMS of ${tag} lists no ${name}. Nothing was installed.`);
    if (line[1].toLowerCase() !== actual) fail(`Checksum mismatch for ${name}: SHA256SUMS says ${line[1].toLowerCase()}, the download is ${actual}. Nothing was installed.`);
  }
  const file = join(process.env.EDU_DL_DIR, name);
  writeFileSync(file, data);
  process.stdout.write(file);
})().catch((error) => fail(`Could not download Edu: ${error.message}`));
'

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
if [ -n "$ASSET" ] && [ -f "$ASSET" ]; then
  # A local package you built or downloaded yourself: installed as given.
  msg "Using the local package $ASSET (not checksum-verified)." "Usando el paquete local $ASSET (sin verificar checksum)."
  run npm install -g "$ASSET" --no-fund --no-audit
elif [ "$DRY_RUN" = 1 ]; then
  printf '  [dry-run] download %s and SHA256SUMS from %s/download/<tag>/ and verify the checksum\n' "$(redact "${ASSET:-edu-agent.tgz}")" "$RELEASES"
  run npm install -g '<verified edu-agent.tgz>' --no-fund --no-audit
else
  DL_DIR="$(mktemp -d)"
  trap 'rm -rf "$DL_DIR"' EXIT
  PACKAGE="$(EDU_DL_DIR="$DL_DIR" EDU_DL_ASSET="$ASSET" EDU_ALLOW_UNVERIFIED="${EDU_ALLOW_UNVERIFIED:-0}" node -e "$VERIFY_JS")" || {
    msg 'Edu was not installed: the release package could not be downloaded and verified (see above).' \
        'Edu no se instaló: no se pudo descargar y verificar el paquete de la versión (ver arriba).'
    exit 1
  }
  run npm install -g "$PACKAGE" --no-fund --no-audit
fi

EDU=edu
if [ "$DRY_RUN" != 1 ] && ! command -v edu >/dev/null 2>&1; then
  EDU="$(npm prefix -g)/bin/edu"
  msg "Installed, but 'edu' is not on PATH. Add $(npm prefix -g)/bin to PATH (using $EDU for now)." \
      "Instalado, pero 'edu' no está en el PATH. Agrega $(npm prefix -g)/bin al PATH (por ahora uso $EDU)."
fi
if [ "$DRY_RUN" != 1 ]; then msg "Edu $("$EDU" --version) installed." "Edu $("$EDU" --version) instalado."; fi
echo
if [ -n "${EDU_HOSTS:-}" ]; then
  run "$EDU" setup --yes --cli "$EDU_HOSTS" || { FAILED=1; msg "Setup did not finish; run: edu setup --yes --cli $EDU_HOSTS" "El setup no terminó; ejecuta: edu setup --yes --cli $EDU_HOSTS"; }
else
  run "$EDU" setup --yes || { FAILED=1; msg 'Setup did not finish; run: edu setup --yes' 'El setup no terminó; ejecuta: edu setup --yes'; }
fi
echo
if [ -n "${EDU_JOIN:-}" ]; then
  msg "Joining the shared brain $(redact "$EDU_JOIN")..." "Uniendo el cerebro compartido $(redact "$EDU_JOIN")..."
  run "$EDU" join "$EDU_JOIN" --cloud || { FAILED=1; msg 'Join did not finish; check GH_TOKEN and run: edu join <url> --cloud' 'La unión no terminó; revisa GH_TOKEN y ejecuta: edu join <url> --cloud'; }
  echo
fi
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
# Non-interactive callers (EDU_YES=1, cloud sandboxes, CI) need a failing status, not just a message.
if [ "$FAILED" = 1 ] && [ "${EDU_YES:-0}" = 1 ]; then exit 1; fi
