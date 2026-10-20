---
id: L-apply-nfkc-before-uppercasing-skus
tier: transitive
title: Apply NFKC before uppercasing SKUs
kind: lesson
status: candidate
band: inferred
tags:
  - session-lesson
  - session-lesson:ed1dab1a8f18f7f5
  - lesson
links:
  - 2026-10-20-synthetic-service-learning-a76cc0b4
created: 2026-10-20T02:39:10.685Z
updated: 2026-10-20T02:39:10.685Z
source: mcp
origin: session:2026-10-20-synthetic-service-learning-a76cc0b4
---

Full-width SKU characters must be NFKC-normalized, trimmed, then uppercased (' ａｂ ' -> 'AB'); internal spaces are kept. Tenant is only trimmed and lowercased.

Noted by the host model when closing session [[2026-10-20-synthetic-service-learning-a76cc0b4]]; not verified.
