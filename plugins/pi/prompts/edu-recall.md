---
description: Edu recall: search the second brain for past decisions, lessons and sessions
argument-hint: <topic or question>
---

Follow the `edu-recall` skill for this query: $ARGUMENTS

1. Call `edu_recall` with a short topic query derived from it.
2. Open at most three relevant hits with `edu_read`.
3. Answer first, then list sources (id, title, claim band). Call `edu_feedback` on any note
   that clearly helped or misled.
4. If nothing matched, say so plainly.

If the `edu_*` tools are missing, tell the user to run `edu setup` and restart this CLI.
