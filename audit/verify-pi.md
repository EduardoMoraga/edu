# T-0015 — E9b Independent black-box verification

Date: 2026-10-08
Role: dev / Pi
Scope: black-box verification from README and `edu --help`; no implementation source inspected first.

Safety note: verification commands were intended to run with temp `HOME` and `EDU_HOME`. One command (`edu init` from the repository root) still created an untracked `.edu/` directory in the repository. It is documented below as a verification incident and was not cleaned up because deletion was outside the task's allowed write scope.

## Summary

| Check | Result | Evidence |
|---|---:|---|
| Repo install/check | PASS | `npm ci && npm run check` completed; 41 test files / 328 tests passed; build succeeded. |
| Smoke install | PASS | `Smoke install passed for edu-agent@0.1.0`. |
| Packed tarball install + core CLI | PASS | Packed `edu-agent-0.1.0.tgz`, installed to temp prefix, `edu --version` returned `0.1.0`; help/doctor/init/brain/context commands exited 0. |
| Temp git install/uninstall | PASS | Dry-run reported 17 file actions; real install reported 14 actions; `edu uninstall` restored pre-existing `CLAUDE.md` and `AGENTS.md` byte-identical (`cmp` exit 0 for both). |
| Albert import fixture | FAIL | Imported 5 notes, but status mapping appears wrong: `H-y estado: confirmada` became `status: open`; canonical `estado: aceptada` became `status: proposed`. |
| Demo + replay | PARTIAL | Local `timeout` command unavailable. Node timeout fallback showed `edu demo` exits 0. No run file was produced, so `edu ui --replay` was not verified. |
| MCP stdio | PASS | `initialize`, `tools/list`, and `tools/call edu_brief` returned valid JSON-RPC responses. |
| Statusline timing | PASS | Exit 0, `74.93 ms`, below 150 ms target. |

Overall: **6 PASS / 8 checks**, **1 FAIL**, **1 PARTIAL**, plus **1 verification-safety incident**.

## Commands and trimmed outputs

### 0. MORAGENT context

```sh
mora context dev --query "T-0015 black-box verification edu v0.1"
```

Observed: context loaded successfully for dev role.

### 1. Repository checks

```sh
npm ci && npm run check
```

Trimmed output:

```text
Tests  328 passed (328)
Test Files  41 passed (41)
DTS dist/index.d.ts 12.01 KB
```

Result: PASS.

```sh
bash scripts/smoke-install.sh
```

Trimmed output:

```text
Smoke install passed for edu-agent@0.1.0
```

Result: PASS.

### 2. Packed tarball install + core CLI

Setup commands used a temp root similar to:

```sh
TMP=$(mktemp -d)
mkdir -p "$TMP/home" "$TMP/prefix"
npm pack --pack-destination "$TMP"
HOME=$TMP/home npm install -g --prefix "$TMP/prefix" "$TMP/edu-agent-0.1.0.tgz"
```

Core CLI commands:

```sh
HOME=$TMP/home EDU_HOME=$TMP/home/.edu $TMP/prefix/bin/edu --version
HOME=$TMP/home EDU_HOME=$TMP/home/.edu $TMP/prefix/bin/edu --help
HOME=$TMP/home EDU_HOME=$TMP/home/.edu $TMP/prefix/bin/edu doctor
HOME=$TMP/home EDU_HOME=$TMP/home/.edu $TMP/prefix/bin/edu init
HOME=$TMP/home EDU_HOME=$TMP/home/.edu $TMP/prefix/bin/edu brain status
HOME=$TMP/home EDU_HOME=$TMP/home/.edu $TMP/prefix/bin/edu brain remember "Prefer small PRs" --kind lesson
HOME=$TMP/home EDU_HOME=$TMP/home/.edu $TMP/prefix/bin/edu brain recall "small prs"
HOME=$TMP/home EDU_HOME=$TMP/home/.edu $TMP/prefix/bin/edu context --budget 800
```

Trimmed outputs:

```text
edu --version: 0.1.0
edu --help: command help rendered successfully
edu doctor: exited 0
edu init: exited 0
edu brain status: exited 0
edu brain remember: exited 0
edu brain recall: returned the remembered lesson
edu context --budget 800: emitted a bounded context pack
```

Result: PASS.

### 3. Temp git project install/uninstall

Commands:

```sh
TMP=$(mktemp -d)
mkdir -p "$TMP/home" "$TMP/project"
cd "$TMP/project"
git init
printf 'user claude content\n' > CLAUDE.md
printf 'user agents content\n' > AGENTS.md
cp CLAUDE.md "$TMP/CLAUDE.before"
cp AGENTS.md "$TMP/AGENTS.before"
HOME=$TMP/home EDU_HOME=$TMP/home/.edu $TMP/prefix/bin/edu init
HOME=$TMP/home EDU_HOME=$TMP/home/.edu $TMP/prefix/bin/edu install --cli claude,codex,pi,opencode,agy --dry-run
HOME=$TMP/home EDU_HOME=$TMP/home/.edu $TMP/prefix/bin/edu install --cli claude,codex --yes
HOME=$TMP/home EDU_HOME=$TMP/home/.edu $TMP/prefix/bin/edu uninstall
cmp CLAUDE.md "$TMP/CLAUDE.before"
cmp AGENTS.md "$TMP/AGENTS.before"
```

