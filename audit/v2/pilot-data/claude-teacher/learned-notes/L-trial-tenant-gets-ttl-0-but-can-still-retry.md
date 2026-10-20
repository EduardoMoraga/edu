---
id: L-trial-tenant-gets-ttl-0-but-can-still-retry
tier: transitive
title: Trial tenant gets TTL 0 but can still retry
kind: lesson
status: candidate
band: inferred
tags:
  - session-lesson
  - session-lesson:a4a7e052c2dd7c3e
  - lesson
links:
  - 2026-10-20-synthetic-service-learning-a76cc0b4
created: 2026-10-20T02:39:10.691Z
updated: 2026-10-20T02:39:10.691Z
source: mcp
origin: session:2026-10-20-synthetic-service-learning-a76cc0b4
---

Tenant 'trial' (case-insensitive) has TTL 0 while retry is decided independently: POST with non-empty trimmed idempotencyKey and attempts < 2 may retry.

Noted by the host model when closing session [[2026-10-20-synthetic-service-learning-a76cc0b4]]; not verified.
