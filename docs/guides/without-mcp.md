# Edu without MCP

Some hosts never start the Edu MCP server. Grok Bot cloud sessions and Cursor cloud
agents in the `cheil-vault-edu` environment are two of them. The agent still uses the
`edu` CLI, against one profile.

Copy **one** door into that environment as `AGENTS.md`. Do not copy both. Do not add an
`AGENTS.md` at the root of this repository.

| Host | Copy this file | Profile |
|---|---|---|
| Personal, including Grok Bot | [`templates/doors/personal/AGENTS.md`](../../templates/doors/personal/AGENTS.md) | `personal` |
| `cheil-vault-edu` | [`templates/doors/cheil/AGENTS.md`](../../templates/doors/cheil/AGENTS.md) | `cheil` |

`npm run build:plugins` writes the same bytes to
[`plugins/doors/personal/AGENTS.md`](../../plugins/doors/personal/AGENTS.md) and
[`plugins/doors/cheil/AGENTS.md`](../../plugins/doors/cheil/AGENTS.md). Copy either tree.
The source templates are the ones to edit.

## What each door pins

Both doors tell the agent to run `edu brief`, `edu recall` as `edu brain recall`,
`edu brain read`, `edu brain remember`, `edu join --cloud` with that door's
`--profile`, and `edu sync --cloud`. Both keep the `EDU_HOME` the environment
already set.

The personal door joins `EduardoMoraga/edu-vault` (`--profile personal`, subdir
`01-CONOCIMIENTO`). It does not name the cheil vault.

The cheil door joins `EduardoMCheil/cheil-vault` (`--profile cheil`, subdir
`_CONOCIMIENTO`). It tells the agent not to read or write the personal vault, and it
does not tell the agent to join the personal vault.

On the Windows workstation, `edu join --profile cheil` with no `--path` uses `C:\Cheil`.
A cloud session keeps the `EDU_HOME` that environment already set. It does not open
the workstation path, and it does not point `EDU_HOME` at the personal home.

## Sandbox

Sync by hand. Do not run `edu join --install` or `edu sync --install` in a sandbox.
`--install` is refused for a cheil profile until each profile has its own Windows task
(`EduSync` is still one name).

```bash
edu brief
edu brain recall <query>
edu brain read <id>
edu sync --cloud
```

Hosts that install the Edu plugin also receive the `edu-cli` skill. It sends the agent
to the CLI and to the `AGENTS.md` already in the environment. It does not name a second vault.

Live use inside `cheil-vault-edu`, or on the FFM, waits until the door is installed there.
The tests in this repository are the check for the change.
