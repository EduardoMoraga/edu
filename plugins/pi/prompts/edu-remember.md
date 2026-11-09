---
description: "Edu remember: save a decision, hypothesis, commitment or lesson"
argument-hint: "<what to remember>"
---

Follow the `edu-remember` skill for: $ARGUMENTS

1. Classify it as `decision`, `hypothesis`, `commitment` (needs `owner` and `due`) or
   `lesson`. Ask one question only if the kind or a commitment's due date is unclear.
2. Call `edu_remember` with `tier: "transitive"`, the `kind`, a short `title`, a one-paragraph
   `body`, the claim `band`, `session` (your Edu session id, when one was injected) and `links` or
   `supersedes` when you know them. If it reports a possible conflict, ask whether to supersede.
   Stable truth goes to `edu_propose_canonical` instead.
3. Reply with one line per note: id, kind, title, band.

If the `edu_*` tools are missing, tell the user to run `edu setup` and restart this CLI.
