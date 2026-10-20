---
id: L-normalize-each-cache-key-component-using-its-own-rule
tier: transitive
title: Normalize each cache-key component using its own rule
kind: lesson
status: candidate
band: inferred
tags:
  - session-lesson
  - session-lesson:0c01110a7a5dd039
  - lesson
links:
  - 2026-10-20-synthetic-service-learning-d06164b9
  - 2026-10-20-synthetic-service-learning-d06164b9
created: 2026-10-20T02:39:57.711Z
updated: 2026-10-20T02:39:57.711Z
source: mcp
origin: session:2026-10-20-synthetic-service-learning-d06164b9
---

Candidate scoped to Synthetic service policy v1: trim and lowercase tenant; NFKC-normalize, trim and uppercase SKU, preserving internal spaces. Build the key only after checking normalized values for emptiness. Seed-1 demonstrated that fullwidth lowercase SKU becomes AB; do not substitute a shared normalization routine for both components. Observed fixture evidence: policy.md: tenant trim/lowercase; SKU NFKC/trim/uppercase; internal spaces preserved. seed-1: tenant ' Alice ', fullwidth SKU ' ａｂ ' -> alice::AB, TTL 47. Initial oracle failed; corrected oracle passed.

Evidence: [[2026-10-20-synthetic-service-learning-d06164b9]]

Noted by the host model when closing session [[2026-10-20-synthetic-service-learning-d06164b9]]; not verified.
