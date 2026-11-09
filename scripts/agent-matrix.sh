#!/usr/bin/env bash
# Live activation test across agent CLIs (manual only: it runs real, possibly paid, models).
#
# For every CLI in $AGENT_MATRIX_CLIS found on PATH: seed a fresh project brain with the activation scenario
# (`edu bench activation --seed`), point EDU_HOME at an empty temporary global brain, ask the activation prompt
# headless, save the answer and grade it 0-5 (`edu bench activation --grade`).
#
# Prerequisites: `npm run build` in this checkout, and Edu installed for each CLI (`edu install`), so the host
# loads the Edu MCP server / hooks. HOME stays your real home so those installs are used; only EDU_HOME changes.
#
# CLIs without an Edu integration (copilot, omp) reach Edu through its MCP server only: Copilot via a
# session-only MCP config, omp via a project `.mcp.json` written into the seeded project.
#
# Pi without its own login can use a GitHub Copilot subscription:
#   COPILOT_GITHUB_TOKEN="$(gh auth token)" AGENT_MATRIX_PI_FLAGS="-p --no-session --model github-copilot/claude-sonnet-5.5"
# (omp reads COPILOT_GITHUB_TOKEN the same way; see AGENT_MATRIX_OMP_FLAGS.)
#
# Usage:   scripts/agent-matrix.sh [out-dir]
# Env:     AGENT_MATRIX_CLIS="claude codex pi opencode agy copilot omp"   CLIs to try (default: all)
#          AGENT_MATRIX_TIMEOUT=600                           seconds per CLI
#          AGENT_MATRIX_<CLI>_FLAGS="..."                     replace the default flags, e.g. AGENT_MATRIX_CODEX_FLAGS
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
EDU=(node "$ROOT/dist/cli.js")
OUT=${1:-$(mktemp -d)/agent-matrix}
TIMEOUT=${AGENT_MATRIX_TIMEOUT:-600}
CLIS=${AGENT_MATRIX_CLIS:-"claude codex pi opencode agy copilot omp"}

if [[ ! -f "$ROOT/dist/cli.js" ]]; then
  echo "dist/cli.js not found: run npm run build first" >&2
  exit 1
fi
mkdir -p "$OUT"
SUMMARY="$OUT/summary.tsv"
printf 'cli\texit\tscore\tanswer\n' >"$SUMMARY"

# Non-interactive invocation per CLI. The prompt is appended as the last argument.
default_flags() {
  case "$1" in
    # Read-only Edu tools plus file reads; the server is registered as "edu" (plugin installs as plugin_edu_edu).
    # --allowedTools is variadic, so the prompt goes on stdin (see PROMPT_ON_STDIN).
    claude) echo "-p --output-format text --allowedTools mcp__edu,mcp__plugin_edu_edu,Read,Grep,Glob" ;;
    # Read-only sandbox; the temp project is not a git repository.
    codex) echo "exec --skip-git-repo-check --sandbox read-only --color never" ;;
    pi) echo "-p --no-session" ;;
    # --auto approves tool permissions that are not explicitly denied (the project is a throwaway temp dir).
    opencode) echo "run --auto" ;;
    # -p takes the prompt as its value, so it must be the last flag. Headless agy cannot approve call_mcp_tool
    # (settings allow-rules do not cover it), so permissions are skipped: the project is a throwaway temp dir.
    agy) echo "--dangerously-skip-permissions --print-timeout ${TIMEOUT}s -p" ;;
    # Copilot has no Edu integration: Edu's MCP server is passed for this session only.
    copilot) echo "--allow-all-tools --no-color --additional-mcp-config @$COPILOT_MCP -p" ;;
    # omp (oh-my-pi) has no Edu integration: it loads the project .mcp.json written below.
    omp) echo "-p" ;;
  esac
}

# CLIs that read the prompt from stdin instead of the last argument.
PROMPT_ON_STDIN=" claude "

COPILOT_MCP=$(mktemp)
printf '{"mcpServers":{"edu":{"type":"local","command":"node","args":["%s","mcp"],"tools":["*"]}}}' "$ROOT/dist/cli.js" >"$COPILOT_MCP"

for cli in $CLIS; do
  if ! command -v "$cli" >/dev/null 2>&1; then
    echo "skip $cli: not on PATH"
    continue
  fi
  work=$(mktemp -d)
  project="$work/project"
  mkdir -p "$project" "$work/edu-home"
  prompt=$(EDU_HOME="$work/edu-home" "${EDU[@]}" bench activation --seed "$project")
  if [[ "$cli" == omp ]]; then
    printf '{"mcpServers":{"edu":{"command":"node","args":["%s","mcp"]}}}' "$ROOT/dist/cli.js" >"$project/.mcp.json"
  fi
  var="AGENT_MATRIX_$(echo "$cli" | tr '[:lower:]' '[:upper:]')_FLAGS"
  read -r -a flags <<<"${!var:-$(default_flags "$cli")}"
  answer="$OUT/$cli.answer.txt"
  echo "run  $cli in $project"
  (
    cd "$project" || exit 1
    if [[ "$PROMPT_ON_STDIN" == *" $cli "* ]]; then
      printf '%s' "$prompt" | EDU_HOME="$work/edu-home" timeout "$TIMEOUT" "$cli" "${flags[@]}" >"$answer" 2>"$OUT/$cli.stderr.txt"
    else
      EDU_HOME="$work/edu-home" timeout "$TIMEOUT" "$cli" "${flags[@]}" "$prompt" </dev/null >"$answer" 2>"$OUT/$cli.stderr.txt"
    fi
  )
  code=$?
  "${EDU[@]}" bench activation --grade "$answer" --json >"$OUT/$cli.grade.json"
  score=$(node -p "require(process.argv[1]).score" "$OUT/$cli.grade.json")
  printf '%s\t%s\t%s/5\t%s\n' "$cli" "$code" "$score" "$answer" >>"$SUMMARY"
  echo "     $cli exit $code score $score/5"
  rm -rf "$work"
done

echo
column -t -s $'\t' "$SUMMARY" 2>/dev/null || cat "$SUMMARY"
echo "results: $OUT"