Trimmed outputs:

```text
Edu project installation: 17 file actions
Installed 14 action(s)
Edu integration removed (project).
CLAUDE_cmp:0
AGENTS_cmp:0
```

Result: PASS.

### 4. Albert import fixture

Fixture shape created under a temp directory:

```text
_ALBERT/1-CANONICO/negocio/x.md
_ALBERT/2-EPISODICO/2026-09-06_1933_s.md
_ALBERT/3-TRANSITIVO/D-x.md
_ALBERT/3-TRANSITIVO/H-y.md  # contains estado: confirmada
_ALBERT/3-TRANSITIVO/A-z.md
```

Command:

```sh
HOME=$TMP/home EDU_HOME=$TMP/home/.edu $TMP/prefix/bin/edu brain import albert "$TMP/albert-fixture"
```

Trimmed output:

```text
Imported 5 notes
```

Observed imported frontmatter included:

```text
id: H-y
kind: hypothesis
status: open

id: x
kind: decision
status: proposed
```

Result: FAIL.

### 5. Demo and replay

Requested command:

```sh
printf '\n' | timeout 8s env HOME=$TMP/home EDU_HOME=$TMP/home/.edu $TMP/prefix/bin/edu demo
```

Actual output:

```text
timeout: command not found
```

Fallback command used Node to enforce a timeout:

```sh
node "$TMP/run-demo-timeout.mjs"
```

Observed: `edu demo` exited 0 and printed successful non-interactive demo output.

No run file was produced by the demo run, so this command could not be exercised:

```sh
HOME=$TMP/home EDU_HOME=$TMP/home/.edu $TMP/prefix/bin/edu ui --replay <run-file>
```

Result: PARTIAL.

### 6. MCP stdio

A temp Node JSON-RPC client sent:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"verify-pi","version":"0.0.0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"edu_brief","arguments":{"budget":800}}}
```

Command:

```sh
HOME=$TMP/home EDU_HOME=$TMP/home/.edu node "$TMP/mcp-client.mjs"
```

Trimmed output:

```text
initialize: server name edu, version 0.1.0
tools/list: includes edu_brief
tools/call edu_brief: returned identity/core text
```

Result: PASS.

### 7. Statusline timing

Command:

```sh
printf '{"cwd":"%s"}\n' "$TMP/project" | HOME=$TMP/home EDU_HOME=$TMP/home/.edu node "$TMP/statusline-time.mjs"
```

Trimmed output:

```json
{"status":0,"ms":74.930417,"stdout":"◆ EDU · brain 0 · 0 lessons"}
```

Result: PASS.

## Defects

### D1 — Albert import status mapping appears incorrect

Repro:

```sh
HOME=$TMP/home EDU_HOME=$TMP/home/.edu edu brain import albert "$TMP/albert-fixture"
```

Fixture includes:

```text
_ALBERT/3-TRANSITIVO/H-y.md with estado: confirmada
_ALBERT/1-CANONICO/negocio/x.md with estado: aceptada
```

Expected:

- `H-y.md` imports as a hypothesis with confirmed/confirmada equivalent status.
- Accepted canonical note imports as accepted/accepted-equivalent status.

Actual:

```text
H-y -> kind: hypothesis, status: open
x -> kind: decision, status: proposed
```

Impact: migrated Albert memory loses important lifecycle/status meaning.

### D2 — `edu demo` replay path was not verifiable non-interactively

Repro:

```sh
printf '\n' | timeout 8s env HOME=$TMP/home EDU_HOME=$TMP/home/.edu edu demo
```

Expected:

- `edu demo` completes non-interactively.
- If it produces a run file, `edu ui --replay <run-file>` replays it successfully.

Actual:

- On this host, `timeout` is unavailable: `timeout: command not found`.
- Node timeout fallback showed `edu demo` exits 0.
- No run file was produced, so `edu ui --replay` could not be verified.

Impact: demo itself appears usable, but replay acceptance remains unverified.

### D3 — Verification safety incident: repo `.edu/` created unexpectedly

Repro/actual observed:

```sh
HOME=$TMP/home EDU_HOME=$TMP/home/.edu edu init
```

When run from the repository root, this created an untracked repository directory:

```text
?? .edu/
.edu/EDU.md
.edu/agents/builder.md
.edu/agents/explorer.md
.edu/agents/lead.md
.edu/agents/reviewer.md
.edu/brain/3-transitive/L-prefer-small-prs.md
.edu/config.json
.edu/skills/edu-brain/SKILL.md
.edu/skills/edu-reflect/SKILL.md
```

Expected:

- Verification should not modify repository files outside `audit/verify-pi.md`.
- With temp `HOME` and `EDU_HOME`, user-home state should stay isolated.

Actual:

- Project-local `.edu/` was created because `edu init` initializes the current project by design.
- The verifier did not remove it, because deletion would be another out-of-scope repository mutation.

Impact: task safety constraint was violated during verification. The directory remains untracked and should be removed or inspected by the lead.
