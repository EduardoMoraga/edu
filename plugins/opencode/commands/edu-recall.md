---
description: "Edu recall: search the second brain for past decisions, lessons and sessions"
agent: build
subtask: false
---

Follow the `edu-recall` skill for this query: $ARGUMENTS

1. Call `edu_recall` with a short topic query derived from it.
2. Open at most three relevant hits with `edu_read`.
3. Answer first, then list sources (id, title, claim band). Call `edu_feedback` on any note
   that clearly helped or misled; this is advisory opinion, never externally verified
   evidence or proof that a lesson is proven. Include workspace/global scope and source.
4. If nothing matched, say so plainly.

If the `edu_*` tools are missing, tell the user to run `edu setup` and restart this CLI.
