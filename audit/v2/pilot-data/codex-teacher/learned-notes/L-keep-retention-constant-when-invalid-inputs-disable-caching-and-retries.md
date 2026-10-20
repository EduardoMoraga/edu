---
id: L-keep-retention-constant-when-invalid-inputs-disable-caching-and-retries
tier: transitive
title: Keep retention constant when invalid inputs disable caching and retries
kind: lesson
status: candidate
band: inferred
tags:
  - session-lesson
  - session-lesson:d817614d17ac278e
  - lesson
links:
  - 2026-10-20-synthetic-service-learning-d06164b9
  - 2026-10-20-synthetic-service-learning-d06164b9
created: 2026-10-20T02:39:57.718Z
updated: 2026-10-20T02:39:57.718Z
source: mcp
origin: session:2026-10-20-synthetic-service-learning-d06164b9
---

Candidate scoped to Synthetic service policy v1: an empty normalized tenant or SKU must produce null cacheKey, TTL 0 and retryAllowed false, while retentionHours remains 72. Seed-3 showed that an invalid request still retains the policy's unconditional retention value; apply it even on early-return paths. Observed fixture evidence: policy.md: invalid requests disable caching and retries; retention always 72 hours, including invalid requests. seed-3: whitespace-only tenant, GET, attempts 0 -> null cacheKey, TTL 0, retryAllowed false, retentionHours 72. Corrected oracle passed.

Evidence: [[2026-10-20-synthetic-service-learning-d06164b9]]

Noted by the host model when closing session [[2026-10-20-synthetic-service-learning-d06164b9]]; not verified.
