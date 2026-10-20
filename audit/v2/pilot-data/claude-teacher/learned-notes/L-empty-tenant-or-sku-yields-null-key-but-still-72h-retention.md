---
id: L-empty-tenant-or-sku-yields-null-key-but-still-72h-retention
tier: transitive
title: Empty tenant or SKU yields null key but still 72h retention
kind: lesson
status: candidate
band: inferred
tags:
  - session-lesson
  - session-lesson:09e1611394514861
  - lesson
links:
  - 2026-10-20-synthetic-service-learning-a76cc0b4
created: 2026-10-20T02:39:10.688Z
updated: 2026-10-20T02:39:10.688Z
source: mcp
origin: session:2026-10-20-synthetic-service-learning-a76cc0b4
---

When tenant or normalized SKU is empty: cacheKey null, TTL 0, retry false, yet retentionHours stays 72 (invalid requests included).

Noted by the host model when closing session [[2026-10-20-synthetic-service-learning-a76cc0b4]]; not verified.
