# Explicit experiments in Edu 2.1

`edu experiment` compares two trusted commands in disposable workspace copies. It is off unless explicitly invoked. It starts no models, awards no learning credit, installs no skills and adopts no changes.

These copies are **workspace isolation, not an OS or network sandbox**. Approved executables can access host files, credentials and network, launch arbitrary code, or escape process cleanup. Only run commands you trust. Requests for another isolation mode or unknown isolation requirements fail before execution.

## Prepare and inspect

Keep a UTF-8 JSON manifest outside the source tree, to avoid hashing a document containing its own digest. Use absolute source and executable paths suitable for your machine. For example, replace `/absolute/path/to/node` with your trusted Node executable:

```json
{
  "version": 1,
  "sourceRoot": "/absolute/path/to/source",
  "sourceSha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "baseline": {
    "executable": "/absolute/path/to/node",
    "args": ["build.mjs"]
  },
  "candidate": {
    "executable": "/absolute/path/to/node",
    "args": ["build.mjs"]
  },
  "overlay": { "input.txt": "reviewed candidate input" },
  "protected": ["build.mjs"],
  "artifacts": ["result.txt"],
  "checks": [],
  "criterion": "retain-baseline",
  "isolation": "workspace-copy",
  "limits": {
    "timeoutMs": 30000,
    "outputBytes": 65536,
    "workspaceBytes": 16777216,
    "files": 1024
  }
}
```

Run `edu experiment inspect /path/to/manifest.json`. Inspection is read-only and prints JSON with the exact manifest SHA-256, current source digest, included inventory, commands and limitations. Review the inventory and commands. Put the reported `sourceSha256` into the manifest, inspect again, then use the new `manifestSha256` only when `approvalReady` is true. Changes to manifest bytes, overlay, source contents, directory inventory or executable bits require fresh inspection and approval.

The source snapshot includes safe hidden filenames, spaces/Unicode, empty directories and regular files. POSIX executable bits are preserved and hashed; ownership, timestamps, extended attributes and other permission bits are not reproduced. Symlinks, special files, case/Unicode collisions, Windows reserved names and traversal are rejected. File limits count directories too. Initial baseline/candidate snapshots are independent copies, never hardlinks.

Named exclusions include `.git`, `.edu`, `node_modules`, `.cloudroom`, host config stores such as `.codex`/`.claude`/`.pi`, and known credential locations/files. Safe shipped `.claude-plugin` and `.agents/plugins` sources are included and protected. **Exclusions do not detect every secret**: review the reported inventory before approval. Dependencies are not installed or copied from `node_modules`; commands must work with the declared source and trusted existing executables. External executable versions and host tools are not pinned by the source digest.

## Execute and retain evidence

```sh
edu experiment run /path/to/manifest.json \
  --approve <exact-manifest-sha256> \
  --evidence /user/chosen/retained-experiments
```

An explicit writable evidence directory outside the original source is required, including when source or evidence paths use aliases. Choose retained storage rather than a temporary directory. Evidence storage is established before either command starts. JSON output names the evidence file; Ctrl-C/SIGTERM requests cancellation and still records completed/failed arms. A cancelled baseline prevents candidate startup. Failed arms make the CLI exit nonzero, even when a valid baseline remains available.

Commands run sequentially with no shell and a minimal environment containing PATH/platform temporary/system locations; user HOME and API-key variables are not forwarded. This is resource hygiene, not a security restriction. Absolute arguments and executable code can still access the host. Timeout applies per arm, with a bounded 200 ms stream drain; stdout and stderr share one byte budget. Workspace sizes/counts are monitored during execution and validated afterward. Monitoring is not an OS disk quota and can miss transient excess. Cleanup targets only owned process groups/PIDs, is best effort, and cannot guarantee Windows descendants die after their parent exits. Results settle without waiting indefinitely for inherited pipes.

Candidate overlays contain only explicit UTF-8 files. They may change application code/configuration or proposed skill/resource content. They cannot overwrite frozen checks, evaluator/dependency files, agent policies (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`), MCP/plugin metadata or known host/brain configuration. Ordinary logs and application state are not treated as permissions configuration. Proposed skills are experimental file material, not automatically validated or installed skill bundles.

`protected` adds files/directories to the frozen inventory. Protected entries are compared before and after each command, including modes and newly introduced protected paths. Changing, deleting or introducing protected policy/evaluator/dependency files invalidates the arm. These checks detect recorded filesystem changes; they cannot prevent temporary tampering that trusted commands restore before validation.

Required artifacts must be newly produced regular files, absent from source and overlay. Each optional check is `{ "id": "expected-output", "path": "result.txt", "sha256": "<expected exact file digest>" }`. Checks are fixed comparisons performed by Edu outside the command's copy, not command-supplied self-grades. Evidence records exact commands, input/mode/overlay/check/artifact digests, outcomes, elapsed times and isolation limitations. Tokens/cache/USD remain unknown (`null`). Evidence is local JSON, not automatically admitted as verified brain evidence. Interrupted runs can leave an explicit `running` record; final records use `complete` and are replaced through a staging file. Persistence errors are reported; this is not crash-proof storage.

## Interpret the decision

The default `retain-baseline` never selects the candidate. The optional `artifact-match-gain` selects it only when both arms execute validly, the baseline misses at least one declared output digest, and the candidate matches every declared check. Ties retain baseline. An invalid baseline makes the comparison inconclusive and `fallbackUsable` false. A baseline that executes validly but misses a quality check is distinct from process failure; its check mismatches remain visible.

A digest match proves only agreement with the declared expected bytes. Trusted commands can hard-code those bytes; the runner does not establish evaluator independence, causal benefit or general quality improvement. Duration is observational and never a selection criterion. A `candidate` decision changes no files in the original source, brain or installed skills: any adoption requires a separate explicit human action.
