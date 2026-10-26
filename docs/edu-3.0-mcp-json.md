# Bounded capabilities JSON

The edu_capabilities MCP response stays valid JSON within the requested token budget. When needed, it omits complete feature, limitation, or command entries and reports omission counts. Very small budgets return reduced identity or a minimal JSON value; that means insufficient budget, not an absence of capabilities.

The full MCP profile includes edu_crew_artifact. Tests cover several small and large budgets, JSON parsing, profile tool counts, and omission behavior. The generic response wrapper does not truncate serialized capabilities JSON after it has been assembled.
