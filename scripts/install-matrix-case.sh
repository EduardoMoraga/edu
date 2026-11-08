#!/bin/sh
# One install-matrix case (POSIX sh: runs in node:*-bookworm-slim, node:*-alpine and on the host).
# Installs Edu from a local package with scripts/install.sh into a fake HOME with stub host CLIs, then
# setup -> doctor -> bench -> hooks -> uninstall (twice), and checks that every host config outside the
# brain is restored byte for byte.
#
#   EDU_MATRIX_PKG   directory with edu-agent.tgz and install.sh (required)
#   EDU_MATRIX_WORK  scratch directory (default: mktemp -d)
set -eu

PKG=${EDU_MATRIX_PKG:?set EDU_MATRIX_PKG to the directory holding edu-agent.tgz and install.sh}
WORK=${EDU_MATRIX_WORK:-$(mktemp -d)}
export HOME="$WORK/home"
export npm_config_cache="$WORK/npm-cache" npm_config_prefix="$WORK/prefix"
export npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false
export STUB_LOG="$WORK/stub.log" EDU_LANG=en NO_COLOR=1
unset EDU_HOME CODEX_HOME 2>/dev/null || true
STUBS="$WORK/stubs"
mkdir -p "$HOME" "$STUBS" "$npm_config_prefix/bin"
: >"$STUB_LOG"

fail() { echo "FAIL: $*" >&2; exit 1; }
step() { echo "== $*"; }
has() { grep -qF -- "$2" "$1" || fail "expected '$2' in $1"; }

# Stub host CLIs: log argv and succeed, so every native plugin command is exercised without a real host.
for cli in claude codex pi opencode agy; do
  printf '#!/bin/sh\necho "%s $*" >>"$STUB_LOG"\nexit 0\n' "$cli" >"$STUBS/$cli"
  chmod +x "$STUBS/$cli"
done
export PATH="$npm_config_prefix/bin:$STUBS:$PATH"

# The user's own configuration in files Edu may touch.
mkdir -p "$HOME/.claude" "$HOME/.codex" "$HOME/.pi/agent" "$HOME/.config/opencode" "$HOME/.gemini" "$HOME/project"
printf '{\n  "theme": "dark"\n}\n' >"$HOME/.claude/settings.json"
printf '{"numStartups":3}' >"$HOME/.claude.json"
printf '# My rules\n\nBe brief.' >"$HOME/.claude/CLAUDE.md"
printf 'model = "gpt-x"\n\n[mcp_servers.other]\ncommand = "other"\n' >"$HOME/.codex/config.toml"
printf 'Codex user rules\n' >"$HOME/.codex/AGENTS.md"
printf '{\n  // my comment\n  "theme": "tokyo",\n}\n' >"$HOME/.config/opencode/opencode.json"
printf 'OpenCode rules\n' >"$HOME/.config/opencode/AGENTS.md"
printf 'Gemini rules\n' >"$HOME/.gemini/GEMINI.md"

# Every path and file hash under HOME except the brain (kept by design).
snapshot() {
  (cd "$HOME" && find . -path ./.edu -prune -o -print | LC_ALL=C sort | while IFS= read -r path; do
    if [ -f "$path" ]; then echo "$(sha256sum "$path" | cut -d ' ' -f 1) $path"; else echo "dir $path"; fi
  done)
}
snapshot >"$WORK/before.txt"

step "install.sh from $PKG/edu-agent.tgz (node $(node --version))"
EDU_ASSET="$PKG/edu-agent.tgz" EDU_YES=1 sh "$PKG/install.sh" </dev/null >"$WORK/install.log" 2>&1 || { cat "$WORK/install.log"; fail "install.sh exited $?"; }
command -v edu >/dev/null || fail "edu is not on PATH after install"
sed -n '/^host /,/^$/p' "$WORK/install.log"
has "$WORK/install.log" 'host      method   MCP  brief'
for line in 'claude plugin install edu@edu' 'codex plugin add edu@edu' 'pi install ' 'agy plugin install '; do has "$STUB_LOG" "$line"; done

step "edu doctor"
edu doctor >"$WORK/doctor.log" 2>&1 || { cat "$WORK/doctor.log"; fail "edu doctor exited $?"; }
has "$WORK/doctor.log" 'opencode: installed'

step "edu bench context --json"
edu bench context --json >"$WORK/bench.json" 2>"$WORK/bench.err" || { cat "$WORK/bench.err"; fail "edu bench context exited $?"; }
node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); if (!r || typeof r !== "object") process.exit(1); console.log("  keys: " + Object.keys(r).slice(0, 6).join(", "))' "$WORK/bench.json" || fail "bench output is not JSON"

step "hooks: Claude/Codex SessionStart and agy SessionStart"
cd "$HOME/project"
printf '{"session_id":"m-1","source":"startup"}' | edu hook session-start --host codex >"$WORK/codex-hook.txt" || fail "codex session-start hook exited $?"
printf '{"conversationId":"conv-1","workspacePaths":["%s"]}' "$HOME/project" | edu hook agy-session-start >"$WORK/agy-hook.json" || fail "agy hook exited $?"
node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log("  agy injectSteps: " + (Array.isArray(r.injectSteps) ? r.injectSteps.length : 0))' "$WORK/agy-hook.json" || fail "agy hook did not print JSON"
cd "$HOME"

step "edu uninstall --yes"
: >"$STUB_LOG"
edu uninstall --yes >"$WORK/uninstall.log" 2>&1 || { cat "$WORK/uninstall.log"; fail "edu uninstall exited $?"; }
cat "$WORK/uninstall.log"
has "$WORK/uninstall.log" 'Edu integration removed (global).'
for line in 'claude plugin uninstall edu@edu' 'codex plugin remove edu@edu' 'pi remove ' 'agy plugin uninstall edu'; do has "$STUB_LOG" "$line"; done
[ -f "$HOME/.edu/EDU.md" ] || fail "uninstall removed the brain"

step "edu uninstall --yes (again: idempotent)"
edu uninstall --yes >"$WORK/uninstall2.log" 2>&1 || { cat "$WORK/uninstall2.log"; fail "second uninstall exited $?"; }
has "$WORK/uninstall2.log" 'Nothing to remove'

step "host configs restored"
snapshot >"$WORK/after.txt"
if ! diff "$WORK/before.txt" "$WORK/after.txt"; then fail "HOME differs from its pre-install state (outside ~/.edu)"; fi
echo "PASS"
