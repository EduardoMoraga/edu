---
id: L-evaluate-trial-ttl-independently-from-retry-eligibility
tier: transitive
title: Evaluate trial TTL independently from retry eligibility
kind: lesson
status: candidate
band: inferred
tags:
  - session-lesson
  - session-lesson:55d83be7c14f7049
  - lesson
links:
  - 2026-10-20-synthetic-service-learning-d06164b9
  - 2026-10-20-synthetic-service-learning-d06164b9
created: 2026-10-20T02:39:57.715Z
updated: 2026-10-20T02:39:57.715Z
source: mcp
origin: session:2026-10-20-synthetic-service-learning-d06164b9
---

Candidate scoped to Synthetic service policy v1: trial requests have TTL 0 but may still retry. Evaluate retries using validity, attempts < 2 and method; POST additionally needs a nonempty trimmed idempotency key. Seed-2 showed that TTL 0 must not automatically disable retries. Observed fixture evidence: policy.md: trial TTL 0; retry rules depend on attempts, method and trimmed idempotencyKey. seed-2: TRIAL, POST, key ' k ', attempts 1 -> trial::X, TTL 0, retryAllowed true. Corrected oracle passed.

Evidence: [[2026-10-20-synthetic-service-learning-d06164b9]]

Noted by the host model when closing session [[2026-10-20-synthetic-service-learning-d06164b9]]; not verified.
