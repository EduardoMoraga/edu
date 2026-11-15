# Edu Deck for Claude Code

The Edu Deck is a side pane in Claude Code. It shows the session's agents as a live tree, with a
control for each one, and it shows Edu's own state: the brain, the crew jobs and this session's Edu
note. It comes with the `edu` plugin (`edu setup`, or `/plugin install edu@edu`).

The tree, the tabs and the agent controls are ported from
[Agent Tree](https://github.com/MikeGT4/agent-tree) by Mike Pollow (MIT); see
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Open it

- It opens when an interactive session starts. Claude Code docks a pane it was not asked for only
  when the terminal is wide enough (about 110 to 144 columns). Otherwise, type `/edu-deck`.
- `/edu-deck edu` opens it on the Edu tab. `/edu-deck stop` closes it.
- Options, in `/config` under the edu plugin: width (default 90 columns), agents kept (30), open on
  start (on), motion (on).

## Tree tab

- **Main session**: its model, effort, context and cost. Press `e` to set the effort.
- **One box per sub-agent**: its task, its current step and how full its context is (yellow from
  70%, red from 85%). `⚠` means two running agents are changing the same file.
- **Advisor** (on wide panes): on or off, and its calls.
- **The Edu line** under the tabs: brain size, notes to approve, overdue commitments, active crew
  jobs, crew runs waiting for approval and whether this session's Edu note is open. Press it to open
  the Edu tab.

Click a box, or press `ctrl+x tab`, then Tab and Enter:

| Control | What it does |
|---|---|
| Stop (`s`) | Denies the agent's next tools and ends it at its next step. Other agents keep running. |
| Write | Fills your prompt with `/edu-deck to <id> `; your text reaches the agent at its next step, and the main session is told. |
| Model, Effort | Switches the model or effort for that agent's next steps. |
| Details | Task, tools, files read and changed, latest answer, and a link to the full report. |

`m` sets the model and effort for new sub-agents (kept for later sessions). `a` changes the look.

## Other tabs

- **Edu**: identity and project, the brain by tier, when it was last maintained, this session's Edu
  note, the latest spec, the eight newest crew jobs (active first) and the newest notes. A crew run
  waiting for approval gets **Approve** and **Reject**; each asks once more before it runs
  `edu crew approve <id>` or `edu crew reject <id>`. `r` refreshes.
- **Reports**: each agent's task and full answer.
- **Files**: changed and read files per agent, shared ones first.
- **Log**: every event, filtered by source.
- **Usage**: limits, context, tools and time per agent.
- **Help**: keys, glyphs and commands.

## Where the Edu data comes from

The pane runs `edu deck --json --session <this session's id>`: once at start, after each finished
main turn, after each Edu tool call, every 10 seconds while a crew job is active or the Edu tab is
open, and every 60 seconds otherwise. It never runs two reads at once. It reads the brain every other
`edu` command uses: the nearest project `.edu/` above the session's folder, else the global one
(`EDU_HOME`, or `~/.edu`). The Edu tab says which (project brain or global brain).

- `edu` not on `PATH`: the pane says so and the agent tree keeps working.
- An older `edu` without `deck --session`: the pane reads again without it and shows the session as
  not reported until you run `edu update`.

## Commands

| Command | Effect |
|---|---|
| `/edu-deck` | Open the pane |
| `/edu-deck edu` | Open it on the Edu tab |
| `/edu-deck refresh` | Read Edu again now |
| `/edu-deck to <id> <text>` | Write to a sub-agent |
| `/edu-deck clear` | Clear finished agents |
| `/edu-deck style <name>`, `colors <name>`, `glow <name>`, `look reset` | Change the look |
| `/edu-deck stop` | Close the pane |

## Notes

- Agent Tree and the Edu Deck both steer sub-agents. Installed together, both act on a stop or a
  model choice, so keep only one of them on.
- For developers: `npm run test:deck` runs the pane's engine tests with `claude plugin test` on a
  temporary copy of `plugins/claude-code`. It needs the `claude` CLI.
