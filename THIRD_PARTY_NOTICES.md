# Third-party notices

Edu includes code from the projects below. Each keeps its own license; the notice travels with
every copy, including the generated Claude Code plugin (`plugins/claude-code/THIRD_PARTY_NOTICES.md`).

## Agent Tree

- Project: Agent Tree, a Claude Code side pane that shows a session's agents as a live tree
- Source: https://github.com/MikeGT4/agent-tree
- Version used: 0.7.5 (commit `2b5ab2d`)
- Used in: the Edu Deck for Claude Code, `templates/claude-mod/deck.tsx`, `deck-model.ts`,
  `deck-looks.ts`, `deck-view.tsx`, `deck-tabs.tsx`, `deck-words.ts` and `deck-state.d.ts`
  (generated into `plugins/claude-code/hooks/` and `plugins/claude-code/types/`). Edu's changes:
  English-only labels, no start intro, no self-update and no star prompt, plus the Edu tab, the Edu
  strip and the crew approvals.

```
MIT License

Copyright (c) 2026 Mike Pollow, Digitalroots

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
